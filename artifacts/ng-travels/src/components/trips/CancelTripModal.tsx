import { apiFetch } from "@/lib/apiFetch";
import React, { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { AlertCircle, XCircle } from "lucide-react";
import { formatINR } from "@/lib/fareEngine";
import { ButtonLoader } from "@/components/loading";
import { routeLabel } from "@/lib/tripRoute";

export interface CancelTripModalProps {
  isOpen: boolean;
  onClose: () => void;
  trip: any;
  onTripCancelled: (cancelledTrip: any) => void | Promise<void>;
}

export const CancelTripModal: React.FC<CancelTripModalProps> = ({
  isOpen,
  onClose,
  trip,
  onTripCancelled,
}) => {
  const [reason, setReason] = useState("");
  const [loading, setLoading] = useState(false);

  if (!trip) return null;

  const hasAdvance = Number(trip.totalPaid || 0) > 0;

  const handleConfirmCancel = async () => {
    if (!reason.trim()) return;
    setLoading(true);
    try {
      const res = await apiFetch(`/api/trips/${trip.id}/cancel`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason }),
      });
      const data = await res.json();
      await onTripCancelled(data);
      onClose();
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-md bg-background text-foreground border-border p-5 rounded-xl">
        <DialogHeader>
          <DialogTitle className="text-base font-bold text-rose-700 dark:text-rose-400 flex items-center gap-2">
            <XCircle className="w-5 h-5" /> Cancel Trip Booking
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 pt-2 text-xs">
          <div className="bg-card/60 p-3 rounded-lg border border-border space-y-1">
            <div className="text-muted-foreground">Booking ID: <span className="font-mono text-amber-700 dark:text-amber-400 font-bold">{trip.bookingId}</span></div>
            <div className="text-foreground font-semibold">{routeLabel(trip.pickup, trip.stops, trip.destination)}</div>
            <div className="text-muted-foreground">Customer: {trip.customerName} ({trip.customerMobile})</div>
          </div>

          {hasAdvance && (
            <div className="bg-amber-950/30 border border-amber-300 dark:border-amber-500/40 p-3 rounded-lg text-amber-700 dark:text-amber-300 space-y-1">
              <div className="font-bold flex items-center gap-1.5">
                <AlertCircle className="w-4 h-4 text-amber-700 dark:text-amber-400" /> Advance Paid: {formatINR(trip.totalPaid)}
              </div>
              <p className="text-[11px] text-muted-foreground">
                An advance payment was recorded. Trip cancellation will flag this for refund processing in the Refunds ledger.
              </p>
            </div>
          )}

          <div>
            <label className="text-xs text-foreground font-semibold uppercase block mb-1">Cancellation Reason (Mandatory)</label>
            <Textarea
              placeholder="e.g. Customer cancelled due to personal emergency / Vehicle breakdown..."
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              className="bg-card border-border text-xs"
              rows={3}
            />
          </div>

          <div className="flex gap-2 pt-2">
            <Button type="button" variant="outline" onClick={onClose} className="flex-1 border-border text-xs">
              Keep Booking
            </Button>
            <Button
              type="button"
              disabled={loading || !reason.trim()}
              onClick={handleConfirmCancel}
              className="flex-1 bg-rose-600 hover:bg-rose-500 text-white font-bold text-xs cursor-pointer"
            >
              {loading ? (
                <ButtonLoader label="Cancelling Trip..." />
              ) : (
                <>
                  <XCircle className="w-4 h-4 mr-1" /> Confirm Cancellation
                </>
              )}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};
