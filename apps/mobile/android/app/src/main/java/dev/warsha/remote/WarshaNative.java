package dev.warsha.remote;

import android.content.Context;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;
import android.webkit.JavascriptInterface;

import org.json.JSONException;
import org.json.JSONObject;

import java.io.File;
import java.io.IOException;
import java.io.RandomAccessFile;
import java.nio.charset.StandardCharsets;
import java.security.GeneralSecurityException;
import java.security.KeyStore;
import java.security.SecureRandom;

import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

/**
 * {@code window.WarshaNative} — the JavaScript bridge registered by
 * {@link MainActivity}.
 *
 * <h3>Secret storage</h3>
 *
 * Pairing tokens and other secrets are sealed with a non-exportable AES-256
 * key held in the hardware-backed Android Keystore
 * ({@code KeyStore.getInstance("AndroidKeyStore")}, {@code
 * KeyGenParameterSpec} with {@code BLOCK_MODE_GCM} and
 * {@code ENCRYPTION_PADDING_NONE}). Each {@link #saveSecret(String, String)}
 * encrypts with a fresh 12-byte random IV and persists <em>only</em>
 * {@code {"iv": base64, "ciphertext": base64(tag included)}} entries in the
 * app-private file {@code context.getFilesDir()/warsha_keystore_vault.json}.
 * Values never touch plain {@code SharedPreferences}, unencrypted
 * {@code localStorage} files, logs or external storage.
 *
 * <h3>Threat model</h3>
 *
 * The vault file is app-private; the AES key cannot be extracted even with
 * root (KeyStore blob is non-exportable), so a stolen file is ciphertext
 * only. Reinstalling the app regenerates the key, requiring re-pairing.
 *
 * <p>All methods are invoked on a WebView JS-bridge worker thread, hence the
 * explicit {@code synchronized} guards; results are plain JSON-safe values.
 */
public final class WarshaNative {

    /** The remote companion never holds LLM API keys. */
    static final String APP_ROLE = "remote_companion";

    private static final String KEYSTORE_PROVIDER = "AndroidKeyStore";
    private static final String KEY_ALIAS = "warsha_remote_aes256_gcm";
    private static final String TRANSFORMATION = "AES/GCM/NoPadding";
    private static final int GCM_TAG_BITS = 128;
    private static final int GCM_IV_BYTES = 12;
    private static final int AES_KEY_BITS = 256;
    private static final String VAULT_FILE_NAME = "warsha_keystore_vault.json";

    private final Context appContext;
    private final MainActivity activity;
    private final File vaultFile;
    private final SecureRandom secureRandom = new SecureRandom();

    private JSONObject vaultCache;

    WarshaNative(MainActivity activity) {
        this.activity = activity;
        this.appContext = activity.getApplicationContext();
        this.vaultFile = new File(appContext.getFilesDir(), VAULT_FILE_NAME);
    }

    // ------------------------------------------------------------------
    // Secret vault
    // ------------------------------------------------------------------

    /**
     * Encrypts {@code value} with the Android-Keystore AES-256-GCM key and
     * stores only IV + ciphertext in the app-private vault file.
     *
     * @return {@code true} when persisted, {@code false} on any failure
     *         (never throws into JS).
     */
    @JavascriptInterface
    public synchronized boolean saveSecret(String key, String value) {
        if (key == null || value == null || key.isEmpty()) {
            return false;
        }
        try {
            byte[] iv = new byte[GCM_IV_BYTES];
            secureRandom.nextBytes(iv);

            Cipher cipher = Cipher.getInstance(TRANSFORMATION);
            cipher.init(Cipher.ENCRYPT_MODE, getOrCreateAesKey(),
                    new GCMParameterSpec(GCM_TAG_BITS, iv));
            byte[] ciphertext = cipher.doFinal(value.getBytes(StandardCharsets.UTF_8));

            JSONObject entry = new JSONObject();
            entry.put("iv", Base64.encodeToString(iv, Base64.NO_WRAP));
            entry.put("ciphertext",
                    Base64.encodeToString(ciphertext, Base64.NO_WRAP));

            JSONObject vault = loadVault();
            vault.put(safeVaultKey(key), entry);
            persistVault(vault);
            return true;
        } catch (GeneralSecurityException e) {
            activity.logBridgeError("saveSecret:keystore", e);
            return false;
        } catch (IOException | JSONException e) {
            activity.logBridgeError("saveSecret:file", e);
            return false;
        }
    }

    /**
     * Decrypts and returns the secret stored under {@code key}, or
     * {@code null} when absent. Plaintext exists only for the duration of the
     * return value; it is never written to disk unencrypted or logged.
     */
    @JavascriptInterface
    public synchronized String loadSecret(String key) {
        if (key == null || key.isEmpty()) {
            return null;
        }
        try {
            JSONObject vault = loadVault();
            JSONObject entry = vault.optJSONObject(safeVaultKey(key));
            if (entry == null) {
                return null;
            }
            byte[] iv = Base64.decode(entry.getString("iv"), Base64.NO_WRAP);
            byte[] ciphertext =
                    Base64.decode(entry.getString("ciphertext"), Base64.NO_WRAP);

            Cipher cipher = Cipher.getInstance(TRANSFORMATION);
            cipher.init(Cipher.DECRYPT_MODE, getOrCreateAesKey(),
                    new GCMParameterSpec(GCM_TAG_BITS, iv));
            byte[] plain = cipher.doFinal(ciphertext);
            return new String(plain, StandardCharsets.UTF_8);
        } catch (GeneralSecurityException e) {
            // Wrong key (e.g. after restore to a different device) or a
            // tampered vault file: GCM authentication failed.
            activity.logBridgeError("loadSecret:keystore", e);
            return null;
        } catch (IOException | JSONException e) {
            activity.logBridgeError("loadSecret:file", e);
            return null;
        }
    }

