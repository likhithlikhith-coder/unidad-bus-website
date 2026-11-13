package com.unidad.tallyviewer;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.content.ContentValues;
import android.content.Intent;
import android.database.Cursor;
import android.graphics.Bitmap;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.provider.DocumentsContract;
import android.provider.MediaStore;
import android.provider.OpenableColumns;
import android.util.Base64;
import android.view.View;
import android.view.ViewGroup;
import android.view.WindowManager;
import android.webkit.JavascriptInterface;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;
import android.widget.Toast;
import android.window.OnBackInvokedCallback;
import android.window.OnBackInvokedDispatcher;

import androidx.annotation.RequiresApi;
import androidx.core.content.FileProvider;
import androidx.core.graphics.Insets;
import androidx.core.view.OnApplyWindowInsetsListener;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;
import androidx.webkit.ServiceWorkerClientCompat;
import androidx.webkit.ServiceWorkerControllerCompat;
import androidx.webkit.WebViewAssetLoader;
import androidx.webkit.WebViewFeature;

import java.io.ByteArrayInputStream;
import java.io.Closeable;
import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.Locale;

/**
 * Thin native shell around the Tally Viewer web app.
 *
 * The web app is bundled in assets/ and served from https://appassets.androidplatform.net
 * through WebViewAssetLoader. That gives it a proper secure origin, so IndexedDB,
 * Web Workers and crypto.subtle all work exactly as they do in Chrome. (The page itself
 * unregisters its service worker inside the APK: the bundled files need no second cache.)
 *
 * TallyBridge lets the page talk to TallyPrime's XML server on the local network
 * (port 9000). The response is written to the app cache and served back to the
 * page through the asset loader, so even 100 MB exports never pass through a
 * JavaScript string.
 *
 * Page callbacks (all optional on the page side):
 *   TallyBridgeDone(id, ok, idOrError)      reply to request()
 *   TallyBridgeSaved(name, ok, whereOrError) reply to saveFile() / shareFile()
 *   TallyBridgeFolder(id, ok, "a|b|c")      reply to pickFolder()
 *   TallyBridgeOpen(id, displayName)        an XML file was shared with / opened in the app
 *   TVBack() -> boolean                     hardware back; true when the page handled it
 *   TVRelock()                              the app came back to the foreground
 */
public class MainActivity extends Activity {
    private static final String START_URL = "https://appassets.androidplatform.net/assets/index.html";
    private static final String APP_HOST = "appassets.androidplatform.net";
    private static final String IFSC_HOST = "ifsc.razorpay.com";
    private static final String UA_SUFFIX = " TallyViewerApp/1.9";
    private static final int BG_COLOR = 0xFF07080B;
    private static final int FILE_CHOOSER = 1001;
    private static final int FOLDER_PICKER = 1002;
    private static final String ID_RE = "[A-Za-z0-9_-]{1,64}";
    /** Upper bound for a Tally reply or an opened file; a LAN export never comes near it. */
    private static final long MAX_BYTES = 512L * 1024 * 1024;
    /** Exports and Tally replies older than this are swept from the cache at startup. */
    private static final long CACHE_TTL_MS = 24L * 60 * 60 * 1000;

    private FrameLayout root;
    private WebView webView;
    private WebViewAssetLoader loader;
    private ValueCallback<Uri[]> pendingFileCallback;
    private String pendingFolderId;
    private File tallyCache;
    private boolean pageReady;
    /** {id, displayName} pairs waiting for the page to finish loading (UI thread only). */
    private final List<String[]> pendingOpens = new ArrayList<>();
    /** OnBackInvokedCallback on API 33+, kept as Object so older devices never load the class. */
    private Object backCallback;

    @SuppressLint("SetJavaScriptEnabled")
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        tallyCache = new File(getCacheDir(), "tally");
        tallyCache.mkdirs();
        sweepCaches();
        if (savedInstanceState != null) pendingFolderId = savedInstanceState.getString("pendingFolderId");

