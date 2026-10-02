import React, { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { apiFetch } from "@/lib/apiFetch";
import {
  Car,
  Phone,
  Mail,
  Award,
  CheckCircle2,
  AlertCircle,
  Clock,
  ShieldCheck,
  Plus,
  Key,
  Loader2,
  Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { NGTravelsLoader } from "@/components/loading";
import { ConfirmDeleteDialog } from "@/components/common/ConfirmDeleteDialog";
import {
  DriverManagementModal,
  CreateDriverData,
} from "@/components/admin/DriverManagementModal";

interface DriversPageProps {
  drivers: any[];
  isLoading?: boolean;
  onUpdateAvailability?: (driverId: number, availability: string) => void | Promise<void>;
}

export const DriversPage: React.FC<DriversPageProps> = ({
  drivers = [],
  isLoading = false,
  onUpdateAvailability,
}) => {
  const [isManagementModalOpen, setIsManagementModalOpen] = useState(false);
  const [modalLoading, setModalLoading] = useState(false);
  const [pendingUpdate, setPendingUpdate] = useState<{ id: number; availability: string } | null>(null);
  const [deletingDriver, setDeletingDriver] = useState<any | null>(null);
  const queryClient = useQueryClient();

  // Server archives the driver (and disables their login) so past trips,
  // expenses and payouts keep pointing at a real record.
  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      const res = await apiFetch(`/api/drivers/${id}`, { method: "DELETE" });
      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        throw new Error(errJson.error?.message || "Failed to delete driver");
      }
      return res.json();
    },
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["/api/drivers"] }),
        queryClient.invalidateQueries({ queryKey: ["/api/vehicles"] }),
        queryClient.invalidateQueries({ queryKey: ["/api/dashboard"] }),
      ]);
      toast.success("Driver deleted");
      setDeletingDriver(null);
    },
    onError: (err: any) => toast.error(err.message),
  });

  const handleAvailabilityClick = async (driverId: number, availability: string) => {
    if (!onUpdateAvailability || pendingUpdate) return;
    setPendingUpdate({ id: driverId, availability });
    try {
      await onUpdateAvailability(driverId, availability);
    } finally {
      setPendingUpdate(null);
    }
  };
  const driverList = Array.isArray(drivers)
    ? drivers
    : Array.isArray((drivers as any)?.items)
      ? (drivers as any).items
      : [];

  const handleCreateDriver = async (data: CreateDriverData) => {
    setModalLoading(true);
    try {
      const response = await apiFetch("/api/admin/drivers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(
          error.message || `Failed to create driver (${response.status})`,
        );
      }

      // Trigger a refresh of the drivers list if needed
      window.location.reload();
    } catch (err: any) {
      throw err;
    } finally {
      setModalLoading(false);
    }
  };

  const handleResetPassword = async (driverId: number, newPassword: string) => {
    setModalLoading(true);
    try {
      const response = await apiFetch(
        `/api/admin/drivers/${driverId}/reset-password`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ newPassword }),
        },
      );

      if (!response.ok) {
        const error = await response.json();
        throw new Error(
          error.message || `Failed to reset password (${response.status})`,
        );
      }

      // Trigger a refresh of the drivers list if needed
      window.location.reload();
    } catch (err: any) {
      throw err;
    } finally {
      setModalLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-foreground flex items-center gap-2">
            <Car className="w-5 h-5 text-amber-700 dark:text-amber-400" />
            Driver Partner Roster & Availability Board
          </h1>
          <p className="text-xs text-muted-foreground mt-1">
            Fleet operators, commercial license credentials, active duty
            statuses, and performance ratings.
          </p>
        </div>
        <Button
          onClick={() => setIsManagementModalOpen(true)}
          className="bg-amber-400 hover:bg-amber-300 text-zinc-950 font-bold shrink-0"
        >
          <Plus className="w-4 h-4 mr-2" />
          Manage Drivers
        </Button>
      </div>

      <DriverManagementModal
        isOpen={isManagementModalOpen}
        onClose={() => setIsManagementModalOpen(false)}
        onCreateDriver={handleCreateDriver}
        onResetPassword={handleResetPassword}
        drivers={driverList}
      />

      {isLoading && driverList.length === 0 ? (
        <div className="p-12 flex justify-center bg-card/50 rounded-2xl border border-border">
          <NGTravelsLoader size="sm" text="Loading driver roster..." />
        </div>
      ) : driverList.length === 0 ? (
        <div className="p-12 text-center bg-card/50 rounded-2xl border border-border text-muted-foreground space-y-3">
          <Car className="w-12 h-12 text-muted-foreground mx-auto" />
          <div className="text-sm font-semibold text-foreground">
            No driver partners registered yet
          </div>
          <div className="text-xs text-muted-foreground max-w-sm mx-auto">
            Once drivers join your fleet or are added, their roster, duty
            statuses, and vehicle assignments will appear here.
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {driverList.map((drv: any) => (
            <div
              key={drv.id}
              className="bg-card/70 border border-border rounded-xl p-5 space-y-4 hover:border-border transition-all shadow-md"
            >
              <div className="flex justify-between items-start">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-amber-100 dark:bg-amber-400/20 border border-amber-300 dark:border-amber-400/40 text-amber-700 dark:text-amber-300 font-bold flex items-center justify-center text-sm">
                    {drv.name?.slice(0, 2).toUpperCase()}
                  </div>
                  <div>
                    <h3 className="font-bold text-sm text-foreground">
                      {drv.name}
                    </h3>
                    <span className="font-mono text-[11px] text-muted-foreground">
                      {drv.driverCode}
                    </span>
                  </div>
                </div>

                <div className="flex items-center gap-1.5">
                <span
                  className={`text-[10px] font-bold px-2 py-0.5 rounded capitalize ${
                    drv.availability === "available"
                      ? "bg-emerald-100 dark:bg-emerald-500/20 text-emerald-700 dark:text-emerald-400 border border-emerald-300 dark:border-emerald-500/30"
                      : drv.availability === "on_trip"
                        ? "bg-amber-100 dark:bg-amber-500/20 text-amber-700 dark:text-amber-300 border border-amber-300 dark:border-amber-500/30 animate-pulse"
                        : drv.availability === "on_leave"
                          ? "bg-rose-100 dark:bg-rose-500/20 text-rose-700 dark:text-rose-400 border border-rose-300 dark:border-rose-500/30"
                          : "bg-muted text-muted-foreground"
                  }`}
                >
                  {drv.availability?.replaceAll("_", " ")}
                </span>
                <button
                  onClick={() => setDeletingDriver(drv)}
                  className="p-1.5 rounded-lg bg-muted/80 hover:bg-rose-100 hover:dark:bg-rose-500/20 text-rose-700 dark:text-rose-400 transition-colors cursor-pointer"
                  title="Delete driver"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
                </div>
              </div>

              <div className="space-y-1.5 text-xs text-muted-foreground bg-background/60 p-3 rounded-lg border border-border/80">
                <div className="flex justify-between">
                  <span>Phone:</span>
                  <span className="text-foreground font-medium">
                    {drv.mobile}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span>Driving License:</span>
                  <span className="font-mono text-foreground">
                    {drv.licenseNumber || "DL-KA01-PENDING"}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span>Rating:</span>
                  <span className="text-amber-700 dark:text-amber-400 font-bold">
                    ★ {drv.rating || "4.8"} / 5.0
                  </span>
                </div>
              </div>

              {drv.notes && (
                <p className="text-[11px] text-muted-foreground italic">{drv.notes}</p>
              )}

              {/* Quick Availability Action */}
              {onUpdateAvailability && (
                <div className="pt-2 border-t border-border flex items-center justify-between text-xs">
                  <span className="text-muted-foreground text-[10px] uppercase">
                    Set Status:
                  </span>
                  <div className="flex gap-1">
                    <Button
                      size="sm"
                      variant={
                        drv.availability === "available" ? "default" : "outline"
                      }
                      onClick={() => handleAvailabilityClick(drv.id, "available")}
                      disabled={Boolean(pendingUpdate)}
                      className={`h-6 text-[10px] px-2 ${
                        drv.availability === "available"
                          ? "bg-emerald-600 text-white font-bold"
                          : "border-border text-muted-foreground"
                      }`}
                    >
                      {pendingUpdate && pendingUpdate.id === drv.id && pendingUpdate.availability === "available" ? (
                        <Loader2 className="w-3 h-3 animate-spin" />
                      ) : (
                        "Available"
                      )}
                    </Button>
                    <Button
                      size="sm"
                      variant={
                        drv.availability === "on_leave" ? "default" : "outline"
                      }
                      onClick={() => handleAvailabilityClick(drv.id, "on_leave")}
                      disabled={Boolean(pendingUpdate)}
                      className={`h-6 text-[10px] px-2 ${
                        drv.availability === "on_leave"
                          ? "bg-rose-600 text-white font-bold"
                          : "border-border text-muted-foreground"
                      }`}
                    >
                      {pendingUpdate && pendingUpdate.id === drv.id && pendingUpdate.availability === "on_leave" ? (
                        <Loader2 className="w-3 h-3 animate-spin" />
                      ) : (
                        "On Leave"
                      )}
                    </Button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      <ConfirmDeleteDialog
        isOpen={Boolean(deletingDriver)}
        title="Delete Driver"
        description={
          <>
            Remove <strong className="text-foreground">{deletingDriver?.name}</strong> ({deletingDriver?.driverCode}) from the roster?
            Their driver app login will be disabled and any vehicle assignment cleared. Past trips and expenses are kept.
            Drivers on open trips can't be deleted until those trips are reassigned or closed.
          </>
        }
        loading={deleteMutation.isPending}
        onConfirm={() => deletingDriver && deleteMutation.mutate(deletingDriver.id)}
        onClose={() => setDeletingDriver(null)}
      />
    </div>
  );
};
