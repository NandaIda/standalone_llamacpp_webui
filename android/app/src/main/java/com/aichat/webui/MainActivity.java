package com.aichat.webui;

import android.content.Intent;
import android.os.Bundle;
import android.webkit.WebView;
import com.getcapacitor.BridgeActivity;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;

public class MainActivity extends BridgeActivity {

    private String pendingSharedText = null;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        handleSendIntent(getIntent());
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        handleSendIntent(intent);
    }

    @Override
    public void onResume() {
        super.onResume();

        // If there's pending shared text, call the global handler function
        if (pendingSharedText != null) {
            final String textToShare = pendingSharedText;
            pendingSharedText = null;

            bridge.getWebView().postDelayed(() -> {
                try {
                    // Escape the text for JavaScript string literal
                    String escapedText = textToShare
                        .replace("\\", "\\\\")
                        .replace("\"", "\\\"")
                        .replace("\n", "\\n")
                        .replace("\r", "\\r")
                        .replace("\t", "\\t");

                    // Call the global handleSharedText function
                    String js = "if (window.handleSharedText) { window.handleSharedText(\"" + escapedText + "\"); }";
                    bridge.getWebView().evaluateJavascript(js, null);
                } catch (Exception e) {
                    e.printStackTrace();
                }
            }, 500);
        }
    }

    private void handleSendIntent(Intent intent) {
        if (Intent.ACTION_SEND.equals(intent.getAction())) {
            String type = intent.getType();
            if (type != null && type.equals("text/plain")) {
                String sharedText = intent.getStringExtra(Intent.EXTRA_TEXT);
                if (sharedText != null && !sharedText.isEmpty()) {
                    pendingSharedText = sharedText;
                }
            }
        }
    }
}
