package in.ngtravels.operations;

import android.Manifest;
import android.content.pm.PackageManager;
import android.os.Build;
import android.os.Bundle;
import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    private static final int NOTIFICATION_PERMISSION_REQUEST_CODE = 1001;

    @Override
    public void onCreate(Bundle savedInstanceState) {
        // Local plugins must be registered before super.onCreate()
        registerPlugin(ExternalBrowserPlugin.class);
        super.onCreate(savedInstanceState);
        requestNotificationPermissionIfNeeded();
    }

    // Android 13+ (API 33+) blocks every notification an app tries to post,
    // including DownloadManager's own progress/complete notification for the
    // APK download link on the Settings page, unless POST_NOTIFICATIONS is
    // granted at runtime — declaring it in the manifest alone isn't enough.
    // Without this, a download silently finishes in the background but its
    // notification stays frozen showing "downloading" forever.
    private void requestNotificationPermissionIfNeeded() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            if (ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS)
                    != PackageManager.PERMISSION_GRANTED) {
                ActivityCompat.requestPermissions(
                        this,
                        new String[] { Manifest.permission.POST_NOTIFICATIONS },
                        NOTIFICATION_PERMISSION_REQUEST_CODE
                );
            }
        }
    }

    @Override
    public void onResume() {
        super.onResume();
        injectRole();
    }

    private void injectRole() {
        if (bridge != null && bridge.getWebView() != null) {
            try {
                final String role = getString(R.string.app_role);
                bridge.getWebView().post(new Runnable() {
                    @Override
                    public void run() {
                        bridge.getWebView().evaluateJavascript("window.NG_APP_ROLE = '" + role + "';", null);
                    }
                });
            } catch (Exception ignored) {}
        }
    }
}
