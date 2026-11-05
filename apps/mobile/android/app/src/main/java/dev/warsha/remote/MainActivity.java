package dev.warsha.remote;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Bundle;
import android.util.Log;
import android.webkit.PermissionRequest;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import org.json.JSONObject;

import java.util.LinkedHashSet;

/**
 * Warsha Remote shell activity.
 *
 * Hosts the bundled {@code apps/remote} PWA (synced into
 * {@code assets/public} at build time) inside a hardened WebView and exposes
 * the {@code window.WarshaNative} bridge:
 *
 * <ul>
 *   <li>secrets via Android-Keystore-backed AES-256-GCM vault
 *       (see {@link WarshaNative});</li>
 *   <li>{@code warsha://pair} deep links, dispatched into the page as the
 *       {@code warsha:pair-deeplink} {@code CustomEvent};</li>
 *   <li>runtime CAMERA permission for QR scanning with a
 *       {@code warsha:camera-permission} result event so the web app can fall
 *       back to manual pairing code + URL entry when denied;</li>
 *   <li>{@code getAppRole()} → {@code "remote_companion"} (this shell never
 *       holds LLM API keys).</li>
 * </ul>
 */
public final class MainActivity extends Activity {

    private static final String TAG = "WarshaMainActivity";
    private static final int CAMERA_REQUEST_CODE = 0x5A01;
    private static final String START_PAGE = "file:///android_asset/public/index.html";

    private WebView webView;
    private WarshaNative bridge;

    /** Latest deep-link URI received via VIEW intents (never logged). */
    private String pendingPairingUri;
    /** URIs already dispatched into the page, deduplicated per launch. */
    private final LinkedHashSet<String> deliveredPairingUris = new LinkedHashSet<>();

    /** Pending camera-permission grant state handed back to {@link #onCameraPermissionResult()}. */
    private boolean pendingCameraGrantForWeb;

    @SuppressLint("SetJavaScriptEnabled")
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        webView = new WebView(this);
        setContentView(webView);

        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        // File access is only used for the bundled asset page; remote content
        // loaded over http(s)/ws(s) obeys the network security config.
        settings.setAllowFileAccess(true);
        settings.setAllowContentAccess(false);
        settings.setMediaPlaybackRequiresUserGesture(true);

        bridge = new WarshaNative(this);
        webView.addJavascriptInterface(bridge, "WarshaNative");

        webView.setWebViewClient(new WebViewClient());
        webView.setWebChromeClient(new WebChromeClient() {
            @Override
            public void onPermissionRequest(final PermissionRequest request) {
                handleWebPermissionRequest(request);
            }
        });

