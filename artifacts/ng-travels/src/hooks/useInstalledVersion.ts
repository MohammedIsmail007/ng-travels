import { useEffect, useState } from "react";

export interface InstalledVersion {
  versionName: string;
  build: string;
}

// The version of the APK actually installed on this device. Null on the web,
// where there is no installed build to report.
export function useInstalledVersion(): InstalledVersion | null {
  const [installed, setInstalled] = useState<InstalledVersion | null>(null);

  useEffect(() => {
    if (!(window as any).Capacitor?.isNativePlatform?.()) return;
    let cancelled = false;
    import("@capacitor/app")
      .then(({ App }) => App.getInfo())
      .then((info) => {
        if (!cancelled) setInstalled({ versionName: info.version, build: info.build });
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  return installed;
}
