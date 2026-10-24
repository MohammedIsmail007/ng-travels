import React, { useRef } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { formatINR, formatKM } from "@/lib/fareEngine";
import { openWhatsApp } from "@/lib/openExternal";
import { Printer, Download, Share2, MapPin, Calendar, Clock, User, Phone, CheckCircle2, X } from "lucide-react";

export interface CustomerCopyProps {
  isOpen: boolean;
  onClose: () => void;
  trip: any;
  companyInfo?: {
    company: string;
    mobile: string;
    email: string;
    terms?: string;
  };
}

export const CustomerCopyModal: React.FC<CustomerCopyProps> = ({
  isOpen,
  onClose,
  trip,
  companyInfo = {
    company: "NG Travels Operations",
    mobile: "+91 98450 21867",
    email: "operations@ngtravels.in",
    terms: "1. Toll & parking charges at actuals.\n2. Billing starts and ends garage to garage.",
  },
}) => {
  const printRef = useRef<HTMLDivElement>(null);

  if (!trip) return null;

  // In-between stops, numbered, with a leg tag when a round-trip stop applies
  // to only one direction.
  const stopList: any[] = Array.isArray(trip.stops) ? trip.stops : [];
  const stopLabel = (stop: any) => {
    const name = stop.name || stop.address || "Stop";
    return stop.address && stop.name && stop.address !== stop.name ? `${name} (${stop.address})` : name;
  };
  const legTag = (stop: any) =>
    stop.leg === "outbound" ? " — outbound only" : stop.leg === "return" ? " — return only" : "";

  // Print only the voucher: the global print rules (index.css) hide the rest of
  // the app while body has this class, and the light theme is forced for paper.
  const handlePrint = () => {
    const root = document.documentElement;
    const wasDark = root.classList.contains("dark");
    document.body.classList.add("print-customer-copy");
    if (wasDark) root.classList.remove("dark");
    const restore = () => {
      document.body.classList.remove("print-customer-copy");
      if (wasDark) root.classList.add("dark");
      window.removeEventListener("afterprint", restore);
    };
    window.addEventListener("afterprint", restore);
    window.print();
  };

  const handleWhatsApp = () => {
    const pickup = trip.pickup?.name || "Pickup";
    const dest = trip.destination?.name || "Destination";
    const date = new Date(trip.startDate).toLocaleDateString("en-IN", {
      day: "numeric",
      month: "short",
      year: "numeric",
    });
    const message =
      `*NG Travels Booking Confirmation*\n` +
      `Booking ID: ${trip.bookingId}\n` +
      `Customer: ${trip.customerName}\n` +
      `Route: ${[pickup, ...stopList.map((s) => s.name || s.address || "Stop"), dest].join(" ➔ ")}\n` +
      `Date & Time: ${date} at ${trip.startTime}\n` +
      `Billing KM: ${trip.billingKm} km${trip.pricingMode === "package" ? " (Package Rate)" : ` @ ₹${trip.ratePerKm}/km`}\n` +
      `Total Estimated Fare: ₹${trip.customerTotal}\n` +
      `Advance Paid: ₹${trip.totalPaid}\n` +
      `Balance Due: ₹${trip.remainingBalance}\n\n` +
      `Thank you for travelling with ${companyInfo.company}!\nHelpdesk: ${companyInfo.mobile}`;
    openWhatsApp(trip.customerMobile, message);
  };

  const formattedDate = new Date(trip.startDate).toLocaleDateString("en-IN", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent data-print-root className="max-w-2xl bg-background text-foreground border-border p-0 overflow-hidden max-h-[90vh] flex flex-col">
        {/* Header Actions */}
        <div className="print:hidden flex items-center justify-between flex-wrap gap-2 pl-6 pr-12 py-4 border-b border-border bg-card/80 shrink-0">
          <div className="flex items-center flex-wrap gap-2.5">
            <img src="/logo.png" alt="NG Travels" className="w-8 h-8 rounded-lg object-contain bg-black border border-amber-300 dark:border-amber-500/30 p-0.5" />
            <div>
              <span className="text-amber-700 dark:text-amber-400 font-bold text-base tracking-wider block">NG TRAVELS</span>
              <span className="text-[10px] text-muted-foreground block -mt-1">Travel with Comfort & Safety</span>
            </div>
            <span className="text-xs bg-amber-100 dark:bg-amber-500/20 text-amber-700 dark:text-amber-300 font-medium px-2 py-0.5 rounded border border-amber-300 dark:border-amber-500/30 ml-1">
              CUSTOMER COPY
            </span>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <Button size="sm" variant="outline" onClick={handlePrint} className="border-border hover:bg-muted text-xs">
              <Printer className="w-3.5 h-3.5 mr-1.5" /> Print
            </Button>
            <Button size="sm" onClick={handleWhatsApp} className="bg-emerald-600 hover:bg-emerald-500 text-white text-xs">
              <Share2 className="w-3.5 h-3.5 mr-1.5" /> WhatsApp
            </Button>
          </div>
        </div>

        {/* Printable Voucher Body */}
        <div ref={printRef} className="p-6 overflow-y-auto space-y-6 text-sm bg-background">
          {/* Company & Booking Info Header */}
          <div className="flex justify-between items-start pb-4 border-b border-border gap-4">
            <div className="flex items-center gap-3">
              <img src="/logo.png" alt="NG Travels" className="w-14 h-14 rounded-xl object-contain bg-black border border-amber-300 dark:border-amber-500/30 p-1 flex-shrink-0" />
              <div>
                <h2 className="text-xl font-bold text-foreground">{companyInfo.company}</h2>
                <p className="text-xs text-amber-400/90 font-medium mt-0.5">Travel with Comfort & Safety</p>
                <p className="text-xs text-muted-foreground mt-0.5">Phone: {companyInfo.mobile} | Email: {companyInfo.email}</p>
              </div>
            </div>
            <div className="text-right">
              <div className="text-xs text-muted-foreground uppercase tracking-wider">Booking Reference</div>
              <div className="text-lg font-mono font-bold text-amber-700 dark:text-amber-400">{trip.bookingId}</div>
              <div className="text-xs text-muted-foreground mt-0.5">{formattedDate} • {trip.startTime}</div>
            </div>
          </div>

          {/* Customer & Route Details */}
          <div className="grid grid-cols-2 gap-4 bg-card/60 p-4 rounded-lg border border-border">
            <div>
              <div className="text-xs text-muted-foreground uppercase font-semibold mb-1 flex items-center gap-1.5">
                <User className="w-3.5 h-3.5 text-amber-700 dark:text-amber-400" /> Passenger Details
              </div>
              <div className="font-semibold text-foreground">{trip.customerName}</div>
              <div className="text-muted-foreground text-xs mt-0.5">{trip.customerMobile}</div>
              <div className="text-muted-foreground text-xs mt-1">Passengers: {trip.passengerCount || 1} Person(s)</div>
            </div>
            <div>
              <div className="text-xs text-muted-foreground uppercase font-semibold mb-1 flex items-center gap-1.5">
                <Calendar className="w-3.5 h-3.5 text-amber-700 dark:text-amber-400" /> Trip Type & Schedule
              </div>
              <div className="font-semibold text-foreground capitalize">{(trip.tripType || "").replaceAll("_", " ")}</div>
              <div className="text-muted-foreground text-xs mt-0.5">Pickup Time: {trip.startTime}</div>
              {trip.returnDate && (
                <div className="text-muted-foreground text-xs mt-0.5">Return: {new Date(trip.returnDate).toLocaleDateString("en-IN")} {trip.returnTime || ""}</div>
              )}
            </div>
          </div>

          {/* Route Itinerary */}
          <div className="bg-card/60 p-4 rounded-lg border border-border space-y-3">
            <div className="text-xs text-muted-foreground uppercase font-semibold flex items-center gap-1.5">
              <MapPin className="w-3.5 h-3.5 text-amber-700 dark:text-amber-400" /> Route & Itinerary
            </div>
            <div className="space-y-2 pl-2 border-l-2 border-amber-300 dark:border-amber-500/40 ml-1.5">
              <div>
                <div className="text-xs text-emerald-700 dark:text-emerald-400 font-semibold">PICKUP LOCATION</div>
                <div className="text-foreground font-medium">{trip.pickup?.name}</div>
                <div className="text-xs text-muted-foreground">{trip.pickup?.address}</div>
              </div>
              {stopList.length > 0 && (
                <div className="pt-1">
                  <div className="text-xs text-amber-700 dark:text-amber-400 font-semibold">STOPS EN ROUTE</div>
                  {stopList.map((stop: any, idx: number) => (
                    <div key={idx} className="text-xs text-foreground mt-0.5">
                      {idx + 1}. {stopLabel(stop)}{legTag(stop)}
                    </div>
                  ))}
                </div>
              )}
              <div className="pt-1">
                <div className="text-xs text-rose-700 dark:text-rose-400 font-semibold">DESTINATION</div>
                <div className="text-foreground font-medium">{trip.destination?.name}</div>
                <div className="text-xs text-muted-foreground">{trip.destination?.address}</div>
              </div>
            </div>
          </div>

          {/* Fare Breakdown (Clean Customer View) */}
          <div>
            <div className="text-xs text-muted-foreground uppercase font-semibold mb-2">Fare Breakdown & Billing</div>
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-border text-muted-foreground">
                  <th className="text-left py-2">Item Description</th>
                  <th className="text-right py-2">Units / Rate</th>
                  <th className="text-right py-2">Amount</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/60">
                <tr>
                  <td className="py-2.5 text-foreground font-medium">
                    {trip.pricingMode === "package" ? "Package Fare" : "Base Vehicle Fare"}
                  </td>
                  <td className="text-right text-muted-foreground">
                    {trip.pricingMode === "package" ? `${trip.billingKm} km (flat package)` : `${trip.billingKm} km × ₹${trip.ratePerKm}/km`}
                  </td>
                  <td className="text-right font-medium text-foreground">{formatINR(trip.baseFare)}</td>
                </tr>
                {Number(trip.toll || 0) > 0 && (
                  <tr>
                    <td className="py-2 text-foreground">Highway Toll Charges</td>
                    <td className="text-right text-muted-foreground">At actuals</td>
                    <td className="text-right text-foreground">{formatINR(trip.toll)}</td>
                  </tr>
                )}
                {Number(trip.parking || 0) > 0 && (
                  <tr>
                    <td className="py-2 text-foreground">Parking & Entry Fees</td>
                    <td className="text-right text-muted-foreground">At actuals</td>
                    <td className="text-right text-foreground">{formatINR(trip.parking)}</td>
                  </tr>
                )}
                {Number(trip.permitCharge || 0) > 0 && (
                  <tr>
                    <td className="py-2 text-foreground">State Permit / Entry Charges</td>
                    <td className="text-right text-muted-foreground">Approved Permit</td>
                    <td className="text-right text-foreground">{formatINR(trip.permitCharge)}</td>
                  </tr>
                )}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-border">
                  <td colSpan={2} className="py-2.5 font-bold text-foreground text-sm">Customer Total Estimated Fare</td>
                  <td className="text-right font-bold text-amber-700 dark:text-amber-400 text-sm">{formatINR(trip.customerTotal)}</td>
                </tr>
                <tr className="border-b border-border/60">
                  <td colSpan={2} className="py-2 text-emerald-700 dark:text-emerald-400 font-medium">Advance / Paid Amount</td>
                  <td className="text-right font-medium text-emerald-700 dark:text-emerald-400">-{formatINR(trip.totalPaid)}</td>
                </tr>
                <tr className="bg-amber-950/20 font-bold">
                  <td colSpan={2} className="py-2.5 text-amber-700 dark:text-amber-300 text-sm pl-2">Balance Due at Trip Completion</td>
                  <td className="text-right font-bold text-amber-700 dark:text-amber-300 text-sm pr-2">{formatINR(trip.remainingBalance)}</td>
                </tr>
              </tfoot>
            </table>
          </div>

          {/* Terms and Signoff */}
          <div className="pt-2 border-t border-border/80 text-xs text-muted-foreground space-y-1">
            <div className="font-semibold text-foreground">Terms & Conditions:</div>
            <p className="whitespace-pre-line text-muted-foreground">{companyInfo.terms}</p>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};
