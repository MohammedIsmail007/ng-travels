import { apiFetch } from "@/lib/apiFetch";
import React, { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { UserCog } from "lucide-react";
import { ButtonLoader } from "@/components/loading";
import { routeLabel } from "@/lib/tripRoute";

export interface AssignDriverModalProps {
  isOpen: boolean;
  onClose: () => void;
  trip: any;
  drivers: any[];
  vehicles: any[];
  onAssigned: (updatedTrip: any) => void | Promise<void>;
}

export const AssignDriverModal: React.FC<AssignDriverModalProps> = ({
  isOpen,
  onClose,
  trip,
  drivers,
  vehicles,
  onAssigned,
}) => {
  const [selectedDriverId, setSelectedDriverId] = useState<number | null>(null);
  const [selectedVehicleId, setSelectedVehicleId] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (isOpen && trip) {
      setSelectedDriverId(trip.driverId ?? null);
      setSelectedVehicleId(trip.vehicleId ?? null);
    }
  }, [isOpen, trip]);

  if (!trip) return null;

  const driverList = Array.isArray(drivers) ? drivers : [];
  const vehicleList = Array.isArray(vehicles) ? vehicles : [];

  const handleAssign = async () => {
    setLoading(true);
    try {
      const res = await apiFetch(`/api/trips/${trip.id}/assign`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          driverId: selectedDriverId,
          vehicleId: selectedVehicleId,
        }),
      });
      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        throw new Error(errJson.error?.message || errJson.error || "Failed to assign driver");
      }
      const data = await res.json();
      await onAssigned(data);
      onClose();
    } catch (err: any) {
      alert(err.message || "Failed to assign driver");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-md bg-background text-foreground border-border p-5 rounded-xl">
        <DialogHeader>
          <DialogTitle className="text-base font-bold text-amber-700 dark:text-amber-400 flex items-center gap-2">
            <UserCog className="w-5 h-5" /> Assign Driver & Vehicle
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 pt-2 text-xs">
          <div className="bg-card/60 p-3 rounded-lg border border-border space-y-1">
            <div className="text-muted-foreground">
              Booking ID: <span className="font-mono text-amber-700 dark:text-amber-400 font-bold">{trip.bookingId}</span>
            </div>
            <div className="text-foreground font-semibold">
              {routeLabel(trip.pickup, trip.stops, trip.destination)}
            </div>
            <div className="text-muted-foreground">
              Customer: {trip.customerName} ({trip.customerMobile})
            </div>
          </div>

          <div className="space-y-2">
            <label className="text-xs font-bold text-foreground">Driver</label>
            <Select
              value={selectedDriverId ? String(selectedDriverId) : "unassigned"}
              onValueChange={(val) => {
                const dId = val === "unassigned" ? null : Number(val);
                setSelectedDriverId(dId);
                if (dId) {
                  const matchedV = vehicleList.find((v: any) => v.assignedDriverId === dId);
                  if (matchedV) setSelectedVehicleId(matchedV.id);
                }
              }}
            >
              <SelectTrigger className="bg-card border-border text-xs h-10">
                <SelectValue placeholder="Select driver..." />
              </SelectTrigger>
              <SelectContent className="bg-card border-border text-foreground">
                <SelectItem value="unassigned">Unassigned</SelectItem>
                {driverList.map((d: any) => (
                  <SelectItem key={d.id} value={String(d.id)}>
                    {d.name} ({d.driverCode}) • Rating {d.rating} • Status: {d.availability}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <label className="text-xs font-bold text-foreground">Vehicle</label>
            <Select
              value={selectedVehicleId ? String(selectedVehicleId) : "unassigned"}
              onValueChange={(val) => setSelectedVehicleId(val === "unassigned" ? null : Number(val))}
            >
              <SelectTrigger className="bg-card border-border text-xs h-10">
                <SelectValue placeholder="Select fleet vehicle..." />
              </SelectTrigger>
              <SelectContent className="bg-card border-border text-foreground">
                <SelectItem value="unassigned">Unassigned</SelectItem>
                {vehicleList.map((v: any) => (
                  <SelectItem key={v.id} value={String(v.id)}>
                    {v.vehicleNumber} ({v.brand} {v.model}) • {v.capacity} Seater
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex gap-2 pt-2">
            <Button type="button" variant="outline" onClick={onClose} className="flex-1 border-border text-xs">
              Cancel
            </Button>
            <Button
              type="button"
              disabled={loading}
              onClick={handleAssign}
              className="flex-1 bg-amber-400 hover:bg-amber-300 text-zinc-950 font-bold text-xs cursor-pointer"
            >
              {loading ? (
                <ButtonLoader label="Assigning..." />
              ) : (
                <>
                  <UserCog className="w-4 h-4 mr-1" /> Confirm Assignment
                </>
              )}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};
