package com.appleisland.app;

import android.app.Activity;
import android.content.ContentValues;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.provider.MediaStore;
import android.webkit.DownloadListener;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Toast;
import java.io.OutputStream;
import java.util.Base64;

public class MainActivity extends Activity {
    private WebView webView;
    private ValueCallback<Uri[]> uploadCallback;
    private static final int REQ_FILE_CHOOSER = 100;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_main);

        webView = findViewById(R.id.webView);
        WebSettings ws = webView.getSettings();
        ws.setJavaScriptEnabled(true);
        ws.setDomStorageEnabled(true);          // 启用 localStorage（App 数据存储）
        ws.setAllowFileAccess(true);
        ws.setAllowContentAccess(true);
        ws.setLoadsImagesAutomatically(true);
        ws.setMediaPlaybackRequiresUserGesture(false);
        // 让 viewport meta 生效，按设备宽度渲染
        ws.setUseWideViewPort(true);
        ws.setSupportZoom(false);

        webView.setWebViewClient(new WebViewClient());

        // 让网页触发的下载（如"导出完整备份"）保存到手机「下载」目录
        webView.setDownloadListener(new DownloadListener() {
            @Override
            public void onDownloadStart(String url, String userAgent, String contentDisposition,
                                        String mimetype, long contentLength) {
                try {
                    String filename = "苹果岛备份.json";
                    if (contentDisposition != null && contentDisposition.contains("filename=")) {
                        filename = contentDisposition.split("filename=")[1]
                                .replace("\"", "").replace("'", "").trim();
                    }
                    if (url.startsWith("data:")) {
                        int comma = url.indexOf(',');
                        String meta = url.substring(5, comma);     // 例如 application/json;base64
                        String payload = url.substring(comma + 1);
                        byte[] bytes;
                        if (meta.toLowerCase().contains("base64")) {
                            bytes = Base64.getDecoder().decode(payload);
                        } else {
                            bytes = java.net.URLDecoder.decode(payload, "UTF-8").getBytes("UTF-8");
                        }
                        ContentValues values = new ContentValues();
                        values.put(MediaStore.Downloads.DISPLAY_NAME, filename);
                        values.put(MediaStore.Downloads.MIME_TYPE,
                                (mimetype != null && !mimetype.isEmpty()) ? mimetype : "application/json");
                        Uri uri = getContentResolver()
                                .insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values);
                        if (uri != null) {
                            OutputStream os = getContentResolver().openOutputStream(uri);
                            os.write(bytes);
                            os.close();
                            Toast.makeText(MainActivity.this,
                                    "已保存到下载目录：" + filename, Toast.LENGTH_LONG).show();
                            return;
                        }
                    }
                    // 其他类型（非 data:）交给系统处理
                    Intent intent = new Intent(Intent.ACTION_VIEW);
                    intent.setData(Uri.parse(url));
                    startActivity(intent);
                } catch (Exception e) {
                    Toast.makeText(MainActivity.this,
                            "下载失败：" + e.getMessage(), Toast.LENGTH_LONG).show();
                }
            }
        });

        webView.setWebChromeClient(new WebChromeClient() {
            // 让网页里的 <input type="file"> 能选择照片（兼容 Android 5+）
            @Override
            public boolean onShowFileChooser(WebView wv, ValueCallback<Uri[]> filePathCallback,
                                            FileChooserParams fileChooserParams) {
                uploadCallback = filePathCallback;
                Intent intent = new Intent(Intent.ACTION_GET_CONTENT);
                intent.addCategory(Intent.CATEGORY_OPENABLE);
                intent.setType("image/*");
                try {
                    startActivityForResult(
                            Intent.createChooser(intent, "选择照片"), REQ_FILE_CHOOSER);
                } catch (android.content.ActivityNotFoundException e) {
                    uploadCallback = null;
                }
                return true;
            }
        });

        webView.loadUrl("file:///android_asset/www/index.html");
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode == REQ_FILE_CHOOSER) {
            Uri[] result = null;
            if (resultCode == Activity.RESULT_OK && data != null && data.getData() != null) {
                result = new Uri[]{ data.getData() };
            }
            if (uploadCallback != null) {
                uploadCallback.onReceiveValue(result);
                uploadCallback = null;
            }
        }
    }

    @Override
    public void onBackPressed() {
        if (webView.canGoBack()) {
            webView.goBack();
        } else {
            super.onBackPressed();
        }
    }
}
