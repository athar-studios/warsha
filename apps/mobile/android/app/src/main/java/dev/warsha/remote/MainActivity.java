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
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import org.json.JSONObject;

import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.URLDecoder;
import java.util.Collections;
import java.util.LinkedHashSet;
import java.util.Locale;

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
 *
 * The page is served from {@value #ASSET_ORIGIN} rather than from
 * {@code file:///android_asset/public/index.html} (OD-UI7, R-UI-7): a {@code file:}
 * document can only present {@code Origin: null}, which any web page can force a
 * browser to send and which the daemon therefore never admits, so nothing could
 * pair. {@link #shouldInterceptRequest} answers every request for that one host
 * from the bundled assets and nothing else — no {@code androidx.webkit}, no network.
 */
public final class MainActivity extends Activity {

    private static final String TAG = "WarshaMainActivity";
    private static final int CAMERA_REQUEST_CODE = 0x5A01;

    /** The one host this shell serves, and the origin string the daemon admits for it. */
    private static final String ASSET_HOST = "appassets.androidplatform.net";
    private static final String ASSET_ORIGIN = "https://" + ASSET_HOST;
    /** The bundled page; its origin is {@value #ASSET_ORIGIN}, never {@code null}. */
    private static final String START_PAGE = ASSET_ORIGIN + "/index.html";
    /** The {@code assets/} directory the page is bundled under. */
    private static final String ASSET_ROOT = "public/";

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
        // The page is served from the asset host (R-UI-7), so nothing here reads `file://`
        // any more; leaving file access on would only add a way to reach the filesystem.
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(false);
        settings.setMediaPlaybackRequiresUserGesture(true);

        bridge = new WarshaNative(this);
        webView.addJavascriptInterface(bridge, "WarshaNative");

        webView.setWebViewClient(new WebViewClient() {
            @Override
            public WebResourceResponse shouldInterceptRequest(
                    WebView view, WebResourceRequest request) {
                return serveBundledAsset(request);
            }
        });
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
    // The bundled page, served from a real origin (OD-UI7)
    // ------------------------------------------------------------------

    /**
     * Answers every request for {@value #ASSET_HOST} from {@code assets/public/}, and returns
     * {@code null} — "the WebView handles it normally" — for every other URL, including the
     * loopback daemon and its event socket.
     *
     * Why an origin at all: the daemon refuses a present-but-unlisted {@code Origin}, and a
     * {@code file:} document can only present {@code null}, which is never admitted (any page can
     * force a browser to send it). Serving the same bundle from one fixed https host gives the page
     * one exact origin that the daemon can name.
     *
     * Why hand-rolled: {@code androidx.webkit}'s {@code WebViewAssetLoader} would deliver the same
     * origin, but this app is deliberately framework-only and the Gradle build is already the weak
     * link (R-UI-6b). This is the ~40 lines that matter, with no new dependency.
     *
     * The handler is also the reason no request for this host can reach the network:
     * {@code appassets.androidplatform.net} is a public name this app does not own, so a request
     * the bundle cannot answer is a 404 here, never a forward.
     */
    private WebResourceResponse serveBundledAsset(WebResourceRequest request) {
        if (request == null) {
            return null;
        }
        Uri url = request.getUrl();
        if (url == null || !ASSET_HOST.equals(url.getHost())) {
            return null;
        }
        // From here the host is ours. Only a plain GET of the one scheme is a bundled file;
        // anything else (another method, another port, cleartext) is refused rather than forwarded.
        if (!"https".equals(url.getScheme())
                || url.getPort() != -1
                || !"GET".equalsIgnoreCase(request.getMethod())) {
            return notFound();
        }
        String assetName = assetNameFor(url.getPath());
        if (assetName == null) {
            return notFound();
        }
        InputStream body;
        try {
            body = getAssets().open(assetName);
        } catch (IOException missing) {
            // The path is the only detail worth naming, and it holds no secret.
            Log.d(TAG, "bundled asset not found: " + assetName);
            return notFound();
        }
        return new WebResourceResponse(mimeTypeFor(assetName), "utf-8", body);
    }

    /**
     * The {@code assets/} name a URL path names, or {@code null} when the path cannot be a bundled
     * file. A path is refused — never repaired — if it carries {@code ..}, a backslash or a NUL,
     * including any percent-encoded form of those: the check runs again after each decode because
     * a single decode of {@code %252e%252e} still reads {@code %2e%2e}, and {@link
     * android.content.res.AssetManager} opens only the literal name it is handed.
     */
    private static String assetNameFor(String path) {
        if (!isBundlePath(path)) {
            return null;
        }
        String decoded = path;
        for (int round = 0; round < 4; round++) {
            String next;
            try {
                next = URLDecoder.decode(decoded, "UTF-8");
            } catch (IOException | IllegalArgumentException malformed) {
                return null;
            }
            if (next.equals(decoded)) {
                break;
            }
            decoded = next;
            if (!isBundlePath(decoded)) {
                return null;
            }
        }
        // Drop the one leading slash; everything after it is the name under `public/`.
        String name = decoded.substring(1);
        return name.isEmpty() ? null : ASSET_ROOT + name;
    }

    /** Whether a path could name a file inside the bundle at all — the traversal guard. */
    private static boolean isBundlePath(String path) {
        if (path == null || path.isEmpty() || path.charAt(0) != '/') {
            return false;
        }
        return path.indexOf('\0') < 0 && path.indexOf('\\') < 0 && !path.contains("..");
    }

    /** The type the WebView needs to render the file; the bundle is html, js, css, fonts and icons. */
    private static String mimeTypeFor(String assetName) {
        String name = assetName.toLowerCase(Locale.ROOT);
        if (name.endsWith(".html") || name.endsWith(".htm")) {
            return "text/html";
        }
        if (name.endsWith(".js") || name.endsWith(".mjs")) {
            return "text/javascript";
        }
        if (name.endsWith(".css")) {
            return "text/css";
        }
        if (name.endsWith(".json") || name.endsWith(".webmanifest")) {
            return "application/json";
        }
        if (name.endsWith(".svg")) {
            return "image/svg+xml";
        }
        if (name.endsWith(".png")) {
            return "image/png";
        }
        if (name.endsWith(".jpg") || name.endsWith(".jpeg")) {
            return "image/jpeg";
        }
        if (name.endsWith(".webp")) {
            return "image/webp";
        }
        if (name.endsWith(".gif")) {
            return "image/gif";
        }
        if (name.endsWith(".ico")) {
            return "image/x-icon";
        }
        if (name.endsWith(".woff2")) {
            return "font/woff2";
        }
        if (name.endsWith(".woff")) {
            return "font/woff";
        }
        if (name.endsWith(".ttf")) {
            return "font/ttf";
        }
        if (name.endsWith(".txt")) {
            return "text/plain";
        }
        return "application/octet-stream";
    }

    /** An empty 404 for the asset host: the bundle holds no such file, and the network is not asked. */
    private static WebResourceResponse notFound() {
        return new WebResourceResponse(
                "text/plain",
                "utf-8",
                404,
                "Not Found",
                Collections.<String, String>emptyMap(),
                new ByteArrayInputStream(new byte[0]));
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
     *
     * Since R-UI-7 the bundled page's own origin is the asset host, so that is
     * the document QR scanning runs in; the `file:` branch stays because it is
     * the shape this shell used before, and a restore of an older bundle must
     * not silently lose the camera.
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
        if ("https".equals(scheme) && ASSET_HOST.equals(host)) {
            return true;
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
