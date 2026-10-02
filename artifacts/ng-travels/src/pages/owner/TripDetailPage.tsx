import React, { useState } from "react";
import { Link } from "wouter";
import {
  ArrowLeft, Navigation, MapPin, User, Phone, Calendar, Clock, CircleDollarSign,
  Receipt, Fuel, Gauge, ShieldCheck, CheckCircle2, XCircle, Share2, Printer, Plus,
  FileText, ArrowUpRight, AlertCircle, Loader2, Pencil, UserCog, Radio
} from "lucide-react";
import { ButtonLoader } from "@/components/loading";
import { Button } from "@/components/ui/button";
import { formatINR, canEditTrip } from "@/lib/fareEngine";
import { openWhatsApp, openExternalUrl } from "@/lib/openExternal";
import { RealtimeFleetMap } from "@/components/maps/RealtimeFleetMap";

interface TripDetailPageProps {
  trip: any;
  payments?: any[];
  expenses?: any[];
  onOpenCustomerCopy: (trip: any) => void;
  onOpenPaymentModal: (trip: any) => void;
  onOpenCancelModal: (trip: any) => void;
  onOpenEditTrip: (trip: any) => void;
  onOpenAssignDriver: (trip: any) => void;
  onOpenStartKmModal: (trip: any) => void;
  onOpenEndKmModal: (trip: any) => void;
  onOpenStandKmModal?: (trip: any) => void;
  onUpdateMilestone: (tripId: number, status: string, note?: string) => Promise<void>;
  onOpenExpenseModal: (tripId: number) => void;
  onApproveExpense?: (expenseId: number) => void | Promise<void>;
  onRejectExpense?: (expenseId: number) => void | Promise<void>;
  onStatusChange?: (newStatus: string) => void;
}

