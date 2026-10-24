import { apiFetch } from "@/lib/apiFetch";
import React, { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Calendar, CheckCircle2, Navigation, IndianRupee, Clock,
  MapPin, Gauge, Receipt, Filter, ChevronRight
} from "lucide-react";
import { formatINR } from "@/lib/fareEngine";
import { NGTravelsLoader } from "@/components/loading";
import { routeLabel } from "@/lib/tripRoute";

export const DriverHistoryPage: React.FC = () => {
  const { data: trips = [], isLoading } = useQuery({
    queryKey: ["/api/trips", "completed"],
    queryFn: async () => {
      const res = await apiFetch("/api/trips?status=completed");
      if (!res.ok) return [];
      const data = await res.json();
      return Array.isArray(data) ? data : (Array.isArray((data as any)?.items) ? (data as any).items : []);
    },
  });

  const totalKmRun = trips.reduce((sum: number, t: any) => sum + Number(t.actualKm || t.billingKm || 0), 0);
  const totalBataEarnings = trips.length * 500; // Standard driver bata calculation

  return (
    <div className="space-y-4">
      {/* Header & Earnings Summary */}
      <div className="bg-gradient-to-r from-card to-amber-950/40 p-5 rounded-2xl border border-amber-300 dark:border-amber-500/30 shadow-xl space-y-3">
        <div>
          <span className="text-[10px] font-bold text-amber-700 dark:text-amber-400 uppercase tracking-wider font-mono">
            Commercial Duty Records
          </span>
          <h1 className="text-xl font-black text-foreground mt-0.5">Duty History & Bata Payouts</h1>
          <p className="text-xs text-foreground mt-0.5">Verified completed routes and verified meter runs</p>
        </div>

        <div className="grid grid-cols-3 gap-2 pt-1 font-mono text-center text-xs">
          <div className="bg-background/80 p-2.5 rounded-xl border border-border">
            <span className="text-[10px] text-muted-foreground block uppercase font-bold">Trips Done</span>
            <span className="text-lg font-black text-foreground">{trips.length}</span>
          </div>
          <div className="bg-background/80 p-2.5 rounded-xl border border-border">
            <span className="text-[10px] text-muted-foreground block uppercase font-bold">Total KM</span>
            <span className="text-lg font-black text-amber-700 dark:text-amber-400">{totalKmRun.toLocaleString()}</span>
          </div>
          <div className="bg-background/80 p-2.5 rounded-xl border border-border">
            <span className="text-[10px] text-muted-foreground block uppercase font-bold">Driver Bata</span>
            <span className="text-lg font-black text-emerald-700 dark:text-emerald-400">{formatINR(totalBataEarnings)}</span>
          </div>
        </div>
      </div>

      {/* Trips List */}
      <div className="space-y-3">
        <h2 className="text-xs font-bold text-muted-foreground uppercase tracking-wider">Completed Journeys</h2>

        {isLoading ? (
          <div className="py-8 flex justify-center">
            <NGTravelsLoader size="sm" text="Auditing completed journey records..." />
          </div>
        ) : trips.length === 0 ? (
          <div className="p-8 text-center bg-card/50 rounded-2xl border border-border text-muted-foreground text-xs">
            No completed trips on record yet.
          </div>
        ) : (
          trips.map((t: any) => (
            <div
              key={t.id}
              className="bg-card/90 border border-border/90 p-4 rounded-2xl space-y-2.5 shadow-md"
            >
              <div className="flex justify-between items-start">
                <div>
                  <span className="font-mono text-[10px] font-bold text-amber-700 dark:text-amber-400">{t.bookingId}</span>
                  <h3 className="text-sm font-extrabold text-foreground mt-0.5">
                    {routeLabel(t.pickup, t.stops, t.destination)}
                  </h3>
                </div>
                <span className="bg-emerald-100 dark:bg-emerald-500/20 text-emerald-700 dark:text-emerald-400 border border-emerald-300 dark:border-emerald-500/30 text-[10px] font-bold px-2 py-0.5 rounded-full flex items-center gap-1">
                  <CheckCircle2 className="w-3 h-3" /> Completed
                </span>
              </div>

              <div className="grid grid-cols-3 gap-2 bg-background/70 p-2.5 rounded-xl border border-border/70 text-xs font-mono text-center">
                <div>
                  <span className="text-[10px] text-muted-foreground block">Start KM</span>
                  <span className="font-bold text-foreground">{t.startingKm || "0"}</span>
                </div>
                <div>
                  <span className="text-[10px] text-muted-foreground block">End KM</span>
                  <span className="font-bold text-foreground">{t.endingKm || "0"}</span>
                </div>
                <div>
                  <span className="text-[10px] text-muted-foreground block">Actual Run</span>
                  <span className="font-bold text-amber-700 dark:text-amber-300">{t.actualKm || t.billingKm || "0"} KM</span>
                </div>
              </div>

              <div className="flex justify-between items-center text-[11px] text-muted-foreground pt-1">
                <span>Passenger: <strong className="text-foreground">{t.customerName}</strong></span>
                <span>Date: <strong className="text-foreground">{new Date(t.startDate).toLocaleDateString("en-IN")}</strong></span>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
};