        // Edge-to-edge: draw behind the system bars and pad the content by the bar, cutout and
        // keyboard insets here, so the page never has to rely on env(safe-area-inset-*).
        WindowCompat.setDecorFitsSystemWindows(getWindow(), false);
        root = new FrameLayout(this);
        root.setBackgroundColor(BG_COLOR);
        webView = new WebView(this);
        webView.setBackgroundColor(BG_COLOR);
        root.addView(webView, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        setContentView(root);
        ViewCompat.setOnApplyWindowInsetsListener(root, new OnApplyWindowInsetsListener() {
            @Override
            public WindowInsetsCompat onApplyWindowInsets(View v, WindowInsetsCompat insets) {
                Insets sb = insets.getInsets(WindowInsetsCompat.Type.systemBars() | WindowInsetsCompat.Type.displayCutout());
                Insets ime = insets.getInsets(WindowInsetsCompat.Type.ime());
                v.setPadding(sb.left, sb.top, sb.right, Math.max(sb.bottom, ime.bottom));
                return WindowInsetsCompat.CONSUMED;
            }
        });

        WebSettings s = webView.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setAllowFileAccess(false);
        s.setAllowContentAccess(false);
        s.setMediaPlaybackRequiresUserGesture(true);
        s.setCacheMode(WebSettings.LOAD_DEFAULT);
        s.setUserAgentString(s.getUserAgentString() + UA_SUFFIX);

        loader = new WebViewAssetLoader.Builder()
                .addPathHandler("/assets/", new WebViewAssetLoader.AssetsPathHandler(this))
                .addPathHandler("/cache/", new WebViewAssetLoader.InternalStoragePathHandler(this, tallyCache))
                .build();

        webView.setWebViewClient(new WebViewClient() {
            @Override
            public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                return intercept(request.getUrl());
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri u = request.getUrl();
                String scheme = u.getScheme() == null ? "" : u.getScheme().toLowerCase(Locale.ROOT);
                if ("https".equals(scheme) && APP_HOST.equalsIgnoreCase(u.getHost())) return false;
                // Only ordinary links leave the app; tel/mailto/whatsapp open their handlers, anything else is dropped.
                if (scheme.equals("http") || scheme.equals("https") || scheme.equals("mailto") || scheme.equals("tel") || scheme.equals("whatsapp")) {
                    try { startActivity(new Intent(Intent.ACTION_VIEW, u)); } catch (Exception ignored) { }
                }
                return true;
            }

            @Override
            public void onPageStarted(WebView view, String url, Bitmap favicon) { pageReady = false; }

            @Override
            public void onPageFinished(WebView view, String url) { pageReady = true; drainPendingOpens(); }
        });

        // A service worker left behind by an earlier version still controls the first page load after
        // an update; keep serving it from the bundle until the page unregisters it.
        if (WebViewFeature.isFeatureSupported(WebViewFeature.SERVICE_WORKER_BASIC_USAGE)) {
            ServiceWorkerControllerCompat.getInstance().setServiceWorkerClient(new ServiceWorkerClientCompat() {
                @Override
                public WebResourceResponse shouldInterceptRequest(WebResourceRequest request) {
                    return intercept(request.getUrl());
                }
            });
        }

