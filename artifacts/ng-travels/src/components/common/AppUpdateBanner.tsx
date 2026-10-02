import React, { useState } from "react";
import { Download, X, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { AppUpdateInfo } from "@/hooks/useAppUpdateCheck";
import { openInSystemBrowser } from "@/lib/openExternal";

export function AppUpdateBanner({ info }: { info: AppUpdateInfo }) {
  const [dismissed, setDismissed] = useState(false);

  if (!info.updateAvailable || dismissed) return null;

  const handleDownload = async () => {
    if (!info.downloadUrl) return;
    // Full Chrome tab, not the in-app sheet — APK downloads stall at 100%
    // inside a Custom Tab.
    await openInSystemBrowser(info.downloadUrl);
  };

  return (
    <div className="fixed bottom-3 left-3 right-3 z-[100] sm:left-auto sm:right-4 sm:max-w-sm">
      <div className="bg-card border border-amber-300 dark:border-amber-500/40 rounded-2xl shadow-2xl p-4 flex items-start gap-3">
        <div className="w-9 h-9 rounded-xl bg-amber-100 dark:bg-amber-400/10 border border-amber-300 dark:border-amber-400/20 text-amber-700 dark:text-amber-400 flex items-center justify-center shrink-0">
          <Sparkles className="w-4 h-4" />
        </div>
        <div className="min-w-0 flex-1 space-y-2">
          <div>
            <div className="text-xs font-bold text-foreground">
              Update Available {info.latestVersionName ? `(v${info.latestVersionName})` : ""}
            </div>
            {info.releaseNotes && (
              <p className="text-[11px] text-muted-foreground mt-0.5">{info.releaseNotes}</p>
            )}
          </div>
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              onClick={handleDownload}
              className="h-7 text-[11px] px-2.5 bg-amber-400 hover:bg-amber-300 text-zinc-950 font-bold"
            >
              <Download className="w-3.5 h-3.5 mr-1" /> Download Update
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setDismissed(true)}
              className="h-7 text-[11px] px-2 text-muted-foreground"
            >
              Later
            </Button>
          </div>
        </div>
        <button
          onClick={() => setDismissed(true)}
          className="text-muted-foreground hover:text-foreground shrink-0"
          title="Dismiss"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
}
