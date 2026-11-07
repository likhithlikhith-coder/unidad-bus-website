package com.unidad.tallyviewer;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.content.Intent;
import android.net.Uri;
import android.provider.DocumentsContract;
import android.database.Cursor;
import android.content.ContentValues;
import android.os.Build;
import android.os.Environment;
import android.provider.MediaStore;
import android.util.Base64;
import androidx.core.content.FileProvider;
import android.os.Bundle;
import android.view.ViewGroup;
import android.webkit.JavascriptInterface;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import androidx.webkit.ServiceWorkerClientCompat;
import androidx.webkit.ServiceWorkerControllerCompat;
import androidx.webkit.WebViewAssetLoader;
import androidx.webkit.WebViewFeature;

import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;

/**
 * Thin native shell around the Tally Viewer web app.
 *
 * The web app is bundled in assets/ and served from https://appassets.androidplatform.net
 * through WebViewAssetLoader. That gives it a proper secure origin, so IndexedDB,
 * Web Workers and the service worker all work exactly as they do in Chrome.
 *
 * TallyBridge lets the page talk to TallyPrime's XML server on the local network
 * (port 9000). The response is written to the app cache and served back to the
 * page through the asset loader, so even 100 MB exports never pass through a
 * JavaScript string.
 */
public class MainActivity extends Activity {
    private static final String START_URL = "https://appassets.androidplatform.net/assets/index.html";
    private static final int FILE_CHOOSER = 1001;
    private static final int FOLDER_PICKER = 1002;
    private String pendingFolderId;

    private WebView webView;
    private ValueCallback<Uri[]> pendingFileCallback;
    private File tallyCache;

    @SuppressLint("SetJavaScriptEnabled")
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        tallyCache = new File(getCacheDir(), "tally");
        tallyCache.mkdirs();

        webView = new WebView(this);
        webView.setLayoutParams(new ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        setContentView(webView);

        WebSettings s = webView.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setAllowFileAccess(false);
        s.setAllowContentAccess(true);
        s.setMediaPlaybackRequiresUserGesture(true);
        s.setCacheMode(WebSettings.LOAD_DEFAULT);
        s.setUserAgentString(s.getUserAgentString() + " TallyViewerApp/1.1");

        final WebViewAssetLoader loader = new WebViewAssetLoader.Builder()
                .addPathHandler("/assets/", new WebViewAssetLoader.AssetsPathHandler(this))
                .addPathHandler("/cache/", new WebViewAssetLoader.InternalStoragePathHandler(this, tallyCache))
                .build();

        webView.setWebViewClient(new WebViewClient() {
            @Override
            public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                return loader.shouldInterceptRequest(request.getUrl());
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri u = request.getUrl();
                if ("appassets.androidplatform.net".equals(u.getHost())) return false;
                try { startActivity(new Intent(Intent.ACTION_VIEW, u)); } catch (Exception ignored) { }
                return true;
            }
        });

