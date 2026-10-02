import React, { useState } from "react";
import {
  BarChart3, Download, Printer, Calendar, CircleDollarSign, TrendingUp,
  Fuel, Navigation, CheckCircle2, XCircle, ArrowUpRight
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatINR, formatKM } from "@/lib/fareEngine";
import { exportTripsToXLSX } from "@/lib/xlsxExport";

interface ReportsPageProps {
  trips: any[];
  expenses: any[];
  payments: any[];
}

export const ReportsPage: React.FC<ReportsPageProps> = ({
  trips = [],
  expenses = [],
  payments = [],
}) => {
  const [reportType, setReportType] = useState<"daily" | "weekly" | "monthly" | "custom">("monthly");
  const [fromDate, setFromDate] = useState(
    new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().slice(0, 10)
  );
  const [toDate, setToDate] = useState(new Date().toISOString().slice(0, 10));

  const tripList = Array.isArray(trips) ? trips : (Array.isArray((trips as any)?.items) ? (trips as any).items : []);
  const expenseList = Array.isArray(expenses) ? expenses : (Array.isArray((expenses as any)?.items) ? (expenses as any).items : []);
  const paymentList = Array.isArray(payments) ? payments : (Array.isArray((payments as any)?.items) ? (payments as any).items : []);

  // Filter trips based on report range
  const filteredTrips = tripList.filter((t: any) => {
    const d = new Date(t.startDate).toISOString().slice(0, 10);
    if (reportType === "daily") {
      return d === new Date().toISOString().slice(0, 10);
    } else if (reportType === "weekly") {
      const today = new Date();
      const first = today.getDate() - today.getDay();
      const firstDay = new Date(today.setDate(first)).toISOString().slice(0, 10);
      return d >= firstDay;
    } else if (reportType === "monthly") {
      const monthStart = `${new Date().toISOString().slice(0, 7)}-01`;
      return d >= monthStart;
    } else {
      return d >= fromDate && d <= toDate;
    }
  });

  const grossRevenue = filteredTrips.reduce((sum: number, t: any) => sum + Number(t.customerTotal || 0), 0);
  const totalCollections = filteredTrips.reduce((sum: number, t: any) => sum + Number(t.totalPaid || 0), 0);
  const pendingBalance = filteredTrips.reduce((sum: number, t: any) => sum + Number(t.remainingBalance || 0), 0);
  const totalBillingKm = filteredTrips.reduce((sum: number, t: any) => sum + Number(t.billingKm || 0), 0);

  const tripIds = new Set(filteredTrips.map((t: any) => t.id));
  const approvedExpensesTotal = expenseList
    .filter((e: any) => tripIds.has(e.tripId) && e.status === "approved")
    .reduce((sum: number, e: any) => sum + Number(e.amount || 0), 0);

  const netProfit = grossRevenue - approvedExpensesTotal;

  const handleExportXLSX = () => {
    const exportRows = filteredTrips.map((t: any) => ({
      bookingId: t.bookingId,
      startDate: new Date(t.startDate).toISOString().slice(0, 10),
      customerName: t.customerName,
      customerMobile: t.customerMobile,
      pickup: t.pickup?.name || "",
      destination: t.destination?.name || "",
      tripType: t.tripType,
      driverName: t.driverName || "Unassigned",
      mapDistanceKm: Number(t.mapDistanceKm || 0),
      billingKm: Number(t.billingKm || 0),
      ratePerKm: Number(t.ratePerKm || 0),
      baseFare: Number(t.baseFare || 0),
      toll: Number(t.toll || 0),
      parking: Number(t.parking || 0),
      permitCharge: Number(t.permitCharge || 0),
      customerTotal: Number(t.customerTotal || 0),
      totalPaid: Number(t.totalPaid || 0),
      remainingBalance: Number(t.remainingBalance || 0),
      startingKm: t.startingKm ? Number(t.startingKm) : null,
      endingKm: t.endingKm ? Number(t.endingKm) : null,
      actualKm: t.actualKm ? Number(t.actualKm) : null,
      standStartKm: t.standStartKm != null ? Number(t.standStartKm) : null,
      standReturnKm: t.standReturnKm != null ? Number(t.standReturnKm) : null,
      standToPickupKm: t.standToPickupKm != null ? Number(t.standToPickupKm) : null,
      dropToStandKm: t.dropToStandKm != null ? Number(t.dropToStandKm) : null,
      expenseTotal: Number(t.expenseTotal || 0),
      profit: Number(t.customerTotal || 0) - Number(t.expenseTotal || 0),
      paymentStatus: Number(t.remainingBalance || 0) <= 0 ? "Fully Paid" : Number(t.totalPaid || 0) > 0 ? "Partially Paid" : "Unpaid",
      status: t.status,
    }));

    exportTripsToXLSX(exportRows, `NG_Travels_${reportType.toUpperCase()}_Report.xlsx`);
  };

  const handlePrintPDF = () => {
    window.print();
  };

  return (
    <div className="space-y-4 sm:space-y-6">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-lg sm:text-xl font-bold text-foreground flex items-center gap-2">
            <BarChart3 className="w-5 h-5 text-amber-700 dark:text-amber-400" />
            Financial Operations Reports
          </h1>
          <p className="text-xs text-muted-foreground mt-0.5">
            Audited financial summaries, revenue ledgers, and real-time Excel (.xlsx) / PDF generation.
          </p>
        </div>

        {/* Export Buttons */}
        <div className="flex items-center gap-2 w-full sm:w-auto">
          <Button
            size="sm"
            variant="outline"
            onClick={handlePrintPDF}
            className="border-border hover:bg-muted text-xs text-foreground flex-1 sm:flex-none cursor-pointer"
          >
            <Printer className="w-3.5 h-3.5 mr-1" /> Print
          </Button>
          <Button
            size="sm"
            onClick={handleExportXLSX}
            className="bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs shadow-lg shadow-emerald-600/20 flex-1 sm:flex-none cursor-pointer"
          >
            <Download className="w-3.5 h-3.5 mr-1" /> Export (.xlsx)
          </Button>
        </div>
      </div>

      {/* Range Selection Pills */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-card/60 p-3 sm:p-4 rounded-xl border border-border">
        <div className="flex flex-wrap gap-1.5 sm:gap-2">
          <Button
            size="sm"
            variant={reportType === "daily" ? "default" : "outline"}
            onClick={() => setReportType("daily")}
            className={reportType === "daily" ? "bg-amber-400 text-zinc-950 font-bold text-xs h-8" : "border-border text-xs h-8"}
          >
            Daily
          </Button>
          <Button
            size="sm"
            variant={reportType === "weekly" ? "default" : "outline"}
            onClick={() => setReportType("weekly")}
            className={reportType === "weekly" ? "bg-amber-400 text-zinc-950 font-bold text-xs h-8" : "border-border text-xs h-8"}
          >
            Weekly
          </Button>
          <Button
            size="sm"
            variant={reportType === "monthly" ? "default" : "outline"}
            onClick={() => setReportType("monthly")}
            className={reportType === "monthly" ? "bg-amber-400 text-zinc-950 font-bold text-xs h-8" : "border-border text-xs h-8"}
          >
            Monthly
          </Button>
          <Button
            size="sm"
            variant={reportType === "custom" ? "default" : "outline"}
            onClick={() => setReportType("custom")}
            className={reportType === "custom" ? "bg-amber-400 text-zinc-950 font-bold text-xs h-8" : "border-border text-xs h-8"}
          >
            Custom
          </Button>
        </div>

        {reportType === "custom" && (
          <div className="flex items-center gap-2 text-xs w-full sm:w-auto">
            <Input
              type="date"
              value={fromDate}
              onChange={(e) => setFromDate(e.target.value)}
              className="bg-card border-border text-xs flex-1 sm:w-36 h-8"
            />
            <span className="text-muted-foreground">to</span>
            <Input
              type="date"
              value={toDate}
              onChange={(e) => setToDate(e.target.value)}
              className="bg-card border-border text-xs flex-1 sm:w-36 h-8"
            />
          </div>
        )}
      </div>

      {/* Financial Aggregation KPI Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2.5 sm:gap-3">
        <div className="bg-card/80 p-3 sm:p-4 rounded-xl border border-border">
          <span className="text-[10px] text-muted-foreground uppercase font-semibold block">Total Trips</span>
          <div className="text-xl sm:text-2xl font-bold font-mono text-foreground mt-1">{filteredTrips.length}</div>
        </div>

        <div className="bg-card/80 p-3 sm:p-4 rounded-xl border border-border">
          <span className="text-[10px] text-muted-foreground uppercase font-semibold block">Gross Booked Value</span>
          <div className="text-lg sm:text-xl font-bold font-mono text-amber-700 dark:text-amber-400 mt-1">{formatINR(grossRevenue)}</div>
        </div>

        <div className="bg-card/80 p-3 sm:p-4 rounded-xl border border-border">
          <span className="text-[10px] text-muted-foreground uppercase font-semibold block">Total Collections</span>
          <div className="text-lg sm:text-xl font-bold font-mono text-emerald-700 dark:text-emerald-400 mt-1">{formatINR(totalCollections)}</div>
        </div>

        <div className="bg-card/80 p-3 sm:p-4 rounded-xl border border-border">
          <span className="text-[10px] text-muted-foreground uppercase font-semibold block">Pending Balance</span>
          <div className="text-lg sm:text-xl font-bold font-mono text-amber-700 dark:text-amber-300 mt-1">{formatINR(pendingBalance)}</div>
        </div>

        <div className="bg-card/80 p-3 sm:p-4 rounded-xl border border-border">
          <span className="text-[10px] text-muted-foreground uppercase font-semibold block">Approved Expenses</span>
          <div className="text-lg sm:text-xl font-bold font-mono text-rose-700 dark:text-rose-400 mt-1">{formatINR(approvedExpensesTotal)}</div>
        </div>

        <div className="bg-card/80 p-3 sm:p-4 rounded-xl border border-amber-300 dark:border-amber-500/40 bg-amber-950/20 col-span-2 sm:col-span-1">
          <span className="text-[10px] text-amber-700 dark:text-amber-300 uppercase font-bold block">Operating Profit</span>
          <div className="text-lg sm:text-xl font-bold font-mono text-amber-700 dark:text-amber-400 mt-1">{formatINR(netProfit)}</div>
        </div>
      </div>

      {/* Detailed Operations Report Table */}
      <div className="bg-card/70 border border-border rounded-xl overflow-hidden shadow-xl">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs min-w-[700px]">
            <thead className="bg-card text-muted-foreground border-b border-border uppercase text-[10px] tracking-wider">
              <tr>
                <th className="py-3 px-4">Booking ID</th>
                <th className="py-3 px-4">Date</th>
                <th className="py-3 px-4">Customer</th>
                <th className="py-3 px-4">Route</th>
                <th className="py-3 px-4">Billing KM</th>
                <th className="py-3 px-4 text-right">Permit (₹)</th>
                <th className="py-3 px-4 text-right">Customer Total</th>
                <th className="py-3 px-4 text-right">Paid</th>
                <th className="py-3 px-4 text-right">Balance</th>
                <th className="py-3 px-4 text-center">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/60">
              {filteredTrips.length === 0 ? (
                <tr>
                  <td colSpan={10} className="py-12 text-center text-muted-foreground">
                    No trips recorded in this date range.
                  </td>
                </tr>
              ) : (
                filteredTrips.map((trip: any) => (
                  <tr key={trip.id} className="hover:bg-muted/40 transition-colors">
                    <td className="py-3 px-4 font-mono font-bold text-amber-700 dark:text-amber-400">{trip.bookingId}</td>
                    <td className="py-3 px-4 text-foreground">{new Date(trip.startDate).toLocaleDateString("en-IN")}</td>
                    <td className="py-3 px-4 font-semibold text-foreground">{trip.customerName || "Customer"}</td>
                    <td className="py-3 px-4 text-foreground truncate max-w-[160px]">
                      {trip.pickup?.name || trip.pickup?.address || "Pickup"} ➔ {trip.destination?.name || trip.destination?.address || "Destination"}
                    </td>
                    <td className="py-3 px-4 font-mono text-foreground">{trip.billingKm} km</td>
                    <td className="py-3 px-4 text-right font-mono text-muted-foreground">{formatINR(trip.permitCharge || 0)}</td>
                    <td className="py-3 px-4 text-right font-mono font-bold text-foreground">{formatINR(trip.customerTotal)}</td>
                    <td className="py-3 px-4 text-right font-mono text-emerald-700 dark:text-emerald-400">{formatINR(trip.totalPaid)}</td>
                    <td className="py-3 px-4 text-right font-mono font-bold text-amber-700 dark:text-amber-300">{formatINR(trip.remainingBalance)}</td>
                    <td className="py-3 px-4 text-center">
                      <span className="text-[10px] px-2 py-0.5 rounded bg-muted text-foreground capitalize">
                        {trip.status?.replaceAll("_", " ")}
                      </span>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
