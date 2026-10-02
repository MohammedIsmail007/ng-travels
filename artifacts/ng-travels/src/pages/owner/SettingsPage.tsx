import React, { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Settings, Save, CheckCircle2, Building, Phone, Mail, IndianRupee, Globe, Smartphone, ShieldCheck, Car, Loader2, Users, Plus, Ban, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { AdminUserManagementModal, CreateStaffUserData } from "@/components/admin/AdminUserManagementModal";
import { apiFetch } from "@/lib/apiFetch";
import { openInSystemBrowser } from "@/lib/openExternal";

// Fallback shown only until /api/app/version answers (or if it fails) —
// the server's CURRENT_APP_VERSION (artifacts/api-server/src/routes/ng-travels.ts)
// is the actual source of truth; re-upload the APK there after each build,
// this local fallback just needs to stay roughly current for offline/error cases.
const FALLBACK_APP_VERSION = {
  versionName: "1.3.5",
  url: "https://nihoyzdepvqkypvwpvvy.supabase.co/storage/v1/object/public/app-releases/NG-Travels.apk",
  releaseNotes: "",
};

interface SettingsPageProps {
  settings: any;
  onSaveSettings: (updated: any) => void | Promise<void>;
  staffUsers?: any[];
  staffUsersLoading?: boolean;
  onCreateStaffUser?: (data: CreateStaffUserData) => Promise<void>;
  onResetStaffPassword?: (userId: number, newPassword: string) => Promise<void>;
  onUpdateStaffUser?: (userId: number, updates: { role?: string; status?: string }) => Promise<void>;
}

export const SettingsPage: React.FC<SettingsPageProps> = ({
  settings = {},
  onSaveSettings,
  staffUsers = [],
  staffUsersLoading = false,
  onCreateStaffUser,
  onResetStaffPassword,
  onUpdateStaffUser,
}) => {
  const [company, setCompany] = useState(settings.company || "NG Travels Operations");
  const [mobile, setMobile] = useState(settings.mobile || "+91 98450 21867");
  const [email, setEmail] = useState(settings.email || "operations@ngtravels.in");
  const [defaultRate, setDefaultRate] = useState(settings.defaultRate || 18);
  const [billingDayPolicy, setBillingDayPolicy] = useState(settings.billingDayPolicy || "CALENDAR_DAYS");
  const [terms, setTerms] = useState(settings.terms || "1. Toll, parking and state permit charges are customer payable at actuals.\n2. Billing starts and ends from garage to garage.\n3. AC will be switched off while driving in hill terrain.");
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const [isStaffModalOpen, setIsStaffModalOpen] = useState(false);
  const [pendingStaffAction, setPendingStaffAction] = useState<number | null>(null);

  const { data: appVersionManifest } = useQuery<any>({
    queryKey: ["/api/app/version"],
    queryFn: async () => {
      const res = await apiFetch("/api/app/version");
      if (!res.ok) return null;
      return res.json();
    },
    staleTime: 5 * 60 * 1000,
  });
  // The Admin and Driver roles now ship as one unified APK, so both manifest
  // entries point at the same build — either one reflects the current release.
  const appVersion = appVersionManifest?.owner || appVersionManifest?.driver || FALLBACK_APP_VERSION;

  const handleToggleStaffStatus = async (staffUser: any) => {
    if (!onUpdateStaffUser || pendingStaffAction) return;
    const nextStatus = staffUser.status === "active" ? "inactive" : "active";
    setPendingStaffAction(staffUser.id);
    try {
      await onUpdateStaffUser(staffUser.id, { status: nextStatus });
    } catch (err: any) {
      alert(err.message || "Failed to update account status.");
    } finally {
      setPendingStaffAction(null);
    }
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (saving) return;
    setSaving(true);
    try {
      await onSaveSettings({
        company,
        mobile,
        email,
        defaultRate: Number(defaultRate),
        billingDayPolicy,
        terms,
      });
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6 max-w-2xl">
      <div>
        <h1 className="text-xl font-bold text-foreground flex items-center gap-2">
          <Settings className="w-5 h-5 text-amber-700 dark:text-amber-400" />
          Business Profile & Operations Configuration
        </h1>
        <p className="text-xs text-muted-foreground mt-1">
          Configure business legal name, contact desk, default commercial rates, and booking voucher terms.
        </p>
      </div>

      {/* Brand Identity Card */}
      <div className="bg-card/80 border border-border rounded-xl p-4 flex items-center gap-4 shadow-lg">
        <img
          src="/logo.png"
          alt="NG Travels Logo"
          className="w-16 h-16 rounded-xl object-contain bg-black border border-amber-300 dark:border-amber-500/40 p-1 flex-shrink-0 shadow-md shadow-amber-500/10"
        />
        <div>
          <div className="text-xs font-mono font-bold text-amber-700 dark:text-amber-400 uppercase tracking-wider">OFFICIAL BRAND ASSET</div>
          <h3 className="text-base font-bold text-foreground">NG Travels</h3>
          <p className="text-xs text-muted-foreground mt-0.5">Travel with Comfort & Safety</p>
        </div>
      </div>

      <form onSubmit={handleSave} className="space-y-4 bg-card/70 p-6 rounded-xl border border-border text-xs">
        <div>
          <label className="text-xs text-foreground font-semibold block mb-1">Company / Brand Name</label>
          <Input
            value={company}
            onChange={(e) => setCompany(e.target.value)}
            className="bg-card border-border text-xs"
          />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="text-xs text-foreground font-semibold block mb-1">Operations Contact Number</label>
            <Input
              value={mobile}
              onChange={(e) => setMobile(e.target.value)}
              className="bg-card border-border text-xs"
            />
          </div>
          <div>
            <label className="text-xs text-foreground font-semibold block mb-1">Official Support Email</label>
            <Input
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="bg-card border-border text-xs"
            />
          </div>
        </div>

        <div>
          <label className="text-xs text-foreground font-semibold block mb-1">Commercial Rate / KM (₹)</label>
          <Input
            type="number"
            value={defaultRate}
            onChange={(e) => setDefaultRate(e.target.value)}
            className="bg-card border-border text-xs font-mono font-bold text-amber-700 dark:text-amber-400 max-w-50"
          />
        </div>

        <div>
          <label className="text-xs text-foreground font-semibold block mb-1">Multi-Day Billing Policy</label>
          <select
            value={billingDayPolicy}
            onChange={(e) => setBillingDayPolicy(e.target.value)}
            className="w-full bg-card border border-border rounded-md px-3 py-2 text-xs font-mono text-foreground focus:outline-none focus:border-amber-400"
          >
            <option value="CALENDAR_DAYS">Calendar Days (e.g. 04 Sep to 06 Sep = 3 full billing days)</option>
            <option value="24_HOUR_PERIODS">24-Hour Periods (rolling 24hr blocks)</option>
          </select>
        </div>

        <div>
          <label className="text-xs text-foreground font-semibold block mb-1">Booking Terms & Customer Conditions</label>
          <Textarea
            value={terms}
            onChange={(e) => setTerms(e.target.value)}
            className="bg-card border-border text-xs font-mono"
            rows={4}
          />
        </div>

        <div className="pt-2 flex items-center justify-between">
          <Button type="submit" disabled={saving} className="bg-amber-400 hover:bg-amber-300 text-zinc-950 font-bold text-xs py-5 px-6 cursor-pointer">
            {saving ? (
              <><Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> Saving...</>
            ) : (
              <><Save className="w-3.5 h-3.5 mr-1.5" /> Save Configuration</>
            )}
          </Button>

          {saved && (
            <span className="text-emerald-700 dark:text-emerald-400 text-xs font-semibold flex items-center gap-1">
              <CheckCircle2 className="w-4 h-4" /> Settings updated successfully
            </span>
          )}
        </div>
      </form>

      {/* Standalone APK Download — hosted on Supabase Storage rather than
          served from /public: *.apk is git-ignored at the repo root, so a
          file only placed in public/ locally would never actually reach
          the deployed site. One unified app now: users pick Admin or
          Driver right on the sign-in screen after installing. */}
      <div className="space-y-3 pt-2">
        <h3 className="text-xs font-bold text-muted-foreground uppercase tracking-wider font-mono">
          Standalone Android Application (v{appVersion.versionName})
        </h3>

        <div className="bg-gradient-to-r from-amber-950/40 via-card to-card p-5 rounded-xl border border-amber-300 dark:border-amber-500/30 flex flex-col sm:flex-row sm:items-center justify-between gap-4 shadow-xl">
          <div className="space-y-1">
            <div className="inline-flex items-center gap-1.5 text-[10px] font-mono font-bold text-amber-700 dark:text-amber-400 uppercase bg-amber-100 dark:bg-amber-500/10 px-2 py-0.5 rounded border border-amber-300 dark:border-amber-500/20">
              <ShieldCheck className="w-3 h-3" /> <Car className="w-3 h-3" /> ADMIN + DRIVER APK
            </div>
            <h4 className="text-sm font-bold text-foreground">NG-Travels App</h4>
            <p className="text-xs text-muted-foreground max-w-md">
              {appVersion.releaseNotes ||
                "One app for everyone — pick Operations Admin or Driver Pilot on the sign-in screen. Full Command Desk, dispatch, live GPS radar, and revenue reports for admins; cockpit HUD, journey roster, odometer capture, and expense claims for drivers."}
            </p>
          </div>
          <Button
            onClick={() => openInSystemBrowser(appVersion.url)}
            className="bg-amber-400 hover:bg-amber-300 text-zinc-950 font-bold text-xs py-5 px-5 shadow-lg shadow-amber-400/20 flex items-center gap-2 cursor-pointer whitespace-nowrap"
          >
            <Smartphone className="w-4 h-4" /> Download NG-Travels APK
          </Button>
        </div>
      </div>

      {/* Admin & Staff Accounts */}
      {onCreateStaffUser && (
        <div className="space-y-3 pt-2">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h3 className="text-xs font-bold text-muted-foreground uppercase tracking-wider font-mono flex items-center gap-1.5">
                <Users className="w-3.5 h-3.5" /> Admin & Staff Accounts
              </h3>
              <p className="text-[11px] text-muted-foreground mt-0.5">
                Logins for co-owners, managers, dispatchers, and accountants. Driver accounts are managed separately.
              </p>
            </div>
            <Button
              size="sm"
              onClick={() => setIsStaffModalOpen(true)}
              className="bg-amber-400 hover:bg-amber-300 text-zinc-950 font-bold text-xs shrink-0"
            >
              <Plus className="w-3.5 h-3.5 mr-1" /> Add Staff Account
            </Button>
          </div>

          {staffUsersLoading && staffUsers.length === 0 ? (
            <div className="p-6 flex items-center justify-center gap-2 bg-card/50 rounded-xl border border-border text-xs text-muted-foreground">
              <Loader2 className="w-3.5 h-3.5 animate-spin" /> Loading staff accounts...
            </div>
          ) : staffUsers.length === 0 ? (
            <div className="p-6 text-center bg-card/50 rounded-xl border border-border text-xs text-muted-foreground">
              No admin or staff accounts yet — you're the only login.
            </div>
          ) : (
            <div className="bg-card/70 border border-border rounded-xl divide-y divide-border overflow-hidden">
              {staffUsers.map((u: any) => (
                <div key={u.id} className="flex items-center justify-between gap-3 p-3.5 text-xs">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-foreground truncate">{u.name}</span>
                      <span className="text-[9px] font-bold uppercase px-1.5 py-0.5 rounded bg-amber-100 dark:bg-amber-500/20 text-amber-700 dark:text-amber-300 border border-amber-300 dark:border-amber-500/30 shrink-0">
                        {u.role}
                      </span>
                      {u.status === "inactive" && (
                        <span className="text-[9px] font-bold uppercase px-1.5 py-0.5 rounded bg-rose-100 dark:bg-rose-500/20 text-rose-700 dark:text-rose-400 border border-rose-300 dark:border-rose-500/30 shrink-0">
                          Deactivated
                        </span>
                      )}
                    </div>
                    <div className="text-muted-foreground text-[10px] mt-0.5 truncate">
                      {u.email}{u.phone ? ` • ${u.phone}` : ""}
                    </div>
                  </div>
                  {u.role !== "owner" && (
                    <div className="flex items-center gap-1.5 shrink-0">
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={Boolean(pendingStaffAction)}
                        onClick={() => handleToggleStaffStatus(u)}
                        className={`h-7 text-[10px] px-2 ${
                          u.status === "active"
                            ? "border-rose-300 dark:border-rose-500/40 text-rose-700 dark:text-rose-400 hover:bg-rose-950/30"
                            : "border-emerald-300 dark:border-emerald-500/40 text-emerald-700 dark:text-emerald-400 hover:bg-emerald-950/30"
                        }`}
                      >
                        {pendingStaffAction === u.id ? (
                          <Loader2 className="w-3 h-3 animate-spin" />
                        ) : u.status === "active" ? (
                          <><Ban className="w-3 h-3 mr-1" /> Deactivate</>
                        ) : (
                          <><RotateCcw className="w-3 h-3 mr-1" /> Activate</>
                        )}
                      </Button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {onCreateStaffUser && onResetStaffPassword && (
        <AdminUserManagementModal
          isOpen={isStaffModalOpen}
          onClose={() => setIsStaffModalOpen(false)}
          onCreateStaffUser={onCreateStaffUser}
          onResetStaffPassword={onResetStaffPassword}
          staffUsers={staffUsers}
        />
      )}
    </div>
  );
};