        if (WebViewFeature.isFeatureSupported(WebViewFeature.SERVICE_WORKER_BASIC_USAGE)) {
            ServiceWorkerControllerCompat.getInstance().setServiceWorkerClient(new ServiceWorkerClientCompat() {
                @Override
                public WebResourceResponse shouldInterceptRequest(WebResourceRequest request) {
                    return loader.shouldInterceptRequest(request.getUrl());
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

        if (savedInstanceState != null) webView.restoreState(savedInstanceState);
        else webView.loadUrl(START_URL);
    }

    /** Exposed to the page as window.TallyBridge. */
    private class TallyBridge {
        @JavascriptInterface
        public String version() { return "1"; }

        /**
         * POST xml to url (TallyPrime on the LAN), save the reply as cache/<id>.xml and
         * call window.TallyBridgeDone(id, ok, idOrError) on the page.
         */
        @JavascriptInterface
        public void request(final String id, final String url, final String xml) {
            if (!id.matches("[A-Za-z0-9_-]{1,64}")) return;
            new Thread(new Runnable() {
                @Override
                public void run() {
                    boolean ok = false;
                    String result;
                    HttpURLConnection c = null;
                    try {
                        c = (HttpURLConnection) new URL(url).openConnection();
                        c.setConnectTimeout(15000);
                        c.setReadTimeout(900000);
                        c.setRequestMethod("POST");
                        c.setDoOutput(true);
                        c.setRequestProperty("Content-Type", "text/xml; charset=utf-8");
                        byte[] body = xml.getBytes(StandardCharsets.UTF_8);
                        c.setFixedLengthStreamingMode(body.length);
                        OutputStream os = c.getOutputStream();
                        os.write(body);
                        os.close();
                        int code = c.getResponseCode();
                        InputStream in = code >= 400 ? c.getErrorStream() : c.getInputStream();
                        File f = new File(tallyCache, id + ".xml");
                        FileOutputStream fo = new FileOutputStream(f);
                        byte[] buf = new byte[65536];
                        int n;
                        long total = 0;
                        if (in != null) while ((n = in.read(buf)) > 0) { fo.write(buf, 0, n); total += n; }
                        fo.close();
                        if (code >= 400) result = "Tally answered HTTP " + code;
                        else { ok = true; result = id; }
                    } catch (Exception e) {
                        result = e.getClass().getSimpleName() + ": " + e.getMessage();
                    } finally {
                        if (c != null) c.disconnect();
                    }
                    final boolean fOk = ok;
                    final String fResult = result;
                    runOnUiThread(new Runnable() {
                        @Override
                        public void run() {
                            webView.evaluateJavascript("window.TallyBridgeDone && window.TallyBridgeDone(" + js(id) + "," + fOk + "," + js(fResult) + ")", null);
                        }
                    });
                }
            }).start();
        }

        @JavascriptInterface
        public void discard(String id) {
            if (!id.matches("[A-Za-z0-9_-]{1,64}")) return;
            new File(tallyCache, id + ".xml").delete();
            File[] all = tallyCache.listFiles();
            if (all != null) for (File f : all) if (f.getName().startsWith(id + "-")) f.delete();
        }

        /**
         * Saves an export (base64 bytes) to Downloads (Android 10+) and offers the share sheet.
         * Calls window.TallyBridgeSaved(name, ok, whereOrError).
         */
        @JavascriptInterface
        public void saveFile(final String name, final String mime, final String b64) {
            new Thread(new Runnable() {
                @Override
                public void run() {
                    String safe = name.replaceAll("[\\\\/:*?\"<>|\\p{Cntrl}]", "_");
                    if (safe.isEmpty()) safe = "export";
                    try {
                        byte[] data = Base64.decode(b64, Base64.DEFAULT);
                        File dir = new File(getCacheDir(), "exports");
                        dir.mkdirs();
                        File f = new File(dir, safe);
                        FileOutputStream fo = new FileOutputStream(f);
                        fo.write(data);
                        fo.close();
                        String where = "";
                        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                            try {
                                ContentValues v = new ContentValues();
                                v.put(MediaStore.Downloads.DISPLAY_NAME, safe);
                                v.put(MediaStore.Downloads.MIME_TYPE, mime);
                                v.put(MediaStore.Downloads.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS + "/TallyViewer");
                                Uri u = getContentResolver().insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, v);
                                if (u != null) {
                                    OutputStream os = getContentResolver().openOutputStream(u);
                                    if (os != null) { os.write(data); os.close(); where = "Downloads/TallyViewer/" + safe; }
                                }
                            } catch (Exception ignored) { }
                        }
                        final Uri share = FileProvider.getUriForFile(MainActivity.this, getPackageName() + ".files", f);
                        final String fWhere = where, fSafe = safe;
                        runOnUiThread(new Runnable() {
                            @Override
                            public void run() {
                                webView.evaluateJavascript("window.TallyBridgeSaved && window.TallyBridgeSaved(" + js(name) + ",true," + js(fWhere) + ")", null);
                                Intent send = new Intent(Intent.ACTION_SEND);
                                send.setType(mime);
                                send.putExtra(Intent.EXTRA_STREAM, share);
                                send.putExtra(Intent.EXTRA_SUBJECT, fSafe);
                                send.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
                                try { startActivity(Intent.createChooser(send, "Share " + fSafe)); } catch (Exception ignored) { }
                            }
                        });
                    } catch (final Exception e) {
                        runOnUiThread(new Runnable() {
                            @Override
                            public void run() {
                                webView.evaluateJavascript("window.TallyBridgeSaved && window.TallyBridgeSaved(" + js(name) + ",false," + js(e.getClass().getSimpleName() + ": " + e.getMessage()) + ")", null);
                            }
                        });
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
            if (!id.matches("[A-Za-z0-9_-]{1,64}")) return;
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
    }

    private static String js(String s) {
        StringBuilder b = new StringBuilder("\"");
        for (int i = 0; i < s.length(); i++) {
            char ch = s.charAt(i);
            if (ch == '"' || ch == '\\') b.append('\\').append(ch);
            else if (ch < 0x20 || ch == ' ' || ch == ' ') b.append(String.format("\\u%04x", (int) ch));
            else b.append(ch);
        }
        return b.append('"').toString();
    }

    private void folderDone(final String id, final boolean ok, final String result) {
        runOnUiThread(new Runnable() {
            @Override
            public void run() {
                webView.evaluateJavascript("window.TallyBridgeFolder && window.TallyBridgeFolder(" + js(id) + "," + ok + "," + js(result) + ")", null);
            }
        });
    }

    private static boolean isTallyFile(String name) {
        String l = name.toLowerCase();
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
            byte[] buf = new byte[65536]; int n;
            while ((n = in.read(buf)) > 0) fo.write(buf, 0, n);
            fo.close(); in.close();
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
    protected void onSaveInstanceState(Bundle outState) {
        super.onSaveInstanceState(outState);
        webView.saveState(outState);
    }

    @Override
    @SuppressWarnings("deprecation")
    public void onBackPressed() {
        if (webView.canGoBack()) webView.goBack(); else super.onBackPressed();
    }

    @Override
    protected void onDestroy() {
        if (webView != null) webView.destroy();
        super.onDestroy();
    }
}