    /** Removes a stored secret. Returns {@code true} when the vault no longer contains it. */
    @JavascriptInterface
    public synchronized boolean deleteSecret(String key) {
        if (key == null || key.isEmpty()) {
            return false;
        }
        try {
            JSONObject vault = loadVault();
            String vaultKey = safeVaultKey(key);
            if (!vault.has(vaultKey)) {
                return true;
            }
            vault.remove(vaultKey);
            persistVault(vault);
            return !vault.has(vaultKey);
        } catch (IOException e) {
            activity.logBridgeError("deleteSecret:file", e);
            return false;
        }
    }

    // ------------------------------------------------------------------
    // Deep links / pairing / role
    // ------------------------------------------------------------------

    /** The {@code warsha://pair?...} URI this launch came from, or {@code null}. */
    @JavascriptInterface
    public String getInitialPairingUri() {
        return activity.initialPairingUri();
    }

    /**
     * Requests the runtime CAMERA permission for QR pairing; the outcome
     * arrives as the {@code warsha:camera-permission} CustomEvent. On denial
     * the web app falls back to manual pairing code + URL entry.
     */
    @JavascriptInterface
    public void requestCameraPermission() {
        activity.requestCameraPermission();
    }

    /** Always {@code "remote_companion"} — this app role never holds LLM API keys. */
    @JavascriptInterface
    public String getAppRole() {
        return APP_ROLE;
    }

    /**
     * Machine-readable capability probe for the web layer, so the UI can
     * adapt without parsing user-visible strings. Returns a small JSON
     * document (no secrets).
     */
    @JavascriptInterface
    public String getNativeInfo() {
        try {
            JSONObject info = new JSONObject();
            info.put("appRole", APP_ROLE);
            info.put("secretStore", "android_keystore_aes256_gcm");
            info.put("deepLinkScheme", "warsha://pair");
            info.put("cameraAvailable", true);
            return info.toString();
        } catch (JSONException e) {
            return "{\"appRole\":\"remote_companion\"}";
        }
    }

    // ------------------------------------------------------------------
    // Internals
    // ------------------------------------------------------------------

    /** Namespace keys so unrelated JS modules cannot collide on one entry. */
    private static String safeVaultKey(String key) {
        return "warsha:" + key;
    }

    private SecretKey getOrCreateAesKey() throws GeneralSecurityException, IOException {
        KeyStore keyStore = KeyStore.getInstance(KEYSTORE_PROVIDER);
        keyStore.load(null);

        KeyStore.Entry existing =
                keyStore.getEntry(KEY_ALIAS, null);
        if (existing instanceof KeyStore.SecretKeyEntry) {
            return ((KeyStore.SecretKeyEntry) existing).getSecretKey();
        }

        KeyGenerator generator =
                KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES,
                        KEYSTORE_PROVIDER);
        generator.init(new KeyGenParameterSpec.Builder(
                KEY_ALIAS,
                KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setKeySize(AES_KEY_BITS)
                // The sealed blob in the vault file is the only ciphertext
                // this app ever persists; no biometric/timeout binding for the
                // pairing token so background WS reconnects can decrypt.
                .build());
        return generator.generateKey();
    }

    private JSONObject loadVault() throws IOException {
        if (vaultCache != null) {
            return vaultCache;
        }
        if (vaultFile.exists()) {
            try (RandomAccessFile file =
                    new RandomAccessFile(vaultFile, "r")) {
                byte[] bytes = new byte[(int) file.length()];
                file.readFully(bytes);
                String json = new String(bytes, StandardCharsets.UTF_8).trim();
                if (!json.isEmpty()) {
                    try {
                        vaultCache = new JSONObject(json);
                        return vaultCache;
                    } catch (JSONException corrupt) {
                        activity.logBridgeError("loadVault:corrupt", corrupt);
                    }
                }
            }
        }
        vaultCache = new JSONObject();
        return vaultCache;
    }

    /** Atomic write: temp file + rename, mode 0600 via private-files-dir. */
    private void persistVault(JSONObject vault) throws IOException {
        File tmp = new File(vaultFile.getParentFile(), VAULT_FILE_NAME + ".tmp");
        try (RandomAccessFile out = new RandomAccessFile(tmp, "rw")) {
            out.setLength(0);
            out.write(vault.toString().getBytes(StandardCharsets.UTF_8));
        }
        if (!tmp.renameTo(vaultFile)) {
            // renameTo can fail across filesystems; fall back to copy-over.
            if (vaultFile.exists() && !vaultFile.delete()) {
                throw new IOException("vault_replace_failed");
            }
            try (RandomAccessFile in = new RandomAccessFile(tmp, "r");
                 RandomAccessFile dest = new RandomAccessFile(vaultFile, "rw")) {
                dest.setLength(0);
                byte[] buffer = new byte[8192];
                int read;
                while ((read = in.read(buffer)) > 0) {
                    dest.write(buffer, 0, read);
                }
            }
            if (!tmp.delete()) {
                tmp.deleteOnExit();
            }
            vaultCache = vault;
            return;
        }
        vaultCache = vault;
    }
}