        webView.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback, FileChooserParams params) {
                if (pendingFileCallback != null) pendingFileCallback.onReceiveValue(null);
                pendingFileCallback = callback;
                Intent intent = new Intent(Intent.ACTION_GET_CONTENT);
                intent.addCategory(Intent.CATEGORY_OPENABLE);
                intent.setType("*/*");
                intent.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true);
                try {
                    startActivityForResult(Intent.createChooser(intent, "Choose Tally XML files"), FILE_CHOOSER);
                } catch (Exception e) {
                    pendingFileCallback = null;
                    return false;
                }
                return true;
            }
        });

        webView.addJavascriptInterface(new TallyBridge(), "TallyBridge");
        if (Build.VERSION.SDK_INT >= 33) registerBackCallback();

        if (savedInstanceState == null || webView.restoreState(savedInstanceState) == null) webView.loadUrl(START_URL);
        // A recreated activity already imported its launch intent; only a fresh one handles it.
        if (savedInstanceState == null) try { handleIntent(getIntent()); } catch (RuntimeException ignored) { } // a malformed extra from another app must not crash the launch
    }

    /* ---- subresource policy -------------------------------------------------- */

    /** Bundle host goes to the asset loader, the IFSC lookup host to the network, everything else is refused. */
    private WebResourceResponse intercept(Uri u) {
        String scheme = u.getScheme();
        if (scheme == null) return null;
        scheme = scheme.toLowerCase(Locale.ROOT);
        if (!scheme.equals("http") && !scheme.equals("https")) return null; // data:, blob:, about: stay inside the WebView
        String host = u.getHost();
        if (APP_HOST.equalsIgnoreCase(host)) {
            WebResourceResponse r = loader.shouldInterceptRequest(u);
            return r != null ? r : blocked();
        }
        if ("https".equals(scheme) && IFSC_HOST.equalsIgnoreCase(host)) return null;
        return blocked();
    }

    private static WebResourceResponse blocked() {
        return new WebResourceResponse("text/plain", "utf-8", 403, "Blocked", Collections.<String, String>emptyMap(), new ByteArrayInputStream(new byte[0]));
    }

    /* ---- back navigation ----------------------------------------------------- */

    @RequiresApi(33)
    private void registerBackCallback() {
        OnBackInvokedCallback cb = new OnBackInvokedCallback() {
            @Override
            public void onBackInvoked() { handleBack(); }
        };
        backCallback = cb;
        getOnBackInvokedDispatcher().registerOnBackInvokedCallback(OnBackInvokedDispatcher.PRIORITY_DEFAULT, cb);
    }

    @RequiresApi(33)
    private void unregisterBackCallback() {
        if (backCallback != null) getOnBackInvokedDispatcher().unregisterOnBackInvokedCallback((OnBackInvokedCallback) backCallback);
        backCallback = null;
    }

    /** The page gets the first say (closes a sheet, swallows back on the PIN screen); then WebView history; then the app closes. */
    private void handleBack() {
        if (webView == null) { finish(); return; }
        webView.evaluateJavascript("(function(){try{return !!(window.TVBack&&TVBack())}catch(e){return false}})()", new ValueCallback<String>() {
            @Override
            public void onReceiveValue(String v) {
                if ("true".equals(v)) return;
                if (webView == null) { finish(); return; }
                if (webView.canGoBack()) webView.goBack(); else finish();
            }
        });
    }

    /** Below API 33 the system still dispatches back here (the manifest's OnBackInvokedCallback flag only applies from 33). */
    @Override
    @SuppressWarnings("deprecation")
    public void onBackPressed() {
        handleBack();
    }

    /* ---- "Open with" / "Share to" --------------------------------------------- */

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        try { handleIntent(intent); } catch (RuntimeException ignored) { }
    }

    /** ACTION_VIEW / SEND / SEND_MULTIPLE with XML files: copy each into the cache and hand it to the page. */
    private void handleIntent(Intent intent) {
        if (intent == null) return;
        String action = intent.getAction();
        List<Uri> uris = new ArrayList<>();
        if (Intent.ACTION_VIEW.equals(action)) {
            if (intent.getData() != null) uris.add(intent.getData());
        } else if (Intent.ACTION_SEND.equals(action)) {
            Uri u = streamExtra(intent);
            if (u != null) uris.add(u);
        } else if (Intent.ACTION_SEND_MULTIPLE.equals(action)) {
            List<Uri> l = streamExtras(intent);
            if (l != null) for (Uri u : l) if (u != null) uris.add(u);
        } else {
            return;
        }
        if (uris.isEmpty() && intent.getClipData() != null) {
            for (int i = 0; i < intent.getClipData().getItemCount(); i++) {
                Uri u = intent.getClipData().getItemAt(i).getUri();
                if (u != null) uris.add(u);
            }
        }
        // Consume the intent so a recreated activity never imports the same file twice.
        intent.setAction(Intent.ACTION_MAIN);
        intent.setData(null);
        intent.setClipData(null);
        intent.removeExtra(Intent.EXTRA_STREAM);
        setIntent(intent);
        for (Uri u : uris) importUri(u);
    }

    @SuppressWarnings("deprecation")
    private static Uri streamExtra(Intent intent) {
        if (Build.VERSION.SDK_INT >= 33) return intent.getParcelableExtra(Intent.EXTRA_STREAM, Uri.class);
        return intent.getParcelableExtra(Intent.EXTRA_STREAM);
    }

    @SuppressWarnings("deprecation")
    private static List<Uri> streamExtras(Intent intent) {
        if (Build.VERSION.SDK_INT >= 33) return intent.getParcelableArrayListExtra(Intent.EXTRA_STREAM, Uri.class);
        return intent.getParcelableArrayListExtra(Intent.EXTRA_STREAM);
    }

    /** Copies a content:// or file:// XML into tallyCache/<id>.xml off the main thread, then queues TallyBridgeOpen(id, name). */
    private void importUri(final Uri src) {
        if (src == null) return;
        String scheme = src.getScheme();
        if (!"content".equals(scheme) && !"file".equals(scheme)) return;
        new Thread(new Runnable() {
            @Override
            public void run() {
                final String id = "o" + Long.toString(System.nanoTime() & Long.MAX_VALUE, 36);
                final String name = displayName(src);
                File out = new File(tallyCache, id + ".xml");
                InputStream in = null;
                FileOutputStream fo = null;
                try {
                    in = getContentResolver().openInputStream(src);
                    if (in == null) throw new IOException("Cannot open file");
                    fo = new FileOutputStream(out);
                    copy(in, fo, MAX_BYTES);
                } catch (final Exception e) {
                    out.delete();
                    runOnUiThread(new Runnable() {
                        @Override
                        public void run() { Toast.makeText(MainActivity.this, "Could not open " + name + ": " + e.getMessage(), Toast.LENGTH_LONG).show(); }
                    });
                    return;
                } finally {
                    close(in);
                    close(fo);
                }
                runOnUiThread(new Runnable() {
                    @Override
                    public void run() {
                        pendingOpens.add(new String[]{ id, name });
                        drainPendingOpens();
                    }
                });
            }
        }).start();
    }

    /** UI thread only: hands queued files to the page once it has loaded. */
    private void drainPendingOpens() {
        if (!pageReady || webView == null) return;
        while (!pendingOpens.isEmpty()) {
            String[] o = pendingOpens.remove(0);
            webView.evaluateJavascript("window.TallyBridgeOpen && TallyBridgeOpen(" + js(o[0]) + "," + js(o[1]) + ")", null);
        }
    }

    private String displayName(Uri u) {
        String name = null;
        if ("content".equals(u.getScheme())) {
            Cursor c = null;
            try {
                c = getContentResolver().query(u, new String[]{ OpenableColumns.DISPLAY_NAME }, null, null, null);
                if (c != null && c.moveToFirst()) {
                    int i = c.getColumnIndex(OpenableColumns.DISPLAY_NAME);
                    if (i >= 0) name = c.getString(i);
                }
            } catch (Exception ignored) {
            } finally {
                if (c != null) c.close();
            }
        }
        if (name == null || name.trim().isEmpty()) name = u.getLastPathSegment();
        if (name != null) name = name.replaceAll("\\p{Cntrl}", "").trim();
        if (name == null || name.isEmpty()) name = "shared.xml";
        return name;
    }

    /* ---- housekeeping -------------------------------------------------------- */

    /** Exports and Tally replies are transient: anything older than a day goes at startup. */
    private void sweepCaches() {
        final File[] dirs = { tallyCache, new File(getCacheDir(), "exports") };
        new Thread(new Runnable() {
            @Override
            public void run() {
                long cutoff = System.currentTimeMillis() - CACHE_TTL_MS;
                for (File d : dirs) {
                    File[] all = d.listFiles();
                    if (all == null) continue;
                    for (File f : all) if (f.isFile() && f.lastModified() < cutoff) f.delete();
                }
            }
        }).start();
    }

    /** Runs a snippet in the page on the UI thread; a no-op once the activity is gone. */
    private void page(final String code) {
        runOnUiThread(new Runnable() {
            @Override
            public void run() { if (webView != null) webView.evaluateJavascript(code, null); }
        });
    }

    @SuppressWarnings("deprecation")
    private void applyChrome(String bgHex, boolean lightIcons) {
        int color;
        try {
            String h = bgHex == null ? "" : bgHex.trim();
            color = Color.parseColor(h.startsWith("#") ? h : "#" + h);
        } catch (Exception e) {
            return;
        }
        if (root != null) root.setBackgroundColor(color);
        if (webView != null) webView.setBackgroundColor(color);
        // Honoured below Android 15; on 15+ ignored for gesture navigation but still used (at 80 % alpha)
        // by 3-button navigation, so it is set everywhere to keep the bar the same colour as the page.
        getWindow().setStatusBarColor(color);
        getWindow().setNavigationBarColor(color);
        WindowInsetsControllerCompat ic = WindowCompat.getInsetsController(getWindow(), root != null ? root : getWindow().getDecorView());
        ic.setAppearanceLightStatusBars(lightIcons);
        ic.setAppearanceLightNavigationBars(lightIcons);
    }

    /** Only the phone's own network: RFC1918 / link-local IPv4, localhost, or an mDNS .local name, over http(s). */
    static boolean isLanUrl(String url) {
        if (url == null) return false;
        Uri u;
        try { u = Uri.parse(url); } catch (Exception e) { return false; }
        String scheme = u.getScheme(), host = u.getHost();
        if (scheme == null || host == null) return false;
        scheme = scheme.toLowerCase(Locale.ROOT);
        host = host.toLowerCase(Locale.ROOT);
        if (!scheme.equals("http") && !scheme.equals("https")) return false;
        if (host.equals("localhost") || host.endsWith(".local")) return true;
        return host.matches("(10\\.\\d{1,3}\\.\\d{1,3}\\.\\d{1,3}|192\\.168\\.\\d{1,3}\\.\\d{1,3}|172\\.(1[6-9]|2\\d|3[01])\\.\\d{1,3}\\.\\d{1,3}|169\\.254\\.\\d{1,3}\\.\\d{1,3}|127\\.\\d{1,3}\\.\\d{1,3}\\.\\d{1,3})");
    }

    private static long copy(InputStream in, OutputStream out, long max) throws IOException {
        byte[] buf = new byte[65536];
        int n;
        long total = 0;
        while ((n = in.read(buf)) > 0) {
            total += n;
            if (total > max) throw new IOException("File larger than " + (max >> 20) + " MB");
            out.write(buf, 0, n);
        }
        return total;
    }

    private static void close(Closeable c) {
        if (c != null) try { c.close(); } catch (IOException ignored) { }
    }

    private static String safeName(String name) {
        String safe = name == null ? "" : name.replaceAll("[\\\\/:*?\"<>|\\p{Cntrl}]", "_").trim();
        if (safe.isEmpty() || safe.equals(".") || safe.equals("..")) safe = "export";
        return safe;
    }

    private static File uniqueFile(File dir, String name) {
        File f = new File(dir, name);
        if (!f.exists()) return f;
        int dot = name.lastIndexOf('.');
        String base = dot > 0 ? name.substring(0, dot) : name, ext = dot > 0 ? name.substring(dot) : "";
        for (int i = 1; i < 1000; i++) {
            f = new File(dir, base + " (" + i + ")" + ext);
            if (!f.exists()) return f;
        }
        return new File(dir, base + "-" + System.currentTimeMillis() + ext);
    }

    /** Android 10+: a visible file under Downloads/TallyViewer through MediaStore. Returns the shown path, or null on failure. */
    @RequiresApi(29)
    private String saveToDownloads(String safe, String mime, byte[] data) {
        Uri u = null;
        try {
            ContentValues v = new ContentValues();
            v.put(MediaStore.Downloads.DISPLAY_NAME, safe);
            v.put(MediaStore.Downloads.MIME_TYPE, mime);
            v.put(MediaStore.Downloads.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS + "/TallyViewer");
            v.put(MediaStore.Downloads.IS_PENDING, 1);
            u = getContentResolver().insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, v);
            if (u == null) return null;
            OutputStream os = getContentResolver().openOutputStream(u);
            if (os == null) throw new IOException("Cannot open output");
            try { os.write(data); } finally { os.close(); }
            ContentValues done = new ContentValues();
            done.put(MediaStore.Downloads.IS_PENDING, 0);
            getContentResolver().update(u, done, null, null);
            String actual = safe; // MediaStore renames duplicates ("x (1).pdf"); report what it chose
            Cursor c = getContentResolver().query(u, new String[]{ MediaStore.Downloads.DISPLAY_NAME }, null, null, null);
            if (c != null) {
                try { if (c.moveToFirst() && !c.isNull(0)) actual = c.getString(0); } finally { c.close(); }
            }
            return "Downloads/TallyViewer/" + actual;
        } catch (Exception e) {
            if (u != null) try { getContentResolver().delete(u, null, null); } catch (Exception ignored) { }
            return null;
        }
    }

    /** Android 7-9 (and MediaStore failures): the app's own Download folder, which needs no permission and survives cache trims. */
    private String saveToAppDownloads(String safe, byte[] data) throws IOException {
        File ext = getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS);
        File dir = ext != null ? ext : new File(getFilesDir(), "Download");
        dir.mkdirs();
        File f = uniqueFile(dir, safe);
        FileOutputStream fo = new FileOutputStream(f);
        try { fo.write(data); } finally { fo.close(); }
        return ext != null ? "Android/data/" + getPackageName() + "/files/Download/" + f.getName() : f.getAbsolutePath();
    }

    /** Exposed to the page as window.TallyBridge. */
    private class TallyBridge {
        /** Bridge API level: "2" adds setSecure, setChrome, TallyBridgeOpen, TVBack and TVRelock. */
        @JavascriptInterface
        public String version() { return "2"; }

        /**
         * POST xml to url (TallyPrime on the LAN), save the reply as cache/<id>.xml and
         * call window.TallyBridgeDone(id, ok, idOrError) on the page. Only LAN hosts are contacted.
         */
        @JavascriptInterface
        public void request(final String id, final String url, final String xml) {
            if (id == null || !id.matches(ID_RE)) return;
            if (!isLanUrl(url)) {
                page("window.TallyBridgeDone && window.TallyBridgeDone(" + js(id) + ",false," + js("Only Wi-Fi/LAN addresses are allowed") + ")");
                return;
            }
            new Thread(new Runnable() {
                @Override
                public void run() {
                    boolean ok = false;
                    String result;
                    HttpURLConnection c = null;
                    File f = new File(tallyCache, id + ".xml");
                    try {
                        c = (HttpURLConnection) new URL(url).openConnection();
                        c.setInstanceFollowRedirects(false); // a redirect could point off the LAN
                        c.setConnectTimeout(15000);
                        c.setReadTimeout(900000);
                        c.setRequestMethod("POST");
                        c.setDoOutput(true);
                        c.setRequestProperty("Content-Type", "text/xml; charset=utf-8");
                        byte[] body = (xml == null ? "" : xml).getBytes(StandardCharsets.UTF_8);
                        c.setFixedLengthStreamingMode(body.length);
                        OutputStream os = c.getOutputStream();
                        os.write(body);
                        os.close();
                        int code = c.getResponseCode();
                        if (code >= 300) {
                            result = "Tally answered HTTP " + code;
                        } else {
                            InputStream in = c.getInputStream();
                            FileOutputStream fo = new FileOutputStream(f);
                            try { if (in != null) copy(in, fo, MAX_BYTES); } finally { fo.close(); }
                            ok = true;
                            result = id;
                        }
                    } catch (Exception e) {
                        result = e.getClass().getSimpleName() + ": " + e.getMessage();
                    } finally {
                        if (c != null) c.disconnect();
                    }
                    if (!ok) f.delete();
                    page("window.TallyBridgeDone && window.TallyBridgeDone(" + js(id) + "," + ok + "," + js(result) + ")");
                }
            }).start();
        }

        @JavascriptInterface
        public void discard(String id) {
            if (id == null || !id.matches(ID_RE)) return;
            new File(tallyCache, id + ".xml").delete();
            File[] all = tallyCache.listFiles();
            if (all != null) for (File f : all) if (f.getName().startsWith(id + "-")) f.delete();
        }

        /**
         * Saves an export (base64 bytes): Downloads/TallyViewer on Android 10+, the app's own Download
         * folder on older phones. Save only; sharing is shareFile(). Calls window.TallyBridgeSaved(name, ok, whereOrError).
         */
        @JavascriptInterface
        public void saveFile(final String name, final String mime, final String b64) {
            new Thread(new Runnable() {
                @Override
                public void run() {
                    String safe = safeName(name);
                    try {
                        byte[] data = Base64.decode(b64 == null ? "" : b64, Base64.DEFAULT);
                        String type = (mime == null || mime.isEmpty()) ? "application/octet-stream" : mime;
                        String where = Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q ? saveToDownloads(safe, type, data) : null;
                        if (where == null) where = saveToAppDownloads(safe, data);
                        page("window.TallyBridgeSaved && window.TallyBridgeSaved(" + js(name) + ",true," + js(where) + ")");
                    } catch (Throwable e) { // incl. OutOfMemoryError on a huge payload: report it instead of killing the app
                        page("window.TallyBridgeSaved && window.TallyBridgeSaved(" + js(name) + ",false," + js(e.getClass().getSimpleName() + ": " + e.getMessage()) + ")");
                    }
                }
            }).start();
        }

        /**
         * Shares an export directly to an app (e.g. WhatsApp), optionally to one phone number.
         * target: "whatsapp" or "" for the system chooser. Calls window.TallyBridgeSaved(name, ok, info).
         */
        @JavascriptInterface
        public void shareFile(final String name, final String mime, final String b64, final String target, final String phone, final String text) {
            new Thread(new Runnable() {
                @Override
                public void run() {
                    String safe = safeName(name);
                    try {
                        File dir = new File(getCacheDir(), "exports");
                        dir.mkdirs();
                        File f = new File(dir, safe);
                        if (b64 != null && !b64.isEmpty()) {
                            FileOutputStream fo = new FileOutputStream(f);
                            try { fo.write(Base64.decode(b64, Base64.DEFAULT)); } finally { fo.close(); }
                        }
                        final Uri share = (b64 != null && !b64.isEmpty()) ? FileProvider.getUriForFile(MainActivity.this, getPackageName() + ".files", f) : null;
                        final String fSafe = safe;
                        runOnUiThread(new Runnable() {
                            @Override
                            public void run() {
                                Intent send = new Intent(Intent.ACTION_SEND);
                                send.setType(share == null ? "text/plain" : (mime == null || mime.isEmpty()) ? "*/*" : mime);
                                if (share != null) send.putExtra(Intent.EXTRA_STREAM, share);
                                if (text != null && !text.isEmpty()) send.putExtra(Intent.EXTRA_TEXT, text);
                                send.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
                                String pkg = null;
                                if ("whatsapp".equals(target)) {
                                    if (isInstalled("com.whatsapp")) pkg = "com.whatsapp";
                                    else if (isInstalled("com.whatsapp.w4b")) pkg = "com.whatsapp.w4b";
                                }
                                if (pkg != null) {
                                    send.setPackage(pkg);
                                    String digits = phone == null ? "" : phone.replaceAll("[^0-9]", "");
                                    if (digits.length() == 10) digits = "91" + digits;
                                    if (digits.length() >= 11) send.putExtra("jid", digits + "@s.whatsapp.net");
                                }
                                String info = pkg != null ? "Opened " + (pkg.endsWith("w4b") ? "WhatsApp Business" : "WhatsApp") : "WhatsApp not installed - choose an app";
                                if (webView != null) webView.evaluateJavascript("window.TallyBridgeSaved && window.TallyBridgeSaved(" + js(name) + ",true," + js(info) + ")", null);
                                try { startActivity(pkg != null ? send : Intent.createChooser(send, "Share " + fSafe)); }
                                catch (Exception e) { try { send.setPackage(null); startActivity(Intent.createChooser(send, "Share " + fSafe)); } catch (Exception ignored) { } }
                            }
                        });
                    } catch (Throwable e) { // incl. OutOfMemoryError on a huge payload: report it instead of killing the app
                        page("window.TallyBridgeSaved && window.TallyBridgeSaved(" + js(name) + ",false," + js(e.getClass().getSimpleName() + ": " + e.getMessage()) + ")");
                    }
                }
            }).start();
        }

        /**
         * Opens the system folder picker. The .1800 files Tally Viewer needs are copied to
         * cache/<id>-<name> and window.TallyBridgeFolder(id, ok, "name|name|...") is called.
         */
        @JavascriptInterface
        public void pickFolder(final String id) {
            if (id == null || !id.matches(ID_RE)) return;
            runOnUiThread(new Runnable() {
                @Override
                public void run() {
                    pendingFolderId = id;
                    Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT_TREE);
                    intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
                    try { startActivityForResult(intent, FOLDER_PICKER); }
                    catch (Exception e) { pendingFolderId = null; folderDone(id, false, "Folder picker not available"); }
                }
            });
        }

        /** Blocks screenshots and the recents thumbnail; the page turns it on while a PIN is set. */
        @JavascriptInterface
        public void setSecure(final boolean on) {
            runOnUiThread(new Runnable() {
                @Override
                public void run() {
                    if (on) getWindow().addFlags(WindowManager.LayoutParams.FLAG_SECURE);
                    else getWindow().clearFlags(WindowManager.LayoutParams.FLAG_SECURE);
                }
            });
        }

        /** Matches the native chrome to the page theme: the colour behind the bars and dark/light bar icons. */
        @JavascriptInterface
        public void setChrome(final String bgHex, final boolean lightIcons) {
            runOnUiThread(new Runnable() {
                @Override
                public void run() { applyChrome(bgHex, lightIcons); }
            });
        }
    }

    private boolean isInstalled(String pkg) {
        try { getPackageManager().getPackageInfo(pkg, 0); return true; } catch (Exception e) { return false; }
    }

    /** JS string literal: escapes quotes, backslashes, control characters and the U+2028/2029 line separators. */
    private static String js(String s) {
        if (s == null) s = "";
        StringBuilder b = new StringBuilder("\"");
        for (int i = 0; i < s.length(); i++) {
            char ch = s.charAt(i);
            if (ch == '"' || ch == '\\') b.append('\\').append(ch);
            else if (ch < 0x20 || ch == ' ' || ch == ' ') b.append(String.format(Locale.ROOT, "\\u%04x", (int) ch));
            else b.append(ch);
        }
        return b.append('"').toString();
    }

    private void folderDone(final String id, final boolean ok, final String result) {
        page("window.TallyBridgeFolder && window.TallyBridgeFolder(" + js(id) + "," + ok + "," + js(result) + ")");
    }

    private static boolean isTallyFile(String name) {
        String l = name.toLowerCase(Locale.ROOT);
        return l.equals("manager.1800") || l.equals("tranmgr.1800") || l.equals("company.1800");
    }

    /** Copies the Tally files found directly in the folder, or in its immediate sub-folders (a whole Data directory). */
    private void copyTallyFolder(final String id, final Uri tree) {
        new Thread(new Runnable() {
            @Override
            public void run() {
                StringBuilder names = new StringBuilder();
                try {
                    String rootId = DocumentsContract.getTreeDocumentId(tree);
                    int direct = copyDir(id, tree, rootId, "", names);
                    if (direct == 0) {
                        Uri children = DocumentsContract.buildChildDocumentsUriUsingTree(tree, rootId);
                        Cursor c = getContentResolver().query(children, new String[]{ DocumentsContract.Document.COLUMN_DOCUMENT_ID, DocumentsContract.Document.COLUMN_DISPLAY_NAME, DocumentsContract.Document.COLUMN_MIME_TYPE }, null, null, null);
                        if (c != null) {
                            while (c.moveToNext()) {
                                if (!DocumentsContract.Document.MIME_TYPE_DIR.equals(c.getString(2))) continue;
                                String sub = c.getString(1);
                                if (sub == null || !sub.matches("[A-Za-z0-9_. -]{1,40}")) continue;
                                copyDir(id, tree, c.getString(0), sub, names);
                            }
                            c.close();
                        }
                    }
                    folderDone(id, true, names.toString());
                } catch (Exception e) {
                    folderDone(id, false, e.getClass().getSimpleName() + ": " + e.getMessage());
                }
            }
        }).start();
    }

    private int copyDir(String id, Uri tree, String docId, String sub, StringBuilder names) throws Exception {
        int copied = 0;
        Uri children = DocumentsContract.buildChildDocumentsUriUsingTree(tree, docId);
        Cursor c = getContentResolver().query(children, new String[]{ DocumentsContract.Document.COLUMN_DOCUMENT_ID, DocumentsContract.Document.COLUMN_DISPLAY_NAME }, null, null, null);
        if (c == null) return 0;
        while (c.moveToNext()) {
            String childId = c.getString(0), name = c.getString(1);
            if (name == null || !isTallyFile(name)) continue;
            Uri doc = DocumentsContract.buildDocumentUriUsingTree(tree, childId);
            InputStream in = getContentResolver().openInputStream(doc);
            if (in == null) continue;
            String prefix = sub.isEmpty() ? "" : sub.replace('/', '_') + "-";
            File out = new File(tallyCache, id + "-" + prefix + name);
            FileOutputStream fo = new FileOutputStream(out);
            try { copy(in, fo, MAX_BYTES); } finally { fo.close(); in.close(); }
            if (names.length() > 0) names.append('|');
            names.append(sub.isEmpty() ? name : sub + "/" + name);
            copied++;
        }
        c.close();
        return copied;
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        if (requestCode == FOLDER_PICKER) {
            String id = pendingFolderId; pendingFolderId = null;
            if (id == null) return;
            if (resultCode == RESULT_OK && data != null && data.getData() != null) copyTallyFolder(id, data.getData());
            else folderDone(id, false, "");
            return;
        }
        if (requestCode != FILE_CHOOSER || pendingFileCallback == null) { super.onActivityResult(requestCode, resultCode, data); return; }
        Uri[] result = null;
        if (resultCode == RESULT_OK && data != null) {
            if (data.getClipData() != null) {
                int n = data.getClipData().getItemCount();
                result = new Uri[n];
                for (int i = 0; i < n; i++) result[i] = data.getClipData().getItemAt(i).getUri();
            } else if (data.getData() != null) {
                result = new Uri[]{ data.getData() };
            }
        }
        pendingFileCallback.onReceiveValue(result);
        pendingFileCallback = null;
    }

    @Override
    protected void onResume() {
        super.onResume();
        // The page decides whether it was hidden long enough to ask for the PIN again.
        if (webView != null) webView.evaluateJavascript("window.TVRelock && TVRelock()", null);
    }

    @Override
    protected void onSaveInstanceState(Bundle outState) {
        super.onSaveInstanceState(outState);
        if (webView != null) webView.saveState(outState);
        outState.putString("pendingFolderId", pendingFolderId);
    }

    @Override
    protected void onDestroy() {
        if (Build.VERSION.SDK_INT >= 33) unregisterBackCallback();
        if (webView != null) {
            if (root != null) root.removeView(webView);
            webView.destroy();
            webView = null;
        }
        super.onDestroy();
    }
}