export const TripDetailPage: React.FC<TripDetailPageProps> = ({
  trip,
  payments = [],
  expenses = [],
  onOpenCustomerCopy,
  onOpenPaymentModal,
  onOpenCancelModal,
  onOpenEditTrip,
  onOpenAssignDriver,
  onOpenStartKmModal,
  onOpenEndKmModal,
  onOpenStandKmModal,
  onUpdateMilestone,
  onOpenExpenseModal,
  onApproveExpense,
  onRejectExpense,
  onStatusChange,
}) => {
  const [pendingExpenseAction, setPendingExpenseAction] = useState<{ id: number; action: "approve" | "reject" } | null>(null);
  const [milestoneUpdating, setMilestoneUpdating] = useState(false);
  const [milestoneError, setMilestoneError] = useState<string | null>(null);

  const handleApproveExpense = async (id: number) => {
    if (!onApproveExpense || pendingExpenseAction) return;
    setPendingExpenseAction({ id, action: "approve" });
    try {
      await onApproveExpense(id);
    } finally {
      setPendingExpenseAction(null);
    }
  };

  const handleRejectExpense = async (id: number) => {
    if (!onRejectExpense || pendingExpenseAction) return;
    setPendingExpenseAction({ id, action: "reject" });
    try {
      await onRejectExpense(id);
    } finally {
      setPendingExpenseAction(null);
    }
  };

  const handleMilestone = async (tripId: number, status: string, note: string) => {
    setMilestoneUpdating(true);
    setMilestoneError(null);
    try {
      await onUpdateMilestone(tripId, status, note);
    } catch (err: any) {
      setMilestoneError(err?.message || "Failed to update trip status. Please try again.");
    } finally {
      setMilestoneUpdating(false);
    }
  };

  if (!trip) {
    return (
      <div className="p-8 text-center bg-card/80 border border-border rounded-xl space-y-3">
        <Navigation className="w-10 h-10 text-muted-foreground mx-auto" />
        <h2 className="text-base font-bold text-foreground">Trip Not Found</h2>
        <p className="text-xs text-muted-foreground">The requested trip could not be found or has been removed.</p>
        <Link href="/trips">
          <Button size="sm" className="bg-amber-400 text-zinc-950 font-bold text-xs mt-2">
            Back to Trips
          </Button>
        </Link>
      </div>
    );
  }

  const startDateStr = new Date(trip.startDate).toLocaleDateString("en-IN", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });

  return (
    <div className="space-y-6">
      {/* Top Header & Breadcrumb */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <Link href="/trips">
            <Button size="sm" variant="outline" className="border-border h-8 w-8 p-0">
              <ArrowLeft className="w-4 h-4" />
            </Button>
          </Link>
          <div>
            <div className="flex items-center gap-2">
              <span className="text-xl font-bold font-mono text-amber-700 dark:text-amber-400">{trip.bookingId}</span>
              <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase ${
                trip.status === "completed" ? "bg-emerald-100 dark:bg-emerald-500/20 text-emerald-700 dark:text-emerald-400 border border-emerald-300 dark:border-emerald-500/30" :
                trip.status === "in_progress" ? "bg-amber-100 dark:bg-amber-500/20 text-amber-700 dark:text-amber-300 border border-amber-300 dark:border-amber-500/30 animate-pulse" :
                trip.status === "cancelled" ? "bg-rose-100 dark:bg-rose-500/20 text-rose-700 dark:text-rose-400 border border-rose-300 dark:border-rose-500/30" :
                "bg-muted text-foreground"
              }`}>
                {trip.status?.replaceAll("_", " ")}
              </span>
              {trip.isLocked && (
                <span className="text-[10px] bg-muted text-muted-foreground px-2 py-0.5 rounded border border-border">
                  LOCKED
                </span>
              )}
            </div>
            <p className="text-xs text-muted-foreground mt-0.5">
              {startDateStr} at {trip.startTime} • {(trip.tripType || "").replaceAll("_", " ").toUpperCase()}
            </p>
          </div>
        </div>

        {/* Quick Action Buttons */}
        <div className="flex flex-wrap items-center gap-2">
          {canEditTrip(trip) && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => onOpenEditTrip(trip)}
              className="border-sky-300 dark:border-sky-500/40 text-sky-700 dark:text-sky-300 hover:bg-sky-950/30 text-xs font-semibold"
            >
              <Pencil className="w-3.5 h-3.5 mr-1.5" /> Edit Trip
            </Button>
          )}
          {canEditTrip(trip) && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => onOpenAssignDriver(trip)}
              className="border-purple-300 dark:border-purple-500/40 text-purple-700 dark:text-purple-300 hover:bg-purple-950/30 text-xs font-semibold"
            >
              <UserCog className="w-3.5 h-3.5 mr-1.5" /> {trip.driverId ? "Reassign Driver" : "Assign Driver"}
            </Button>
          )}
          <Button
            size="sm"
            variant="outline"
            onClick={() => onOpenCustomerCopy(trip)}
            className="border-amber-300 dark:border-amber-500/40 text-amber-700 dark:text-amber-300 hover:bg-amber-950/30 text-xs font-semibold"
          >
            <FileText className="w-3.5 h-3.5 mr-1.5" /> Customer Copy
          </Button>
          {Number(trip.remainingBalance) > 0 && (
            <Button
              size="sm"
              onClick={() => onOpenPaymentModal(trip)}
              className="bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs"
            >
              <Receipt className="w-3.5 h-3.5 mr-1.5" /> Record Payment
            </Button>
          )}
          {trip.status !== "cancelled" && trip.status !== "completed" && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => onOpenCancelModal(trip)}
              className="border-rose-300 dark:border-rose-500/40 text-rose-700 dark:text-rose-400 hover:bg-rose-950/30 text-xs font-semibold"
            >
              <XCircle className="w-3.5 h-3.5 mr-1.5" /> Cancel Trip
            </Button>
          )}
        </div>
      </div>

      {/* Main Grid: Financial Card + Route Details */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Route & Passenger Card */}
        <div className="lg:col-span-2 space-y-6">
          {/* Itinerary & Milestones */}
          <div className="bg-card/70 p-5 rounded-xl border border-border space-y-4">
            <h2 className="text-xs font-bold text-foreground uppercase tracking-wider flex items-center gap-2">
              <MapPin className="w-4 h-4 text-amber-700 dark:text-amber-400" /> Route & Itinerary
            </h2>

            <div className="space-y-3 pl-2 border-l-2 border-amber-300 dark:border-amber-500/40 ml-2">
              <div>
                <span className="text-[10px] font-bold text-emerald-700 dark:text-emerald-400 uppercase">Pickup Location</span>
                <div className="text-sm font-semibold text-foreground">{trip.pickup?.name || trip.pickup?.address || "Pickup Location"}</div>
                {trip.pickup?.address && trip.pickup?.name && <div className="text-xs text-muted-foreground">{trip.pickup?.address}</div>}
              </div>

              {Array.isArray(trip.stops) && trip.stops.length > 0 && (
                <div className="pt-1">
                  <span className="text-[10px] font-bold text-amber-700 dark:text-amber-400 uppercase">Waypoints & Stops</span>
                  {trip.stops.map((s: any, idx: number) => (
                    <div key={idx} className="text-xs text-foreground mt-0.5">
                      • {s.name || s.address} {s.address && s.name ? `(${s.address})` : ""}
                    </div>
                  ))}
                </div>
              )}

              <div className="pt-1">
                <span className="text-[10px] font-bold text-rose-700 dark:text-rose-400 uppercase">Destination Location</span>
                <div className="text-sm font-semibold text-foreground">{trip.destination?.name || trip.destination?.address || "Destination"}</div>
                {trip.destination?.address && trip.destination?.name && <div className="text-xs text-muted-foreground">{trip.destination?.address}</div>}
              </div>
            </div>

            {/* Interactive Live Route Map */}
            <div className="pt-2">
              <RealtimeFleetMap
                pickup={trip.pickup || { name: "Pickup" }}
                destination={trip.destination || { name: "Destination" }}
                stops={trip.stops || []}
                activeTrip={trip}
                billingKm={Number(trip.billingKm || 0)}
                estimatedToll={Number(trip.finalToll || trip.estimatedToll || 0)}
                height="380px"
              />
            </div>

            {trip.selectedRouteSummary && (
              <div className="bg-background/60 p-2.5 rounded-lg border border-border text-xs text-muted-foreground flex items-center gap-2">
                <Navigation className="w-3.5 h-3.5 text-amber-700 dark:text-amber-400 flex-shrink-0" />
                <span>Selected Route: <strong>{trip.selectedRouteSummary}</strong></span>
              </div>
            )}
          </div>

          {/* Driver & Odometer Operations */}
          <div className="bg-card/70 p-5 rounded-xl border border-border space-y-4">
            <h2 className="text-xs font-bold text-foreground uppercase tracking-wider flex items-center gap-2">
              <Gauge className="w-4 h-4 text-amber-700 dark:text-amber-400" /> Driver & Odometer KM Tracking
            </h2>

            <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 bg-background/60 p-3 rounded-lg border border-border text-xs">
              <div className="col-span-2 sm:col-span-1">
                <span className="text-muted-foreground text-[10px] block">Assigned Driver</span>
                <span className="font-bold text-foreground">{trip.driverName || "Unassigned"}</span>
                <span className="text-muted-foreground block text-[11px]">{trip.driverMobile || "No phone"}</span>
              </div>
              {[
                { label: "Left Stand", km: trip.standStartKm, photo: trip.standStartPhoto },
                { label: "Pickup (Start)", km: trip.startingKm, photo: trip.startKmPhoto },
                { label: "Drop (End)", km: trip.endingKm, photo: trip.endKmPhoto },
                { label: "Back at Stand", km: trip.standReturnKm, photo: trip.standReturnPhoto },
              ].map((reading) => (
                <div key={reading.label}>
                  <span className="text-muted-foreground text-[10px] block">{reading.label}</span>
                  <div className="flex items-center gap-1.5">
                    <span className="font-mono font-bold text-foreground text-sm">
                      {reading.km != null && reading.km !== "" ? `${reading.km} km` : "Pending"}
                    </span>
                    {reading.photo && (
                      <button
                        type="button"
                        onClick={() => openExternalUrl(reading.photo)}
                        title="View odometer photo"
                        className="shrink-0 cursor-pointer"
                      >
                        <img src={reading.photo} alt={`${reading.label} odometer`} className="w-6 h-6 rounded object-cover border border-border hover:border-amber-400 transition-colors" />
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>

            {/* Distance split: empty running at each end vs the billed trip */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
              {[
                { label: "Stand → Pickup", km: trip.standToPickupKm, tone: "text-purple-700 dark:text-purple-400", note: "Empty running" },
                { label: "Pickup → Drop", km: trip.actualKm, tone: "text-emerald-700 dark:text-emerald-400", note: "Trip KM (billed)" },
                { label: "Drop → Stand", km: trip.dropToStandKm, tone: "text-purple-700 dark:text-purple-400", note: "Empty running" },
                { label: "Stand → Stand", km: trip.standToStandKm, tone: "text-amber-700 dark:text-amber-400", note: "Total vehicle KM" },
              ].map((leg) => (
                <div key={leg.label} className="bg-background/60 p-3 rounded-lg border border-border">
                  <span className="text-muted-foreground text-[10px] block">{leg.label}</span>
                  <span className={`font-mono font-bold text-sm ${leg.tone}`}>
                    {leg.km != null ? `${leg.km} km` : "-"}
                  </span>
                  <span className="text-muted-foreground text-[10px] block">{leg.note}</span>
                </div>
              ))}
            </div>

            {trip.status === "completed" && onOpenStandKmModal && (
              <Button
                size="sm"
                variant="outline"
                onClick={() => onOpenStandKmModal(trip)}
                className="w-full h-9 text-xs border-purple-300 dark:border-purple-500/40 text-purple-700 dark:text-purple-300 hover:bg-purple-950/20 cursor-pointer"
              >
                <Gauge className="w-3.5 h-3.5 mr-1.5" />
                {trip.standReturnKm != null ? "Correct Back-at-Stand KM" : "Record Back-at-Stand KM"}
              </Button>
            )}
          </div>

          {/* Ops Trip Lifecycle Control — same stage-by-stage progression the
              driver app runs, exposed here so operations can advance a trip
              on the driver's behalf (phone issues, manual dispatch, etc). */}
          {trip.status !== "cancelled" && trip.status !== "completed" && (
            <div className="bg-card/70 p-5 rounded-xl border border-border space-y-3">
              <h2 className="text-xs font-bold text-foreground uppercase tracking-wider flex items-center gap-2">
                <Radio className="w-4 h-4 text-amber-700 dark:text-amber-400" /> Trip Lifecycle Control (Ops Override)
              </h2>

              {!trip.driverId ? (
                <div className="bg-background/60 p-3 rounded-lg border border-dashed border-border text-xs text-muted-foreground flex items-center justify-between gap-3">
                  <span>Assign a driver before advancing the trip stage.</span>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => onOpenAssignDriver(trip)}
                    className="h-7 text-[11px] border-purple-300 dark:border-purple-500/40 text-purple-700 dark:text-purple-300 hover:bg-purple-950/30 shrink-0"
                  >
                    <UserCog className="w-3.5 h-3.5 mr-1" /> Assign Driver
                  </Button>
                </div>
              ) : (
                <div className="space-y-2">
                  {(trip.status === "assigned" || trip.status === "upcoming") && (
                    <Button
                      disabled={milestoneUpdating}
                      onClick={() => handleMilestone(trip.id, "accepted", "Trip accepted on driver's behalf (ops)")}
                      className="w-full bg-emerald-500 hover:bg-emerald-400 text-zinc-950 font-black py-5 text-xs cursor-pointer shadow-lg shadow-emerald-500/20 uppercase tracking-wide"
                    >
                      {milestoneUpdating ? <ButtonLoader label="Accepting Trip..." /> : <><CheckCircle2 className="w-4 h-4 mr-2" /> 1. Accept Trip Assignment</>}
                    </Button>
                  )}

                  {trip.status === "accepted" && (
                    <Button
                      disabled={milestoneUpdating}
                      onClick={() => handleMilestone(trip.id, "driver_arrived", "Driver arrived at pickup point (ops)")}
                      className="w-full bg-sky-500 hover:bg-sky-400 text-zinc-950 font-black py-5 text-xs cursor-pointer shadow-lg shadow-sky-500/20 uppercase tracking-wide"
                    >
                      {milestoneUpdating ? <ButtonLoader label="Confirming Pickup Arrival..." /> : <><MapPin className="w-4 h-4 mr-2" /> 2. Arrived at Pickup Location</>}
                    </Button>
                  )}

                  {trip.status === "driver_arrived" && (
                    <Button
                      onClick={() => onOpenStartKmModal(trip)}
                      className="w-full bg-amber-400 hover:bg-amber-300 text-zinc-950 font-black py-5 text-xs cursor-pointer shadow-lg shadow-amber-400/20 uppercase tracking-wide"
                    >
                      <Gauge className="w-4 h-4 mr-2" /> 3. Start Trip (Enter Starting KM)
                    </Button>
                  )}

                  {trip.status === "started" && (
                    <Button
                      disabled={milestoneUpdating}
                      onClick={() => handleMilestone(trip.id, "in_progress", "Passenger boarded, journey in progress (ops)")}
                      className="w-full bg-amber-400 hover:bg-amber-300 text-zinc-950 font-black py-5 text-xs cursor-pointer shadow-lg shadow-amber-400/20 uppercase tracking-wide"
                    >
                      {milestoneUpdating ? <ButtonLoader label="Starting Transit..." /> : <><Navigation className="w-4 h-4 mr-2" /> 4. Passenger Boarded (In Progress)</>}
                    </Button>
                  )}

                  {trip.status === "in_progress" && (
                    <Button
                      disabled={milestoneUpdating}
                      onClick={() => handleMilestone(trip.id, "reached_destination", "Arrived at final destination (ops)")}
                      className="w-full bg-sky-500 hover:bg-sky-400 text-zinc-950 font-black py-5 text-xs cursor-pointer shadow-lg shadow-sky-500/20 uppercase tracking-wide"
                    >
                      {milestoneUpdating ? <ButtonLoader label="Confirming Destination Arrival..." /> : <><MapPin className="w-4 h-4 mr-2" /> 5. Reached Destination</>}
                    </Button>
                  )}

                  {trip.status === "reached_destination" && (
                    <Button
                      onClick={() => onOpenEndKmModal(trip)}
                      className="w-full bg-emerald-600 hover:bg-emerald-500 text-white font-black py-5 text-xs cursor-pointer shadow-lg shadow-emerald-600/20 uppercase tracking-wide"
                    >
                      <Gauge className="w-4 h-4 mr-2" /> 6. Complete Trip (Enter Ending KM)
                    </Button>
                  )}

                  {milestoneError && (
                    <div className="bg-rose-950/40 border border-rose-300 dark:border-rose-500/40 rounded-xl p-3 flex items-center gap-2 text-xs text-rose-700 dark:text-rose-300">
                      <AlertCircle className="w-4 h-4 flex-shrink-0" />
                      <span>{milestoneError}</span>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Payments Ledger for this Trip */}
          <div className="bg-card/70 p-5 rounded-xl border border-border space-y-3">
            <div className="flex justify-between items-center">
              <h2 className="text-xs font-bold text-foreground uppercase tracking-wider flex items-center gap-2">
                <Receipt className="w-4 h-4 text-emerald-700 dark:text-emerald-400" /> Payment Ledger ({payments.length})
              </h2>
              {Number(trip.remainingBalance) > 0 && (
                <Button size="sm" onClick={() => onOpenPaymentModal(trip)} className="h-7 text-xs bg-emerald-600 hover:bg-emerald-500 text-white">
                  <Plus className="w-3 h-3 mr-1" /> Add Payment
                </Button>
              )}
            </div>

            {payments.length === 0 ? (
              <p className="text-xs text-muted-foreground py-3 text-center">No payment entries recorded yet.</p>
            ) : (
              <div className="space-y-2">
                {payments.map((p) => (
                  <div key={p.id} className="bg-background/60 p-3 rounded-lg border border-border flex items-center justify-between text-xs">
                    <div>
                      <span className="font-bold text-emerald-700 dark:text-emerald-400 font-mono text-sm">{formatINR(p.amount)}</span>
                      <span className="text-muted-foreground ml-2">via {p.method} ({p.paymentType})</span>
                      {p.reference && <div className="text-[11px] text-muted-foreground font-mono mt-0.5">Ref: {p.reference}</div>}
                    </div>
                    <div className="text-right text-muted-foreground text-[11px]">
                      {new Date(p.paymentDate || p.createdAt).toLocaleDateString("en-IN")}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Operational Expenses for this Trip */}
          <div className="bg-card/70 p-5 rounded-xl border border-border space-y-3">
            <div className="flex justify-between items-center">
              <h2 className="text-xs font-bold text-foreground uppercase tracking-wider flex items-center gap-2">
                <Fuel className="w-4 h-4 text-rose-700 dark:text-rose-400" /> Operational Expenses ({expenses.length})
              </h2>
              <Button size="sm" onClick={() => onOpenExpenseModal(trip.id)} className="h-7 text-xs bg-rose-600 hover:bg-rose-500 text-white">
                <Plus className="w-3 h-3 mr-1" /> Add Expense
              </Button>
            </div>

            {expenses.length === 0 ? (
              <p className="text-xs text-muted-foreground py-3 text-center">No expenses submitted for this trip.</p>
            ) : (
              <div className="space-y-2">
                {expenses.map((exp) => (
                  <div key={exp.id} className="bg-background/60 p-3 rounded-lg border border-border flex items-center justify-between text-xs gap-3">
                    <div className="flex items-center gap-3 min-w-0">
                      {exp.receiptPath ? (
                        <button
                          type="button"
                          onClick={() => openExternalUrl(exp.receiptPath)}
                          title="View proof of payment"
                          className="shrink-0 cursor-pointer"
                        >
                          {/\.pdf($|\?)/i.test(exp.receiptPath) ? (
                            <div className="w-11 h-11 rounded-lg border border-border bg-card flex items-center justify-center hover:border-amber-400 transition-colors">
                              <FileText className="w-4 h-4 text-amber-700 dark:text-amber-400" />
                            </div>
                          ) : (
                            <img
                              src={exp.receiptPath}
                              alt="Proof of payment"
                              className="w-11 h-11 rounded-lg object-cover border border-border hover:border-amber-400 transition-colors"
                            />
                          )}
                        </button>
                      ) : (
                        <div
                          className="w-11 h-11 rounded-lg border border-dashed border-rose-300 dark:border-rose-500/40 flex items-center justify-center shrink-0"
                          title="No proof attached"
                        >
                          <AlertCircle className="w-4 h-4 text-rose-700 dark:text-rose-400" />
                        </div>
                      )}
                      <div className="space-y-0.5 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-bold text-rose-700 dark:text-rose-400 font-mono">{formatINR(exp.amount)}</span>
                          <span className="font-semibold text-foreground">• {exp.category}</span>
                          <span className={`text-[10px] font-bold px-1.5 py-0.2 rounded capitalize ${
                            exp.status === "approved" ? "bg-emerald-100 dark:bg-emerald-500/20 text-emerald-700 dark:text-emerald-400 border border-emerald-300 dark:border-emerald-500/30" :
                            exp.status === "rejected" ? "bg-rose-100 dark:bg-rose-500/20 text-rose-700 dark:text-rose-400 border border-rose-300 dark:border-rose-500/30" :
                            "bg-amber-100 dark:bg-amber-500/20 text-amber-700 dark:text-amber-300 border border-amber-300 dark:border-amber-500/30 animate-pulse"
                          }`}>
                            {exp.status}
                          </span>
                        </div>
                        {exp.notes && <p className="text-[11px] text-muted-foreground">{exp.notes}</p>}
                      </div>
                    </div>

                    {exp.status === "pending" && onApproveExpense && onRejectExpense && (
                      <div className="flex items-center gap-1.5">
                        <Button
                          size="sm"
                          onClick={() => handleApproveExpense(exp.id)}
                          disabled={Boolean(pendingExpenseAction)}
                          className="h-7 px-2 text-[11px] bg-emerald-600 hover:bg-emerald-500 text-white font-bold"
                        >
                          {pendingExpenseAction && pendingExpenseAction.id === exp.id && pendingExpenseAction.action === "approve" ? (
                            <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          ) : (
                            "Approve"
                          )}
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => handleRejectExpense(exp.id)}
                          disabled={Boolean(pendingExpenseAction)}
                          className="h-7 px-2 text-[11px] text-rose-700 dark:text-rose-400 hover:bg-rose-950/30"
                        >
                          {pendingExpenseAction && pendingExpenseAction.id === exp.id && pendingExpenseAction.action === "reject" ? (
                            <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          ) : (
                            "Reject"
                          )}
                        </Button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Right Financial Breakdown Sidebar */}
        <div className="space-y-6">
          {/* Central Financial Summary Card */}
          <div className="bg-card/80 p-5 rounded-xl border border-border space-y-4 shadow-xl">
            <h2 className="text-xs font-bold text-amber-700 dark:text-amber-400 uppercase tracking-wider">
              Central Fare & Financial Summary
            </h2>

            <div className="space-y-2 text-xs divide-y divide-border/60">
              <div className="flex justify-between py-1.5">
                <span className="text-muted-foreground">Google Map Distance</span>
                <span className="font-mono text-foreground">{trip.mapDistanceKm} km</span>
              </div>
              <div className="flex justify-between py-1.5">
                <span className="text-muted-foreground">Billing Distance</span>
                <span className="font-mono font-bold text-foreground">{trip.billingKm} km</span>
              </div>
              <div className="flex justify-between py-1.5">
                <span className="text-muted-foreground">{trip.pricingMode === "package" ? "Pricing" : "Rate Per KM"}</span>
                <span className="font-mono text-foreground">
                  {trip.pricingMode === "package" ? "Flat Package Rate" : `₹${trip.ratePerKm}/km`}
                </span>
              </div>
              <div className="flex justify-between py-1.5">
                <span className="text-foreground font-medium">
                  {trip.pricingMode === "package" ? "Package Fare" : "Base Vehicle Fare"}
                </span>
                <span className="font-mono font-medium text-foreground">{formatINR(trip.baseFare)}</span>
              </div>
              <div className="flex justify-between py-1.5">
                <span className="text-muted-foreground">Customer Toll</span>
                <span className="font-mono text-foreground">{formatINR(trip.toll)}</span>
              </div>
              <div className="flex justify-between py-1.5">
                <span className="text-muted-foreground">Customer Parking</span>
                <span className="font-mono text-foreground">{formatINR(trip.parking)}</span>
              </div>
              <div className="flex justify-between py-1.5">
                <span className="text-muted-foreground">State Permit Charges</span>
                <span className="font-mono text-foreground">{formatINR(trip.permitCharge)}</span>
              </div>

              {/* Customer Total */}
              <div className="flex justify-between pt-3 pb-1 border-t-2 border-border">
                <span className="font-bold text-foreground text-sm">Customer Total</span>
                <span className="font-mono font-bold text-amber-700 dark:text-amber-400 text-lg">{formatINR(trip.customerTotal)}</span>
              </div>
              <div className="flex justify-between py-1.5 text-emerald-700 dark:text-emerald-400">
                <span>Advance / Total Paid</span>
                <span className="font-mono font-semibold">-{formatINR(trip.totalPaid)}</span>
              </div>
              <div className="flex justify-between py-2 bg-amber-950/30 p-2.5 rounded-lg border border-amber-300 dark:border-amber-500/20 text-sm font-bold text-amber-700 dark:text-amber-300">
                <span>Outstanding Balance</span>
                <span className="font-mono">{formatINR(trip.remainingBalance)}</span>
              </div>
            </div>

            {/* Profit Calculation (Owner only) */}
            <div className="pt-3 border-t border-border text-xs space-y-1.5 bg-background/60 p-3 rounded-lg">
              <div className="flex justify-between text-muted-foreground text-[11px]">
                <span>Approved Company Expenses:</span>
                <span className="font-mono text-rose-700 dark:text-rose-400">{formatINR(trip.expenseTotal || 0)}</span>
              </div>
              {Number(trip.driverCommissionAmount || 0) > 0 && (
                <div className="flex justify-between text-muted-foreground text-[11px]">
                  <span>
                    Driver Commission {trip.driverCommissionType === "percentage" ? `(${trip.driverCommissionValue}%)` : "(Flat)"}:
                  </span>
                  <span className="font-mono text-rose-700 dark:text-rose-400">{formatINR(trip.driverCommissionAmount)}</span>
                </div>
              )}
              <div className="flex justify-between font-bold text-emerald-700 dark:text-emerald-400">
                <span>Trip Operating Profit:</span>
                <span className="font-mono">
                  {formatINR(
                    Number(trip.customerTotal) - Number(trip.expenseTotal || 0) - Number(trip.driverCommissionAmount || 0)
                  )}
                </span>
              </div>
            </div>
          </div>

          {/* Passenger Information */}
          <div className="bg-card/70 p-5 rounded-xl border border-border space-y-3 text-xs">
            <h3 className="text-xs font-bold text-foreground uppercase tracking-wider">Passenger Contact</h3>
            <div className="font-semibold text-sm text-foreground">{trip.customerName}</div>
            <div className="text-muted-foreground">{trip.customerMobile}</div>
            <div className="pt-2">
              <Button
                size="sm"
                onClick={() => openWhatsApp(trip.customerMobile)}
                className="w-full bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs"
              >
                <Phone className="w-3.5 h-3.5 mr-1.5" /> WhatsApp Passenger
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
