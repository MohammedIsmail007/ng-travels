import React, { useState } from "react";
import { User, Phone, Mail, Award, ShieldCheck, CheckCircle2, Clock, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useInstalledVersion } from "@/hooks/useInstalledVersion";

interface DriverProfilePageProps {
  driver?: any;
  onUpdateAvailability?: (availability: string) => void | Promise<void>;
}

export const DriverProfilePage: React.FC<DriverProfilePageProps> = ({
  driver,
  onUpdateAvailability,
}) => {
  const [pendingAvailability, setPendingAvailability] = useState<string | null>(null);
  const installedVersion = useInstalledVersion();

  const handleAvailabilityClick = async (availability: string) => {
    if (!onUpdateAvailability || pendingAvailability) return;
    setPendingAvailability(availability);
    try {
      await onUpdateAvailability(availability);
    } finally {
      setPendingAvailability(null);
    }
  };

  if (!driver) {
    return (
      <div className="bg-card/60 p-8 rounded-2xl border border-border text-center text-muted-foreground text-xs space-y-2">
        <User className="w-8 h-8 text-muted-foreground mx-auto" />
        <p>No driver profile details found.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-base font-bold text-foreground flex items-center gap-2">
          <User className="w-5 h-5 text-amber-700 dark:text-amber-400" />
          Driver Partner Profile
        </h1>
        <p className="text-[11px] text-muted-foreground mt-0.5">
          Commercial badge credentials, license validation, and duty status.
        </p>
      </div>

      <div className="bg-card/90 border border-border rounded-2xl p-5 text-center space-y-3 shadow-lg">
        <div className="w-16 h-16 rounded-full bg-amber-400 text-zinc-950 font-black text-xl flex items-center justify-center mx-auto shadow-lg shadow-amber-400/20">
          {driver.name?.slice(0, 2).toUpperCase()}
        </div>
        <div>
          <h2 className="text-lg font-extrabold text-foreground">{driver.name}</h2>
          <span className="font-mono text-xs text-amber-700 dark:text-amber-400 font-bold">{driver.driverCode}</span>
        </div>
        <div className="inline-flex items-center gap-1 bg-amber-100 dark:bg-amber-400/10 text-amber-700 dark:text-amber-300 border border-amber-300 dark:border-amber-400/30 px-3 py-1 rounded-full text-xs font-bold">
          ★ {driver.rating || "4.9"} Star Pilot
        </div>
      </div>

      <div className="bg-card/70 border border-border rounded-2xl p-4 space-y-3 text-xs">
        <h3 className="font-bold text-foreground uppercase tracking-wider text-[10px]">Credentials</h3>
        <div className="space-y-2 text-muted-foreground">
          <div className="flex justify-between">
            <span>Contact Mobile:</span>
            <span className="text-foreground font-medium">{driver.mobile}</span>
          </div>
          <div className="flex justify-between">
            <span>Commercial License:</span>
            <span className="font-mono text-foreground">{driver.licenseNumber}</span>
          </div>
          <div className="flex justify-between">
            <span>License Expiry:</span>
            <span className="text-foreground">{driver.licenseExpiry}</span>
          </div>
          <div className="flex justify-between">
            <span>Emergency Contact:</span>
            <span className="text-foreground">{driver.emergencyContact}</span>
          </div>
          {installedVersion && (
            <div className="flex justify-between">
              <span>App Version:</span>
              <span className="font-mono text-foreground">
                v{installedVersion.versionName} ({installedVersion.build})
              </span>
            </div>
          )}
        </div>
      </div>

      {onUpdateAvailability && (
        <div className="bg-card/70 border border-border rounded-2xl p-4 space-y-2 text-xs">
          <h3 className="font-bold text-foreground uppercase tracking-wider text-[10px]">Duty Status Switcher</h3>
          <div className="grid grid-cols-2 gap-2">
            <Button
              size="sm"
              variant={driver.availability === "available" ? "default" : "outline"}
              onClick={() => handleAvailabilityClick("available")}
              disabled={Boolean(pendingAvailability)}
              className={driver.availability === "available" ? "bg-emerald-600 text-white font-bold" : "border-border text-muted-foreground"}
            >
              {pendingAvailability === "available" ? (
                <span className="inline-flex items-center gap-1.5">
                  <Loader2 className="w-3.5 h-3.5 animate-spin" /> Updating...
                </span>
              ) : (
                "Available for Duty"
              )}
            </Button>
            <Button
              size="sm"
              variant={driver.availability === "on_leave" ? "default" : "outline"}
              onClick={() => handleAvailabilityClick("on_leave")}
              disabled={Boolean(pendingAvailability)}
              className={driver.availability === "on_leave" ? "bg-rose-600 text-white font-bold" : "border-border text-muted-foreground"}
            >
              {pendingAvailability === "on_leave" ? (
                <span className="inline-flex items-center gap-1.5">
                  <Loader2 className="w-3.5 h-3.5 animate-spin" /> Updating...
                </span>
              ) : (
                "Mark On Leave"
              )}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
};
