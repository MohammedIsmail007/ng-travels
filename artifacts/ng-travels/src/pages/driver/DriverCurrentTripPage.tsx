import { apiFetch } from "@/lib/apiFetch";
import React, { useState, useEffect, useRef } from "react";
import {
  Navigation, Phone, MapPin, Gauge, CheckCircle2, Clock, Map,
  ExternalLink, Fuel, AlertCircle, Radio, Compass, Satellite
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatINR } from "@/lib/fareEngine";
import { RealtimeFleetMap } from "@/components/maps/RealtimeFleetMap";
import { ButtonLoader } from "@/components/loading";
import { openExternalUrl } from "@/lib/openExternal";
import { watchAccuratePosition } from "@/lib/nativeGeo";

interface DriverCurrentTripPageProps {
  trip: any;
  onOpenStartKmModal: (trip: any) => void;
  onOpenEndKmModal: (trip: any) => void;
  onOpenStandKmModal?: (trip: any) => void;
  onOpenExpenseModal: (tripId: number) => void;
  onUpdateMilestone: (tripId: number, status: string, note?: string) => Promise<void>;
}

// Minimum gap between live-location uploads to the server
const GPS_UPLOAD_INTERVAL_MS = 15_000;

export const DriverCurrentTripPage: React.FC<DriverCurrentTripPageProps> = ({
  trip,
  onOpenStartKmModal,
  onOpenEndKmModal,
  onOpenStandKmModal,
  onOpenExpenseModal,
  onUpdateMilestone,
}) => {
  const [updating, setUpdating] = useState(false);
  const [milestoneError, setMilestoneError] = useState<string | null>(null);
  const [gpsTelemetry, setGpsTelemetry] = useState<{
    lat: number;
    lng: number;
    speed: number;
    heading: number;
    accuracy: number;
    lastSynced: Date;
  } | null>(null);

  const status = trip?.status || "upcoming";
  const isTracking = ["started", "reached_pickup", "customer_picked_up", "in_progress"].includes(status);

  // Live GPS Tracking Service
  useEffect(() => {
    if (!trip || !isTracking) return;

    const pLat = trip.pickup?.latitude || 11.3410;
    const pLng = trip.pickup?.longitude || 77.7172;
    const dLat = trip.destination?.latitude || 11.0168;
    const dLng = trip.destination?.longitude || 76.9558;

    // The device reports a fix every 1-2s while moving. The HUD updates on
    // every fix, but the server only gets one every GPS_UPLOAD_INTERVAL_MS —
    // each upload is a DB write plus a broadcast to every connected client.
    let lastUploadAt = 0;
    const pushLocation = async (lat: number, lng: number, speed: number, heading: number, accuracy: number) => {
      setGpsTelemetry({
        lat,
        lng,
        speed: Math.round(speed),
        heading: Math.round(heading),
        accuracy: Math.round(accuracy),
        lastSynced: new Date(),
      });

      const now = Date.now();
      if (now - lastUploadAt < GPS_UPLOAD_INTERVAL_MS) return;
      lastUploadAt = now;

      try {
        await apiFetch(`/api/driver/trips/${trip.id}/location`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            latitude: lat,
            longitude: lng,
            speed: Math.round(speed),
            heading: Math.round(heading),
            accuracy: Math.round(accuracy),
          }),
        });
      } catch (err) {
        console.error("GPS telemetry sync error:", err);
      }
    };

    // Genuine device GPS tracking — prefers the native Capacitor plugin on
    // Android (real GPS fix) over the WebView's navigator.geolocation
    // (often a much coarser network-based fix).
    let cancelled = false;
    let stopWatch: (() => void) | null = null;
    watchAccuratePosition(
      (pos) => {
        const speedKmH = pos.speed !== null && pos.speed !== undefined
          ? Math.max(0, Math.round(pos.speed * 3.6))
          : 0;
        pushLocation(pos.latitude, pos.longitude, speedKmH, pos.heading || 0, pos.accuracy || 10);
      },
      (message) => {
        console.warn("[DriverHUD] Geolocation watch notice:", message);
      },
    ).then((stop) => {
      if (cancelled) stop();
      else stopWatch = stop;
    });

    return () => {
      cancelled = true;
      stopWatch?.();
    };
  }, [trip?.id, isTracking]);

  if (!trip) {
    return (
      <div className="bg-card/60 p-8 rounded-2xl border border-border text-center text-muted-foreground text-xs space-y-2">
        <Navigation className="w-8 h-8 text-muted-foreground mx-auto" />
        <p>No active trip currently in progress.</p>
      </div>
    );
  }

  const pickupLat = trip.pickup?.latitude || 11.3410;
  const pickupLng = trip.pickup?.longitude || 77.7172;
  const destLat = trip.destination?.latitude || 11.0168;
  const destLng = trip.destination?.longitude || 76.9558;

  const navigateToPickupUrl = `https://www.google.com/maps/dir/?api=1&destination=${pickupLat},${pickupLng}&destination_place_id=${trip.pickup?.placeId || ""}`;
  const navigateToDestUrl = `https://www.google.com/maps/dir/?api=1&destination=${destLat},${destLng}&destination_place_id=${trip.destination?.placeId || ""}`;

  const handleMilestone = async (status: string, note: string) => {
    setUpdating(true);
    setMilestoneError(null);
    try {
      await onUpdateMilestone(trip.id, status, note);
    } catch (err: any) {
      setMilestoneError(err?.message || "Failed to update trip status. Please try again.");
    } finally {
      setUpdating(false);
    }
  };

  return (
    <div className="space-y-4">
      {/* HUD Active Header */}
      <div className="bg-card border border-border p-4 rounded-2xl space-y-3 shadow-xl">
        <div className="flex justify-between items-start">
          <div>
            <span className="font-mono text-[10px] text-amber-700 dark:text-amber-400 font-bold">{trip.bookingId}</span>
            <h1 className="text-base font-extrabold text-foreground mt-0.5">
              {trip.pickup?.name || trip.pickup?.address || "Pickup"} ➔ {trip.destination?.name || trip.destination?.address || "Destination"}
            </h1>
          </div>
          <div className="flex flex-col items-end gap-1">
            <span className="text-[10px] bg-amber-100 dark:bg-amber-500/20 text-amber-700 dark:text-amber-300 font-bold px-2 py-0.5 rounded-full border border-amber-300 dark:border-amber-500/30 uppercase animate-pulse">
              {status.replaceAll("_", " ")}
            </span>
            {isTracking && (
              <span className="text-[9px] bg-emerald-100 dark:bg-emerald-500/20 text-emerald-700 dark:text-emerald-400 font-mono font-bold px-1.5 py-0.5 rounded border border-emerald-300 dark:border-emerald-500/30 flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-ping" /> GPS Live Sync
              </span>
            )}
          </div>
        </div>

        {/* Live GPS Route Map for Driver */}
        <div className="pt-1">
          <RealtimeFleetMap
            pickup={trip.pickup || { name: "Pickup" }}
            destination={trip.destination || { name: "Destination" }}
            stops={trip.stops || []}
            activeTrip={trip}
            billingKm={Number(trip.billingKm || 0)}
            estimatedToll={Number(trip.finalToll || trip.estimatedToll || 0)}
            height="360px"
          />
        </div>

        {/* Passenger Info & Call */}
        <div className="bg-background/80 p-3 rounded-xl border border-border flex items-center justify-between text-xs">
          <div>
            <div className="text-muted-foreground text-[11px]">Passenger:</div>
            <div className="font-bold text-foreground text-sm">{trip.customerName}</div>
            <div className="text-muted-foreground font-mono text-[11px]">{trip.customerMobile}</div>
          </div>
          <a href={`tel:${trip.customerMobile}`} className="block">
            <Button size="sm" className="bg-emerald-600 hover:bg-emerald-500 text-white font-bold h-10 px-4 cursor-pointer">
              <Phone className="w-4 h-4 mr-1.5" /> Call Passenger
            </Button>
          </a>
        </div>
      </div>

      {/* Navigation Buttons (Google Maps Deep Links) */}
      <div className="grid grid-cols-2 gap-2">
        <Button
          variant="outline"
          onClick={() => openExternalUrl(navigateToPickupUrl)}
          className="w-full border-border bg-card/80 hover:bg-muted text-foreground font-bold text-xs py-5 cursor-pointer"
        >
          <ExternalLink className="w-4 h-4 mr-1 text-emerald-700 dark:text-emerald-400" /> Nav to Pickup
        </Button>
        <Button
          variant="outline"
          onClick={() => openExternalUrl(navigateToDestUrl)}
          className="w-full border-border bg-card/80 hover:bg-muted text-foreground font-bold text-xs py-5 cursor-pointer"
        >
          <ExternalLink className="w-4 h-4 mr-1 text-amber-700 dark:text-amber-400" /> Nav to Dest
        </Button>
      </div>

      {/* Journey Milestone Stepper Buttons */}
      <div className="bg-card/80 border border-border p-4 rounded-2xl space-y-3">
        <div className="text-xs font-bold text-foreground uppercase tracking-wider flex items-center justify-between">
          <span>Journey Progression</span>
          {isTracking && (
            <span className="text-[10px] text-emerald-700 dark:text-emerald-400 font-mono flex items-center gap-1">
              <Radio className="w-3 h-3 text-emerald-700 dark:text-emerald-400 animate-pulse" /> Live Telemetry
            </span>
          )}
        </div>

        <div className="space-y-2">
          {/* Stage 1: Accept Trip */}
          {(status === "assigned" || status === "upcoming") && (
            <Button
              disabled={updating}
              onClick={() => handleMilestone("accepted", "Driver accepted trip assignment")}
              className="w-full bg-emerald-500 hover:bg-emerald-400 text-zinc-950 font-black py-6 text-sm cursor-pointer shadow-lg shadow-emerald-500/20 uppercase tracking-wide"
            >
              {updating ? <ButtonLoader label="Accepting Trip..." /> : <><CheckCircle2 className="w-5 h-5 mr-2" /> 1. Accept Trip Assignment</>}
            </Button>
          )}

          {/* Stage 2: Driver Arrived at Pickup */}
          {status === "accepted" && (
            <Button
              disabled={updating}
              onClick={() => handleMilestone("driver_arrived", "Driver arrived at pickup point")}
              className="w-full bg-sky-500 hover:bg-sky-400 text-zinc-950 font-black py-6 text-sm cursor-pointer shadow-lg shadow-sky-500/20 uppercase tracking-wide"
            >
              {updating ? <ButtonLoader label="Confirming Pickup Arrival..." /> : <><MapPin className="w-5 h-5 mr-2" /> 2. Arrived at Pickup Location</>}
            </Button>
          )}

          {/* Stage 3: Start Trip & Starting KM */}
          {status === "driver_arrived" && (
            <Button
              onClick={() => onOpenStartKmModal(trip)}
              className="w-full bg-amber-400 hover:bg-amber-300 text-zinc-950 font-black py-6 text-sm cursor-pointer shadow-lg shadow-amber-400/20 uppercase tracking-wide"
            >
              <Gauge className="w-5 h-5 mr-2" /> 3. Start Trip (Enter Starting KM)
            </Button>
          )}

          {/* Stage 4: Trip in Progress */}
          {status === "started" && (
            <Button
              disabled={updating}
              onClick={() => handleMilestone("in_progress", "Passenger boarded, journey in progress")}
              className="w-full bg-amber-400 hover:bg-amber-300 text-zinc-950 font-black py-6 text-sm cursor-pointer shadow-lg shadow-amber-400/20 uppercase tracking-wide"
            >
              {updating ? <ButtonLoader label="Starting Transit..." /> : <><Navigation className="w-5 h-5 mr-2" /> 4. Passenger Boarded (In Progress)</>}
            </Button>
          )}

          {/* Stage 5: Reached Destination */}
          {status === "in_progress" && (
            <Button
              disabled={updating}
              onClick={() => handleMilestone("reached_destination", "Arrived at final destination")}
              className="w-full bg-sky-500 hover:bg-sky-400 text-zinc-950 font-black py-6 text-sm cursor-pointer shadow-lg shadow-sky-500/20 uppercase tracking-wide"
            >
              {updating ? <ButtonLoader label="Confirming Destination Arrival..." /> : <><MapPin className="w-5 h-5 mr-2" /> 5. Reached Destination</>}
            </Button>
          )}

          {/* Stage 6: Complete Trip & Ending KM */}
          {status === "reached_destination" && (
            <Button
              onClick={() => onOpenEndKmModal(trip)}
              className="w-full bg-emerald-600 hover:bg-emerald-500 text-white font-black py-6 text-sm cursor-pointer shadow-lg shadow-emerald-600/20 uppercase tracking-wide"
            >
              <Gauge className="w-5 h-5 mr-2" /> 6. Complete Trip (Enter Ending KM)
            </Button>
          )}

          {status === "completed" && (
            <div className="bg-emerald-950/30 border border-emerald-300 dark:border-emerald-500/40 p-3 rounded-xl text-center text-emerald-700 dark:text-emerald-400 font-bold text-xs">
              ✓ Trip Completed & Meter Verified
            </div>
          )}

          {/* Stage 7: Back at Stand KM (empty running after the drop) */}
          {status === "completed" && trip.standReturnKm == null && onOpenStandKmModal && (
            <Button
              onClick={() => onOpenStandKmModal(trip)}
              className="w-full bg-purple-600 hover:bg-purple-500 text-white font-black py-6 text-sm cursor-pointer shadow-lg shadow-purple-600/20 uppercase tracking-wide"
            >
              <Gauge className="w-5 h-5 mr-2" /> 7. Back at Stand (Enter Stand KM)
            </Button>
          )}

          {milestoneError && (
            <div className="bg-rose-950/40 border border-rose-300 dark:border-rose-500/40 rounded-xl p-3 flex items-center gap-2 text-xs text-rose-700 dark:text-rose-300">
              <AlertCircle className="w-4 h-4 flex-shrink-0" />
              <span>{milestoneError}</span>
            </div>
          )}
        </div>
      </div>

      {/* Odometer KM Summary: stand → pickup → drop → stand */}
      <div className="bg-card/60 p-4 rounded-2xl border border-border text-xs space-y-3">
        <div className="grid grid-cols-4 gap-2 text-center">
          <div>
            <span className="text-muted-foreground text-[10px] block">Stand Out</span>
            <span className="font-mono font-bold text-foreground">{trip.standStartKm != null ? trip.standStartKm : "-"}</span>
          </div>
          <div>
            <span className="text-muted-foreground text-[10px] block">Pickup</span>
            <span className="font-mono font-bold text-foreground">{trip.startingKm ? trip.startingKm : "-"}</span>
          </div>
          <div>
            <span className="text-muted-foreground text-[10px] block">Drop</span>
            <span className="font-mono font-bold text-foreground">{trip.endingKm ? trip.endingKm : "-"}</span>
          </div>
          <div>
            <span className="text-muted-foreground text-[10px] block">Stand In</span>
            <span className="font-mono font-bold text-foreground">{trip.standReturnKm != null ? trip.standReturnKm : "-"}</span>
          </div>
        </div>
        <div className="grid grid-cols-3 gap-2 text-center pt-2 border-t border-border">
          <div>
            <span className="text-muted-foreground text-[10px] block">Stand → Pickup</span>
            <span className="font-mono font-bold text-purple-700 dark:text-purple-400">{trip.standToPickupKm != null ? `${trip.standToPickupKm} km` : "-"}</span>
          </div>
          <div>
            <span className="text-muted-foreground text-[10px] block">Trip KM</span>
            <span className="font-mono font-bold text-emerald-700 dark:text-emerald-400">{trip.actualKm ? `${trip.actualKm} km` : "In run"}</span>
          </div>
          <div>
            <span className="text-muted-foreground text-[10px] block">Drop → Stand</span>
            <span className="font-mono font-bold text-purple-700 dark:text-purple-400">{trip.dropToStandKm != null ? `${trip.dropToStandKm} km` : "-"}</span>
          </div>
        </div>
      </div>
    </div>
  );
};
