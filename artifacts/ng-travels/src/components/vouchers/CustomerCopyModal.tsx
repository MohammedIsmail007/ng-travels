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

  // Every charge that goes into customerTotal, so the lines always add up.
  // Anything the breakdown can't explain (older trips) shows as one adjustment.
  const n = (v: any) => Number(v || 0);
  const chargeRows: { label: string; note: string; amount: number }[] = [
    { label: "Driver Bata", note: `${n(trip.billableDays) || 1} day(s)`, amount: n(trip.driverBata) },
    { label: "Highway Toll Charges", note: "At actuals", amount: n(trip.toll) },
    { label: "Parking & Entry Fees", note: "At actuals", amount: n(trip.parking) },
    { label: "State Permit / Entry Charges", note: "Approved Permit", amount: n(trip.permitCharge) },
    { label: "Waiting Charges", note: "At actuals", amount: n(trip.waitingCharge) },
    { label: "Night Charges", note: "", amount: n(trip.nightCharge) },
    { label: "Tax / GST", note: "", amount: n(trip.tax) },
  ].filter((r) => r.amount > 0);
  const discountAmount = n(trip.discount);
  const explained = n(trip.baseFare) + chargeRows.reduce((sum, r) => sum + r.amount, 0) - discountAmount;
  const unexplained = Math.round((n(trip.customerTotal) - explained) * 100) / 100;
  const isCompleted = trip.status === "completed";

  // In-between stops, numbered, with a leg tag when a round-trip stop applies
  // to only one direction.
  const stopList: any[] = Array.isArray(trip.stops) ? trip.stops : [];
  const stopLabel = (stop: any) => {
    const name = stop.name || stop.address || "Stop";
    return stop.address && stop.name && stop.address !== stop.name ? `${name} (${stop.address})` : name;
  };
  const legTag = (stop: any) =>
    stop.leg === "outbound" ? " — outbound only" : stop.leg === "return" ? " — return only" : "";

  // Print the voucher from a hidden iframe holding a copy of it plus the app's
  // stylesheets. Printing the live page would drag the dialog, its overlay and
  // the whole app behind it into the output.
  const handlePrint = () => {
    const node = printRef.current;
    if (!node) return;
    const iframe = document.createElement("iframe");
    iframe.setAttribute("aria-hidden", "true");
    iframe.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0;";
    document.body.appendChild(iframe);
    const doc = iframe.contentDocument;
    const win = iframe.contentWindow;
    if (!doc || !win) {
      iframe.remove();
      return;
    }
    doc.open();
    doc.write(`<!doctype html><html><head><meta charset="utf-8"><title>${trip.bookingId} - Customer Copy</title></head><body></body></html>`);
    doc.close();

    const sheets = Array.from(document.querySelectorAll<HTMLElement>('link[rel="stylesheet"], style'));
    const loaded = sheets.map(
      (sheet) =>
        new Promise<void>((resolve) => {
          const copy = sheet.cloneNode(true) as HTMLElement;
          if (copy instanceof HTMLLinkElement) {
            copy.onload = () => resolve();
            copy.onerror = () => resolve();
          } else {
            resolve();
          }
          doc.head.appendChild(copy);
        }),
    );
    const paper = doc.createElement("style");
    paper.textContent =
      "@page{margin:10mm}html,body{margin:0;background:#fff!important}" +
      "*{-webkit-print-color-adjust:exact;print-color-adjust:exact}" +
      "[data-print-voucher]{overflow:visible!important;max-height:none!important;padding:0!important}";
    doc.head.appendChild(paper);

    // The iframe has no `dark` class, so the voucher prints in the light theme.
    const copy = node.cloneNode(true) as HTMLElement;
    copy.setAttribute("data-print-voucher", "");
    doc.body.appendChild(copy);

    const cleanup = () => iframe.remove();
    win.addEventListener("afterprint", cleanup);
    Promise.all(loaded).then(() => {
      // let images (the logo) and layout settle before the print dialog opens
      setTimeout(() => {
        win.focus();
        win.print();
        setTimeout(cleanup, 60000);
      }, 300);
    });
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
      `${trip.status === "completed" ? "Total Fare" : "Total Estimated Fare"}: ₹${trip.customerTotal}\n` +
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
      <DialogContent className="max-w-2xl bg-background text-foreground border-border p-0 overflow-hidden max-h-[90vh] flex flex-col">
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
                {chargeRows.map((r) => (
                  <tr key={r.label}>
                    <td className="py-2 text-foreground">{r.label}</td>
                    <td className="text-right text-muted-foreground">{r.note}</td>
                    <td className="text-right text-foreground">{formatINR(r.amount)}</td>
                  </tr>
                ))}
                {discountAmount > 0 && (
                  <tr>
                    <td className="py-2 text-foreground">Discount</td>
                    <td className="text-right text-muted-foreground"></td>
                    <td className="text-right text-emerald-700 dark:text-emerald-400">-{formatINR(discountAmount)}</td>
                  </tr>
                )}
                {Math.abs(unexplained) >= 0.01 && (
                  <tr>
                    <td className="py-2 text-foreground">Other Adjustments</td>
                    <td className="text-right text-muted-foreground"></td>
                    <td className="text-right text-foreground">{unexplained < 0 ? "-" : ""}{formatINR(Math.abs(unexplained))}</td>
                  </tr>
                )}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-border">
                  <td colSpan={2} className="py-2.5 font-bold text-foreground text-sm">{isCompleted ? "Total Fare" : "Customer Total Estimated Fare"}</td>
                  <td className="text-right font-bold text-amber-700 dark:text-amber-400 text-sm">{formatINR(trip.customerTotal)}</td>
                </tr>
                <tr className="border-b border-border/60">
                  <td colSpan={2} className="py-2 text-emerald-700 dark:text-emerald-400 font-medium">Advance / Paid Amount</td>
                  <td className="text-right font-medium text-emerald-700 dark:text-emerald-400">-{formatINR(trip.totalPaid)}</td>
                </tr>
                <tr className="bg-amber-950/20 font-bold">
                  <td colSpan={2} className="py-2.5 text-amber-700 dark:text-amber-300 text-sm pl-2">{isCompleted ? "Balance Due" : "Balance Due at Trip Completion"}</td>
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
