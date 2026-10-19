import { Capacitor, registerPlugin } from "@capacitor/core";

/**
 * Opens a URL outside the app shell. Capacitor's Android WebView does not
 * support `window.open(url, "_blank")` (there's no multi-window support),
 * so on native platforms this silently did nothing — e.g. the WhatsApp
 * buttons never launched anything. `@capacitor/browser`'s Browser.open()
 * uses a native Custom Tabs sheet, which correctly hands off to installed
 * apps like WhatsApp for verified links (wa.me). On the web it falls back
 * to a normal new tab.
 */
export async function openExternalUrl(url: string) {
  // On the web, open synchronously inside the click handler: awaiting the
  // dynamic import first loses the user gesture and the popup gets blocked.
  if (!Capacitor.isNativePlatform()) {
    if (!window.open(url, "_blank", "noopener,noreferrer")) {
      window.location.href = url;
    }
    return;
  }
  try {
    const { Browser } = await import("@capacitor/browser");
    await Browser.open({ url });
  } catch {
    window.open(url, "_blank");
  }
}

// Native plugin (android/.../ExternalBrowserPlugin.java) that opens a URL in
// the full default browser via an ACTION_VIEW intent.
const ExternalBrowser = registerPlugin<{ openUrl(options: { url: string }): Promise<void> }>("ExternalBrowser");

/**
 * Opens a URL in the device's full browser (a real Chrome tab), not the
 * in-app Custom Tab sheet. Needed for APK downloads: a Custom Tab downloads
 * all the bytes but never finishes the file, leaving it stuck at 100%.
 * Builds that predate the native plugin (and the web) fall back to
 * openExternalUrl.
 */
export async function openInSystemBrowser(url: string) {
  if (Capacitor.isNativePlatform() && Capacitor.isPluginAvailable("ExternalBrowser")) {
    try {
      await ExternalBrowser.openUrl({ url });
      return;
    } catch (err) {
      console.warn("[openInSystemBrowser] Native open failed, falling back:", err);
    }
  }
  await openExternalUrl(url);
}

export function openWhatsApp(mobile: string, message?: string) {
  let digits = (mobile || "").replace(/\D/g, "").replace(/^0+/, "");
  // wa.me needs the country code; bare 10-digit numbers are Indian.
  if (digits.length === 10) digits = `91${digits}`;
  const text = message ? `?text=${encodeURIComponent(message)}` : "";
  return openExternalUrl(`https://wa.me/${digits}${text}`);
}
