import React from "react";
import { Link } from "wouter";
import {
  Navigation, Calendar, Gauge, Receipt, Phone, MapPin, CheckCircle2,
  Clock, ArrowRight, Fuel, AlertCircle, Plus
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatINR } from "@/lib/fareEngine";
import { NGTravelsLoader } from "@/components/loading";

interface DriverDashboardPageProps {
  todayTrips: any[];
  currentTrip: any;
  driver?: any;
  isLoading?: boolean;
  onOpenStartKmModal: (trip: any) => void;
  onOpenEndKmModal: (trip: any) => void;
  onOpenStandKmModal?: (trip: any) => void;
  onOpenExpenseModal: (tripId: number) => void;
}

export const DriverDashboardPage: React.FC<DriverDashboardPageProps> = ({
  todayTrips = [],
  currentTrip,
  driver: driverProp,
  isLoading = false,
  onOpenStartKmModal,
  onOpenEndKmModal,
  onOpenStandKmModal,
  onOpenExpenseModal,
}) => {
  // A plain default param doesn't cover an explicit `null` prop (only
  // `undefined`), and the driver profile query can briefly resolve to null.
  const driver = driverProp || { name: "Driver Pilot" };
  const activeTrip = currentTrip || todayTrips[0];
  const completedToday = todayTrips.filter((t) => t.status === "completed").length;

  return (
    <div className="space-y-4">
      {/* Driver Welcome Card */}
      <div className="bg-gradient-to-r from-amber-950/40 to-card p-4 rounded-2xl border border-amber-300 dark:border-amber-500/30">
        <div className="flex justify-between items-center">
          <div>
            <span className="text-[10px] font-bold text-amber-700 dark:text-amber-400 uppercase tracking-wider">Driver Duty Cockpit</span>
            <h1 className="text-lg font-extrabold text-foreground mt-0.5">Welcome, {driver.name}</h1>
            <p className="text-[11px] text-muted-foreground mt-0.5">Vehicle Ready • Commercial Route Active</p>
          </div>
          <div className="text-right">
            <span className="text-xs bg-amber-400 text-zinc-950 font-bold px-2 py-0.5 rounded-full">
              {todayTrips.length} Runs Today
            </span>
          </div>
        </div>
      </div>

      {/* Current Active Trip Banner */}
      {isLoading && !activeTrip ? (
        <div className="bg-card/60 p-6 rounded-2xl border border-border flex justify-center">
          <NGTravelsLoader size="sm" text="Loading today's schedule..." />
        </div>
      ) : activeTrip ? (
        <div className="bg-card/90 border-2 border-amber-300 dark:border-amber-500/50 rounded-2xl p-4 space-y-3 shadow-xl relative overflow-hidden">
          <div className="flex justify-between items-start">
            <div>
              <span className="text-[10px] font-bold text-amber-700 dark:text-amber-400 font-mono">{activeTrip.bookingId}</span>
              <h2 className="text-base font-extrabold text-foreground">
                {activeTrip.pickup?.name || activeTrip.pickup?.address || "Pickup"} ➔ {activeTrip.destination?.name || activeTrip.destination?.address || "Destination"}
              </h2>
            </div>
            <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full capitalize ${
              activeTrip.status === "in_progress" ? "bg-amber-100 dark:bg-amber-500/20 text-amber-700 dark:text-amber-300 border border-amber-300 dark:border-amber-500/40 animate-pulse" :
              activeTrip.status === "started" ? "bg-sky-100 dark:bg-sky-500/20 text-sky-700 dark:text-sky-300 border border-sky-300 dark:border-sky-500/40" :
              "bg-muted text-foreground"
            }`}>
              {activeTrip.status?.replaceAll("_", " ")}
            </span>
          </div>

          <div className="bg-background/70 p-3 rounded-xl border border-border/80 text-xs space-y-1.5">
            <div className="flex justify-between text-foreground">
              <span className="text-muted-foreground">Passenger:</span>
              <span className="font-bold">{activeTrip.customerName || "Corporate Passenger"}</span>
            </div>
            <div className="flex justify-between text-foreground">
              <span className="text-muted-foreground">Contact:</span>
              <span className="font-mono text-amber-700 dark:text-amber-300">{activeTrip.customerMobile}</span>
            </div>
            <div className="flex justify-between text-foreground">
              <span className="text-muted-foreground">Start Time:</span>
              <span>{activeTrip.startTime}</span>
            </div>
          </div>

          {/* Large Touch Action Buttons */}
          <div className="grid grid-cols-2 gap-2 pt-1">
            <Link href="/driver/current-trip" className="w-full">
              <Button className="w-full bg-amber-400 hover:bg-amber-300 text-zinc-950 font-bold text-xs py-5">
                <Navigation className="w-4 h-4 mr-1.5" /> Navigate & HUD
              </Button>
            </Link>

            {activeTrip.status === "upcoming" ? (
              <Button
                onClick={() => onOpenStartKmModal(activeTrip)}
                className="bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs py-5"
              >
                <Gauge className="w-4 h-4 mr-1.5" /> Start Trip (KM)
              </Button>
            ) : activeTrip.status !== "completed" ? (
              <Button
                onClick={() => onOpenEndKmModal(activeTrip)}
                className="bg-sky-600 hover:bg-sky-500 text-white font-bold text-xs py-5"
              >
                <CheckCircle2 className="w-4 h-4 mr-1.5" /> End Trip (KM)
              </Button>
            ) : activeTrip.standReturnKm == null && onOpenStandKmModal ? (
              <Button
                onClick={() => onOpenStandKmModal(activeTrip)}
                className="bg-purple-600 hover:bg-purple-500 text-white font-bold text-xs py-5"
              >
                <Gauge className="w-4 h-4 mr-1.5" /> Back at Stand (KM)
              </Button>
            ) : (
              <Button disabled className="bg-muted text-muted-foreground font-bold text-xs py-5">
                Trip Completed
              </Button>
            )}
          </div>
        </div>
      ) : (
        <div className="bg-card/60 p-6 rounded-2xl border border-border text-center text-muted-foreground text-xs">
          No active trip right now. Relax or check your upcoming schedule.
        </div>
      )}

      {/* Quick Action Grid */}
      <div className="grid grid-cols-2 gap-3">
        <Link href="/driver/today">
          <div className="bg-card/70 p-4 rounded-xl border border-border hover:border-border transition-all text-left cursor-pointer space-y-1">
            <Calendar className="w-5 h-5 text-amber-700 dark:text-amber-400" />
            <div className="font-bold text-xs text-foreground">Today's Runs</div>
            <p className="text-[10px] text-muted-foreground">{todayTrips.length} scheduled trips</p>
          </div>
        </Link>

        {activeTrip && (
          <div
            onClick={() => onOpenExpenseModal(activeTrip.id)}
            className="bg-card/70 p-4 rounded-xl border border-border hover:border-border transition-all text-left cursor-pointer space-y-1"
          >
            <Fuel className="w-5 h-5 text-rose-700 dark:text-rose-400" />
            <div className="font-bold text-xs text-foreground">+ Add Expense</div>
            <p className="text-[10px] text-muted-foreground">Fuel, Toll or Parking claim</p>
          </div>
        )}
      </div>
    </div>
  );
};
