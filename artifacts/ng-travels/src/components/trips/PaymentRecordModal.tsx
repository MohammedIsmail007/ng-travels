import { apiFetch } from "@/lib/apiFetch";
import React, { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Receipt, CheckCircle2, IndianRupee } from "lucide-react";
import { formatINR } from "@/lib/fareEngine";
import { TripActionLoader, ButtonLoader } from "@/components/loading";

export interface PaymentRecordModalProps {
  isOpen: boolean;
  onClose: () => void;
  trip: any;
  onPaymentRecorded: (newPayment: any) => void | Promise<void>;
}

export const PaymentRecordModal: React.FC<PaymentRecordModalProps> = ({
  isOpen,
  onClose,
  trip,
  onPaymentRecorded,
}) => {
  const [amount, setAmount] = useState("");
  const [paymentMode, setPaymentMode] = useState("cash");
  const [paymentType, setPaymentType] = useState("partial");
  const [reference, setReference] = useState("");
  const [loading, setLoading] = useState(false);

  if (!trip) return null;

  const totalFare = Number(trip.customerTotal || 0);
  const totalPaid = Number(trip.totalPaid || 0);
  const remaining = Math.max(0, Number(trip.remainingBalance ?? totalFare - totalPaid));

  const handleSubmit = async () => {
    if (!amount || Number(amount) <= 0) return;

    setLoading(true);
    try {
      const res = await apiFetch(`/api/trips/${trip.id}/payments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          amount: Number(amount),
          paymentMode,
          paymentType,
          reference: reference || null,
        }),
      });

      if (!res.ok) {
        throw new Error("Failed to record payment");
      }

      const newPayment = await res.json();
      await onPaymentRecorded(newPayment);
      onClose();
    } catch {
      alert("Failed to record payment. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      {loading && <TripActionLoader action="payment" />}

      <Dialog open={isOpen} onOpenChange={onClose}>
        <DialogContent className="max-w-md bg-background text-foreground border-border p-6 rounded-2xl shadow-2xl">
          <DialogHeader>
            <DialogTitle className="text-base font-bold text-foreground flex items-center gap-2">
              <Receipt className="w-5 h-5 text-emerald-700 dark:text-emerald-400" />
              Record Passenger / Client Payment
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4 pt-2 text-xs">
            <div className="bg-card/60 p-3 rounded-xl border border-border space-y-1">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Booking: <strong className="text-amber-700 dark:text-amber-400 font-mono">{trip.bookingId}</strong></span>
                <span className="text-muted-foreground">Customer: <strong className="text-foreground">{trip.customerName || "Customer"}</strong></span>
              </div>
              <div className="grid grid-cols-3 gap-2 pt-2 border-t border-border/80">
                <div>
                  <span className="block text-[11px] text-muted-foreground">Total Fare</span>
                  <strong className="block font-mono text-base text-foreground">{formatINR(totalFare)}</strong>
                </div>
                <div>
                  <span className="block text-[11px] text-muted-foreground">Paid So Far</span>
                  <strong className="block font-mono text-base text-emerald-700 dark:text-emerald-400">{formatINR(totalPaid)}</strong>
                </div>
                <div className="text-right">
                  <span className="block text-[11px] text-muted-foreground">Due Balance</span>
                  <strong className="block font-mono text-lg font-black text-amber-700 dark:text-amber-400">{formatINR(remaining)}</strong>
                </div>
              </div>
            </div>

            <div>
              <label className="text-xs text-foreground font-semibold block mb-1">Payment Amount (₹) *</label>
              <div className="relative">
                <IndianRupee className="w-4 h-4 text-muted-foreground absolute left-3 top-3" />
                <Input
                  type="number"
                  required
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  placeholder={`e.g. ${remaining > 0 ? remaining : 2500}`}
                  className="pl-9 bg-card border-border text-base font-mono font-bold text-emerald-700 dark:text-emerald-400"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-foreground font-semibold block mb-1">Payment Method</label>
                <Select value={paymentMode} onValueChange={setPaymentMode}>
                  <SelectTrigger className="bg-card border-border text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="bg-card border-border text-foreground text-xs">
                    <SelectItem value="cash">Cash</SelectItem>
                    <SelectItem value="upi">UPI (GPay / PhonePe)</SelectItem>
                    <SelectItem value="card">Debit / Credit Card</SelectItem>
                    <SelectItem value="bank_transfer">NEFT / RTGS</SelectItem>
                    <SelectItem value="cheque">Cheque</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div>
                <label className="text-xs text-foreground font-semibold block mb-1">Payment Category</label>
                <Select value={paymentType} onValueChange={setPaymentType}>
                  <SelectTrigger className="bg-card border-border text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="bg-card border-border text-foreground text-xs">
                    <SelectItem value="advance">Advance Deposit</SelectItem>
                    <SelectItem value="partial">Partial Milestone</SelectItem>
                    <SelectItem value="final">Final Settlement</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div>
              <label className="text-xs text-foreground font-semibold block mb-1">Transaction Ref / Cheque No.</label>
              <Input
                value={reference}
                onChange={(e) => setReference(e.target.value)}
                placeholder="e.g. UPI Ref / UTR: 429188201992 or Cheque #104921"
                className="bg-card border-border text-xs font-mono"
              />
            </div>

            <Button
              type="button"
              disabled={loading || !amount || Number(amount) <= 0}
              onClick={handleSubmit}
              className="w-full bg-emerald-600 hover:bg-emerald-500 text-white font-bold py-5 text-xs cursor-pointer"
            >
              {loading ? (
                <ButtonLoader label="Recording Payment..." />
              ) : (
                <>
                  <CheckCircle2 className="w-4 h-4 mr-1.5" /> Confirm Payment Receipt
                </>
              )}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
};