        handleViewIntent(getIntent());
        webView.loadUrl(START_PAGE);
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        handleViewIntent(intent);
        runOnUiThread(this::dispatchPendingPairing);
    }

    @Override
    protected void onResume() {
        super.onResume();
        dispatchPendingPairing();
    }

    @Override
    protected void onDestroy() {
        if (webView != null) {
            webView.destroy();
            webView = null;
        }
        super.onDestroy();
    }

    /** Back button walks the page history instead of closing the app. */
    @Override
    public void onBackPressed() {
        if (webView != null && webView.canGoBack()) {
            webView.goBack();
        } else {
            super.onBackPressed();
        }
    }

    // ------------------------------------------------------------------
    // Deep links: warsha://pair?...
    // ------------------------------------------------------------------

    private void handleViewIntent(Intent intent) {
        if (intent == null) {
            return;
        }
        Uri data = intent.getData();
        if (data != null
                && "warsha".equalsIgnoreCase(data.getScheme())
                && "pair".equalsIgnoreCase(data.getHost())) {
            // Only the string is kept; never logged.
            pendingPairingUri = data.toString();
        }
    }

    private void dispatchPendingPairing() {
        String uri = pendingPairingUri;
        if (webView == null || uri == null || deliveredPairingUris.contains(uri)) {
            return;
        }
        // JSONObject.quote performs safe JS/JSON string escaping of the URI.
        String js = "window.dispatchEvent(new CustomEvent('warsha:pair-deeplink', { detail: "
                + JSONObject.quote(uri) + " }));";
        webView.evaluateJavascript(js, null);
        deliveredPairingUris.add(uri);
    }

    /** Consumed by the web app through {@code window.WarshaNative.getInitialPairingUri()}. */
    String initialPairingUri() {
        return pendingPairingUri;
    }

    // ------------------------------------------------------------------
    // Camera permission (QR pairing) with manual-entry fallback
    // ------------------------------------------------------------------

    /**
     * Called from JS: asks the user for {@code android.permission.CAMERA} at
     * runtime. The outcome is delivered to the page as the
     * {@code warsha:camera-permission} CustomEvent
     * ({@code detail: { granted, fallback }}) — on denial the web app must fall
     * back to manual pairing code + URL entry.
     */
    void requestCameraPermission() {
        runOnUiThread(() -> {
            int state = checkSelfPermission(android.Manifest.permission.CAMERA);
            if (state == PackageManager.PERMISSION_GRANTED) {
                onCameraPermissionResult(true);
            } else {
                requestPermissions(
                        new String[] { android.Manifest.permission.CAMERA },
                        CAMERA_REQUEST_CODE);
            }
        });
    }

    @Override
    public void onRequestPermissionsResult(
            int requestCode, String[] permissions, int[] grantResults) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
        if (requestCode == CAMERA_REQUEST_CODE) {
            boolean granted = grantResults.length > 0
                    && grantResults[0] == PackageManager.PERMISSION_GRANTED;
            onCameraPermissionResult(granted);
        }
    }

    private void onCameraPermissionResult(boolean granted) {
        pendingCameraGrantForWeb = granted;
        if (webView == null) {
            return;
        }
        String js = "window.dispatchEvent(new CustomEvent('warsha:camera-permission', { detail: {"
                + " granted: " + granted
                + ", fallback: " + JSONObject.quote(granted ? "none" : "manual_code_and_url")
                + " } }));";
        webView.evaluateJavascript(js, null);
    }

    /**
     * Grants {@code RESOURCE_VIDEO_CAPTURE} to the WebView (getUserMedia for
     * QR scanning) only when the runtime CAMERA permission is already
     * granted and the request comes from the bundled local page.
     */
    private void handleWebPermissionRequest(final PermissionRequest request) {
        runOnUiThread(() -> {
            boolean wantsVideoCapture = false;
            for (String resource : request.getResources()) {
                if (PermissionRequest.RESOURCE_VIDEO_CAPTURE.equals(resource)) {
                    wantsVideoCapture = true;
                } else {
                    // Anything beyond camera capture (mic, protected media…) is denied.
                    request.deny();
                    return;
                }
            }
            boolean cameraGranted = pendingCameraGrantForWeb
                    || checkSelfPermission(android.Manifest.permission.CAMERA)
                            == PackageManager.PERMISSION_GRANTED;
            if (wantsVideoCapture && cameraGranted && isLocalOrigin(request.getOrigin())) {
                request.grant(new String[] { PermissionRequest.RESOURCE_VIDEO_CAPTURE });
            } else {
                request.deny();
            }
        });
    }

    /**
     * Only the bundled asset origin may receive getUserMedia grants; remote
     * origins served over cleartext LAN/Tailscale (allowed by the network
     * security config for pairing sockets) are not given camera access.
     */
    private boolean isLocalOrigin(Uri origin) {
        if (origin == null) {
            return false;
        }
        String host = origin.getHost();
        String scheme = origin.getScheme();
        if (host == null || scheme == null) {
            return false;
        }
        return "file".equals(scheme)
                || "localhost".equalsIgnoreCase(host)
                || "127.0.0.1".equals(host)
                || "10.0.2.2".equals(host);
    }

    /** App role: the remote companion never holds LLM API keys. */
    String appRole() {
        return WarshaNative.APP_ROLE;
    }

    void logBridgeError(String operation, Throwable error) {
        // Operation names only — never values, keys or URIs.
        Log.w(TAG, "native bridge operation failed: " + operation
                + " (" + error.getClass().getSimpleName() + ")");
    }
}
