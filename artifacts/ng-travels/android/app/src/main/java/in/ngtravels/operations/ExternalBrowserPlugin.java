package in.ngtravels.operations;

import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.net.Uri;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Opens a URL in the device's real default browser (a full Chrome tab) via
 * a plain ACTION_VIEW intent. @capacitor/browser opens a Chrome Custom Tab
 * instead, and Custom Tabs can't finish an APK download — it reaches 100%
 * (e.g. "5.58 MB / 5.58 MB") and never completes — so the app-update
 * download has to go through the full browser.
 */
@CapacitorPlugin(name = "ExternalBrowser")
public class ExternalBrowserPlugin extends Plugin {

    @PluginMethod
    public void openUrl(PluginCall call) {
        String url = call.getString("url");
        if (url == null || url.isEmpty()) {
            call.reject("url is required");
            return;
        }
        try {
            Intent intent = new Intent(Intent.ACTION_VIEW, Uri.parse(url));
            intent.addCategory(Intent.CATEGORY_BROWSABLE);
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getActivity().startActivity(intent);
            call.resolve();
        } catch (ActivityNotFoundException e) {
            call.reject("No browser available to open the link", e);
        }
    }
}
