package vn.qrwindows.client;

import android.app.Activity;
import android.content.Intent;
import android.content.SharedPreferences;
import android.net.Uri;
import android.os.Bundle;
import android.widget.Button;
import android.widget.TextView;
import android.widget.Toast;

import androidx.annotation.Nullable;
import androidx.appcompat.app.AppCompatActivity;

import com.google.zxing.integration.android.IntentIntegrator;
import com.google.zxing.integration.android.IntentResult;

import org.json.JSONObject;

import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

public class MainActivity extends AppCompatActivity {

    private static final String PREFS = "qr_windows_prefs";
    private static final String KEY_RECEIVER_URL = "receiver_url";
    private static final int MODE_NONE = 0;
    private static final int MODE_CONNECT = 1;
    private static final int MODE_SCAN = 2;

    private final ExecutorService executor = Executors.newSingleThreadExecutor();
    private SharedPreferences prefs;
    private TextView statusText;
    private int pendingMode = MODE_NONE;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_main);

        prefs = getSharedPreferences(PREFS, MODE_PRIVATE);
        statusText = findViewById(R.id.statusText);
        Button connectButton = findViewById(R.id.connectButton);
        Button scanButton = findViewById(R.id.scanButton);

        connectButton.setOnClickListener(v -> startScanner(MODE_CONNECT));
        scanButton.setOnClickListener(v -> {
            String receiver = prefs.getString(KEY_RECEIVER_URL, "");
            if (receiver == null || receiver.isEmpty()) {
                Toast.makeText(this, "Chưa kết nối máy tính. Hãy bấm KẾT NỐI MÁY TÍNH trước.", Toast.LENGTH_LONG).show();
                return;
            }
            startScanner(MODE_SCAN);
        });

        refreshStatus();
    }

    private void startScanner(int mode) {
        pendingMode = mode;
        IntentIntegrator integrator = new IntentIntegrator(this);
        integrator.setDesiredBarcodeFormats(IntentIntegrator.ALL_CODE_TYPES);
        integrator.setPrompt(mode == MODE_CONNECT
                ? "Quét mã QR kết nối đang hiển thị trên Windows"
                : "Đưa mã QR / mã vạch vào khung hình");
        integrator.setBeepEnabled(true);
        integrator.setOrientationLocked(false);
        integrator.initiateScan();
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, @Nullable Intent data) {
        IntentResult result = IntentIntegrator.parseActivityResult(requestCode, resultCode, data);
        if (result != null) {
            if (result.getContents() == null) {
                pendingMode = MODE_NONE;
                Toast.makeText(this, "Đã hủy quét", Toast.LENGTH_SHORT).show();
                return;
            }
            String value = result.getContents().trim();
            if (pendingMode == MODE_CONNECT) {
                saveReceiver(value);
            } else if (pendingMode == MODE_SCAN) {
                sendToWindows(value);
            }
            pendingMode = MODE_NONE;
            return;
        }
        super.onActivityResult(requestCode, resultCode, data);
    }

    private void saveReceiver(String value) {
        try {
            Uri uri = Uri.parse(value);
            String scheme = uri.getScheme();
            String host = uri.getHost();
            String path = uri.getPath();
            String token = uri.getQueryParameter("token");

            boolean validScheme = "http".equalsIgnoreCase(scheme) || "https".equalsIgnoreCase(scheme);
            boolean valid = validScheme && host != null && !host.isEmpty()
                    && "/scan".equals(path) && token != null && token.length() >= 12;

            if (!valid) {
                Toast.makeText(this, "QR kết nối không hợp lệ", Toast.LENGTH_LONG).show();
                return;
            }

            prefs.edit().putString(KEY_RECEIVER_URL, value).apply();
            refreshStatus();
            Toast.makeText(this, "Đã kết nối máy tính: " + host, Toast.LENGTH_LONG).show();
        } catch (Exception e) {
            Toast.makeText(this, "Không đọc được QR kết nối", Toast.LENGTH_LONG).show();
        }
    }

    private void refreshStatus() {
        String receiver = prefs.getString(KEY_RECEIVER_URL, "");
        if (receiver == null || receiver.isEmpty()) {
            statusText.setText("Chưa kết nối máy tính");
            return;
        }
        try {
            Uri uri = Uri.parse(receiver);
            String host = uri.getHost();
            int port = uri.getPort();
            String suffix = port > 0 ? ":" + port : "";
            statusText.setText("Đã kết nối: " + host + suffix);
        } catch (Exception e) {
            statusText.setText("Đã lưu cấu hình máy tính");
        }
    }

    private void sendToWindows(String scannedText) {
        String receiver = prefs.getString(KEY_RECEIVER_URL, "");
        if (receiver == null || receiver.isEmpty()) {
            Toast.makeText(this, "Chưa kết nối máy tính", Toast.LENGTH_LONG).show();
            return;
        }

        Toast.makeText(this, "Đang gửi...", Toast.LENGTH_SHORT).show();

        executor.execute(() -> {
            HttpURLConnection conn = null;
            try {
                URL url = new URL(receiver);
                conn = (HttpURLConnection) url.openConnection();
                conn.setRequestMethod("POST");
                conn.setConnectTimeout(4000);
                conn.setReadTimeout(4000);
                conn.setDoOutput(true);
                conn.setUseCaches(false);
                conn.setRequestProperty("Content-Type", "application/json; charset=UTF-8");
                conn.setRequestProperty("Connection", "close");

                JSONObject body = new JSONObject();
                body.put("text", scannedText);
                byte[] bytes = body.toString().getBytes(StandardCharsets.UTF_8);
                conn.setFixedLengthStreamingMode(bytes.length);

                try (OutputStream os = conn.getOutputStream()) {
                    os.write(bytes);
                    os.flush();
                }

                int code = conn.getResponseCode();
                boolean ok = code >= 200 && code < 300;
                runOnUiThread(() -> Toast.makeText(
                        this,
                        ok ? "Đã gửi sang Windows" : "Windows trả lỗi HTTP " + code,
                        Toast.LENGTH_SHORT
                ).show());
            } catch (Exception e) {
                String message = e.getMessage();
                if (message == null || message.isEmpty()) {
                    message = e.getClass().getSimpleName();
                }
                final String finalMessage = message;
                runOnUiThread(() -> Toast.makeText(
                        this,
                        "Không gửi được: " + finalMessage,
                        Toast.LENGTH_LONG
                ).show());
            } finally {
                if (conn != null) {
                    conn.disconnect();
                }
            }
        });
    }

    @Override
    protected void onDestroy() {
        executor.shutdownNow();
        super.onDestroy();
    }
}
