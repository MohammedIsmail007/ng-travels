import { apiFetch } from "@/lib/apiFetch";
import React, { useState, useEffect, useRef } from "react";
import {
  MapPin, Navigation, Plus, IndianRupee, Clock, ArrowRight,
  Sparkles, Compass, ShieldCheck, Car, AlertCircle, CheckCircle2, RotateCcw
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatINR } from "@/lib/fareEngine";
import { RealtimeFleetMap } from "@/components/maps/RealtimeFleetMap";
import { ButtonLoader } from "@/components/loading";
import { LocationPicker } from "@/components/trips/LocationPicker";

interface RoutePlannerPageProps {
  onOpenTripWizardWithRoute?: (routeData: any) => void;
}

interface PlaceSuggestion {
  placeId: string;
  name: string;
  formattedAddress: string;
  lat: number;
  lng: number;
  city?: string;
  district?: string;
  state?: string;
  country?: string;
}

export const RoutePlannerPage: React.FC<RoutePlannerPageProps> = ({ onOpenTripWizardWithRoute }) => {
  const [pickupInput, setPickupInput] = useState("");
  const [selectedPickup, setSelectedPickup] = useState<PlaceSuggestion | null>(null);

  const [destInput, setDestInput] = useState("");
  const [selectedDest, setSelectedDest] = useState<PlaceSuggestion | null>(null);

  const [stops, setStops] = useState<any[]>([]);
  const [stopInput, setStopInput] = useState("");
  const [stopSuggestions, setStopSuggestions] = useState<any[]>([]);
  const [stopSearching, setStopSearching] = useState(false);
  const stopSearchBoxRef = useRef<HTMLDivElement>(null);
  const [loading, setLoading] = useState(false);
  const [tripType, setTripType] = useState<"single" | "round">("round");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Route calculation results
  const [routes, setRoutes] = useState<any[]>([]);
  const [selectedRouteIdx, setSelectedRouteIdx] = useState(0);
  const [outboundMapKm, setOutboundMapKm] = useState(0);
  const [returnMapKm, setReturnMapKm] = useState(0);
  const [totalMapKm, setTotalMapKm] = useState(0);
  const [outboundDurationMinutes, setOutboundDurationMinutes] = useState(0);
  const [returnDurationMinutes, setReturnDurationMinutes] = useState(0);
  const [outboundCoordinates, setOutboundCoordinates] = useState<[number, number][]>([]);
  const [returnCoordinates, setReturnCoordinates] = useState<[number, number][]>([]);
  const [routeCoordinates, setRouteCoordinates] = useState<[number, number][]>([]);
  const [tollStatus, setTollStatus] = useState<string>("Unavailable / At Actuals");
  const [estimatedToll, setEstimatedToll] = useState<number>(0);
  const [tollPlazas, setTollPlazas] = useState<any[]>([]);
  const [tollRateMode, setTollRateMode] = useState<string | null>(null);

  const reqIdRef = useRef(0);

  // Waypoint search: live autocomplete for the "Add Stop" field, same
  // endpoint the Pickup/Destination pickers use, so a stop carries real
  // coordinates instead of free text that has to be geocoded blind at
  // submit time.
  useEffect(() => {
    if (!stopInput || stopInput.length < 2) {
      setStopSuggestions([]);
      return;
    }
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      setStopSearching(true);
      try {
        const res = await apiFetch(`/api/maps/places/autocomplete?input=${encodeURIComponent(stopInput)}`, {
          signal: controller.signal,
        });
        const data = await res.json();
        setStopSuggestions(Array.isArray(data) ? data : []);
      } catch (err: any) {
        if (err.name !== "AbortError") setStopSuggestions([]);
      } finally {
        setStopSearching(false);
      }
    }, 250);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [stopInput]);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (stopSearchBoxRef.current && !stopSearchBoxRef.current.contains(e.target as Node)) {
        setStopSuggestions([]);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const handleAddStop = () => {
    if (stopInput.trim()) {
      setStops([...stops, { name: stopInput.trim(), address: stopInput.trim(), leg: "both" }]);
      setStopInput("");
      setStopSuggestions([]);
    }
  };

  const handleSelectStopSuggestion = (place: any) => {
    setStops([
      ...stops,
      {
        name: place.name,
        address: place.formattedAddress || place.name,
        lat: place.lat ?? place.latitude,
        lng: place.lng ?? place.longitude,
        latitude: place.latitude ?? place.lat,
        longitude: place.longitude ?? place.lng,
        placeId: place.placeId,
        leg: "both",
      },
    ]);
    setStopInput("");
    setStopSuggestions([]);
  };

  const handleRemoveStop = (idx: number) => {
    setStops(stops.filter((_, i) => i !== idx));
  };

  // Cycles a waypoint between the outbound leg, the return leg, or both —
  // lets a round trip route through different stops on the way out vs. the
  // way back instead of forcing every waypoint onto both directions.
  const LEG_CYCLE = ["both", "outbound", "return"] as const;
  const handleCycleLeg = (idx: number) => {
    setStops(
      stops.map((s, i) => {
        if (i !== idx) return s;
        const current = LEG_CYCLE.indexOf((s.leg || "both") as any);
        return { ...s, leg: LEG_CYCLE[(current + 1) % LEG_CYCLE.length] };
      })
    );
  };

  // Calculate Real Driving Route
  const handleCalculate = async () => {
    setLoading(true);
    setErrorMessage(null);
    const thisReqId = ++reqIdRef.current;

    try {
      const payload = {
        pickup: selectedPickup ? {
          name: selectedPickup.name,
          address: selectedPickup.formattedAddress,
          lat: selectedPickup.lat,
          lng: selectedPickup.lng,
          placeId: selectedPickup.placeId,
          city: selectedPickup.city,
          state: selectedPickup.state,
          country: selectedPickup.country,
        } : { name: pickupInput, address: pickupInput },
        destination: selectedDest ? {
          name: selectedDest.name,
          address: selectedDest.formattedAddress,
          lat: selectedDest.lat,
          lng: selectedDest.lng,
          placeId: selectedDest.placeId,
          city: selectedDest.city,
          state: selectedDest.state,
          country: selectedDest.country,
        } : { name: destInput, address: destInput },
        stops: stops
          .filter((s) => (s.name || "").trim() !== "")
          .map((s) => ({
            name: s.name,
            address: s.address || s.name,
            latitude: s.lat ?? s.latitude,
            longitude: s.lng ?? s.longitude,
            placeId: s.placeId,
            leg: s.leg || "both",
          })),
        tripType: tripType === "round" ? "round_trip" : "single_trip",
      };

      const res = await apiFetch("/api/maps/routes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (thisReqId !== reqIdRef.current) return; // Discard stale response

      const data = await res.json();

      if (!res.ok || !data.routes || data.routes.length === 0) {
        setErrorMessage(data.error || "Unable to calculate the driving route. Please verify the pickup and destination.");
        return;
      }

      setRoutes(data.routes);
      setSelectedRouteIdx(0);
      setOutboundMapKm(data.outboundMapKm || data.routes[0].distanceKm);
      setReturnMapKm(data.returnMapKm || 0);
      setTotalMapKm(data.totalMapKm || data.routes[0].distanceKm);
      setOutboundDurationMinutes(data.outboundLeg?.durationMinutes || data.routes[0].durationMinutes);
      setReturnDurationMinutes(data.returnLeg?.durationMinutes || 0);
      setOutboundCoordinates(data.outboundCoordinates || []);
      setReturnCoordinates(data.returnCoordinates || []);
      setRouteCoordinates(data.routeCoordinates || []);
      setTollStatus(data.tollStatus || "Unavailable / At Actuals");
      setEstimatedToll(data.apiEstimatedToll || 0);
      setTollPlazas(Array.isArray(data.tollPlazas) ? data.tollPlazas : []);
      setTollRateMode(data.tollRateMode || null);
    } catch (err: any) {
      if (thisReqId === reqIdRef.current) {
        setErrorMessage("Network error calculating driving route. Please check connection and try again.");
      }
    } finally {
      if (thisReqId === reqIdRef.current) {
        setLoading(false);
      }
    }
  };

  // Initial calculation on mount
  useEffect(() => {
    handleCalculate();
  }, [tripType]);

  const selected = routes[selectedRouteIdx] || routes[0];

  // Everything the trip wizard needs to show this exact route: locations,
  // stops, distances, toll, durations, polylines and the chosen route option.
  // Picking a non-primary option mirrors what selecting it inside the wizard
  // does (its single distance/toll replace the primary route's legs).
  const buildRoutePlan = () => {
    const isAlternative = selectedRouteIdx > 0 && Boolean(selected);
    const toLocation = (place: PlaceSuggestion | null, text: string) =>
      place
        ? { name: place.name, address: place.formattedAddress, latitude: place.lat, longitude: place.lng, placeId: place.placeId }
        : { name: text, address: text };

    return {
      pickup: toLocation(selectedPickup, pickupInput),
      destination: toLocation(selectedDest, destInput),
      stops: stops
        .filter((st) => (st.name || "").trim() !== "")
        .map((st) => ({ name: st.name, address: st.address || st.name, lat: st.lat, lng: st.lng, placeId: st.placeId, leg: st.leg || "both" })),
      tripType: tripType === "round" ? "round_trip" : "single_trip",
      routes,
      selectedRouteIdx,
      routeSummary: selected?.summary || "",
      totalMapKm: isAlternative ? selected.distanceKm : totalMapKm || selected?.distanceKm || 0,
      outboundMapKm: isAlternative ? 0 : outboundMapKm,
      returnMapKm: isAlternative ? 0 : returnMapKm,
      estimatedToll: isAlternative ? selected.estimatedToll || 0 : estimatedToll,
      outboundDurationMinutes: isAlternative ? selected.durationMinutes || 0 : outboundDurationMinutes,
      returnDurationMinutes: isAlternative ? 0 : returnDurationMinutes,
      outboundCoordinates: isAlternative ? selected.polylineCoordinates || [] : outboundCoordinates,
      returnCoordinates: isAlternative ? [] : returnCoordinates,
      routeCoordinates: isAlternative ? [] : routeCoordinates,
      tollPlazas: isAlternative ? [] : tollPlazas,
      tollRateMode,
      tollStatus,
    };
  };

  const handleSelectPickup = (p: any) => {
    setSelectedPickup(p);
  };

  const handleSelectDest = (p: any) => {
    setSelectedDest(p);
  };

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-black text-foreground flex items-center gap-2">
            <MapPin className="w-5 h-5 text-amber-700 dark:text-amber-400" />
            Google Maps Route Intelligence & Live GPS Planner
          </h1>
          <p className="text-xs text-muted-foreground mt-0.5">
            Real driving highway routing, independent outbound & return legs, authentic road coordinates, and verified commercial mileage.
          </p>
        </div>

        {onOpenTripWizardWithRoute && (
          <Button
            size="sm"
            onClick={() => onOpenTripWizardWithRoute(buildRoutePlan())}
            className="bg-amber-400 hover:bg-amber-300 text-zinc-950 font-bold text-xs h-9 px-4 shadow-lg shadow-amber-400/20 flex items-center gap-1.5 cursor-pointer"
          >
            <Plus className="w-4 h-4" /> Dispatch Trip With This Route
          </Button>
        )}
      </div>

      {errorMessage && (
        <div className="bg-rose-950/40 border border-rose-300 dark:border-rose-500/40 text-rose-700 dark:text-rose-300 p-3.5 rounded-xl text-xs flex items-center gap-2">
          <AlertCircle className="w-4 h-4 flex-shrink-0 text-rose-700 dark:text-rose-400" />
          <span>{errorMessage}</span>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left Form: Route Parameters */}
        <div className="lg:col-span-4 space-y-4 bg-card/80 p-5 rounded-2xl border border-border shadow-xl">
          <div className="flex items-center justify-between">
            <h2 className="text-xs font-bold text-foreground uppercase tracking-wider">Itinerary Configuration</h2>
            <div className="flex bg-background p-0.5 rounded-lg border border-border">
              <button
                type="button"
                onClick={() => setTripType("single")}
                className={`px-2.5 py-1 rounded text-[10px] font-bold transition-all cursor-pointer ${
                  tripType === "single" ? "bg-amber-400 text-zinc-950 shadow-sm" : "text-muted-foreground hover:text-foreground"
                }`}
              >
                One Way
              </button>
              <button
                type="button"
                onClick={() => setTripType("round")}
                className={`px-2.5 py-1 rounded text-[10px] font-bold transition-all cursor-pointer ${
                  tripType === "round" ? "bg-amber-400 text-zinc-950 shadow-sm" : "text-muted-foreground hover:text-foreground"
                }`}
              >
                Round Trip
              </button>
            </div>
          </div>

          {/* Pickup Location */}
          <LocationPicker
            label="Origin / Pickup Location"
            accent="emerald"
            searchPlaceholder="Type pickup place, city, or airport (e.g. Bengaluru, Indiranagar)..."
            value={pickupInput}
            onInputChange={(text) => {
              setPickupInput(text);
              setSelectedPickup(null);
            }}
            onSelect={handleSelectPickup}
          />
          {selectedPickup && (
            <div className="-mt-2 flex items-center gap-1.5 text-[10px] text-emerald-700 dark:text-emerald-400 font-mono">
              <CheckCircle2 className="w-3 h-3" />
              <span>Verified: {selectedPickup.lat.toFixed(4)}, {selectedPickup.lng.toFixed(4)}</span>
            </div>
          )}

          {/* Intermediate Stops */}
          <div className="space-y-2">
            <label className="text-[11px] text-purple-700 dark:text-purple-400 font-bold uppercase flex items-center gap-1">
              <span className="w-2 h-2 rounded-full bg-purple-400" /> Intermediate Waypoints
            </label>
            <div className="relative" ref={stopSearchBoxRef}>
              <div className="flex gap-2">
                <Input
                  value={stopInput}
                  onChange={(e) => setStopInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key !== "Enter") return;
                    e.preventDefault();
                    if (stopSuggestions.length > 0) {
                      handleSelectStopSuggestion(stopSuggestions[0]);
                    } else {
                      handleAddStop();
                    }
                  }}
                  placeholder="Search a place (e.g. Mandya, Maddur, Mysore Road)..."
                  className="bg-background border-border text-xs h-9 flex-1"
                />
                <Button size="sm" type="button" onClick={handleAddStop} className="bg-muted hover:bg-muted text-foreground text-xs h-9 cursor-pointer">
                  <Plus className="w-3.5 h-3.5 mr-1" /> Add
                </Button>
              </div>
              {stopSearching && (
                <span className="text-[10px] text-muted-foreground absolute right-16 top-2.5">Searching...</span>
              )}
              {stopSuggestions.length > 0 && (
                <div className="absolute z-20 left-0 right-16 top-10 bg-card border border-border rounded-xl overflow-hidden shadow-2xl max-h-48 overflow-y-auto">
                  {stopSuggestions.map((place, idx) => (
                    <div
                      key={idx}
                      onClick={() => handleSelectStopSuggestion(place)}
                      className="p-2.5 hover:bg-muted text-xs text-foreground cursor-pointer border-b border-border/60 last:border-0"
                    >
                      <div className="font-semibold">{place.name}</div>
                      <div className="text-[10px] text-muted-foreground truncate">{place.formattedAddress}</div>
                    </div>
                  ))}
                </div>
              )}
            </div>
            <p className="text-[10px] text-muted-foreground">
              Pick a search result to route through accurately — free text with no result selected is geocoded as a best guess.
              {tripType === "round" && " Tap a waypoint's leg tag to restrict it to just the outbound or return journey."}
            </p>
            {stops.length > 0 && (
              <div className="flex flex-wrap gap-2 pt-1">
                {stops.map((stop, idx) => (
                  <div key={idx} className="flex items-center gap-1.5 bg-muted/90 text-foreground px-2.5 py-1 rounded-lg text-xs border border-border">
                    <span className="text-[10px] text-amber-700 dark:text-amber-400 font-mono">#{idx + 1}</span>
                    {(stop.lat || stop.latitude) && (
                      <CheckCircle2 className="w-3 h-3 text-emerald-700 dark:text-emerald-400 shrink-0" />
                    )}
                    <span>{stop.name}</span>
                    {tripType === "round" && (
                      <button
                        type="button"
                        onClick={() => handleCycleLeg(idx)}
                        title="Tap to cycle: Both legs → Outbound only → Return only"
                        className={`ml-1 px-1.5 py-0.5 rounded text-[9px] font-bold uppercase tracking-wide cursor-pointer border ${
                          (stop.leg || "both") === "outbound"
                            ? "bg-sky-950/40 border-sky-400/50 text-sky-700 dark:text-sky-300"
                            : (stop.leg || "both") === "return"
                              ? "bg-purple-950/40 border-purple-400/50 text-purple-700 dark:text-purple-300"
                              : "bg-background border-border text-muted-foreground"
                        }`}
                      >
                        {(stop.leg || "both") === "outbound" ? "Outbound" : (stop.leg || "both") === "return" ? "Return" : "Both Legs"}
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => handleRemoveStop(idx)}
                      className="text-muted-foreground hover:text-rose-700 hover:dark:text-rose-400 cursor-pointer ml-1"
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Destination */}
          <LocationPicker
            label="Destination Dropoff Point"
            accent="amber"
            searchPlaceholder="Type destination city or landmark (e.g. Mysore Palace, Ooty, Chennai)..."
            value={destInput}
            onInputChange={(text) => {
              setDestInput(text);
              setSelectedDest(null);
            }}
            onSelect={handleSelectDest}
          />
          {selectedDest && (
            <div className="-mt-2 flex items-center gap-1.5 text-[10px] text-amber-700 dark:text-amber-400 font-mono">
              <CheckCircle2 className="w-3 h-3" />
              <span>Verified: {selectedDest.lat.toFixed(4)}, {selectedDest.lng.toFixed(4)}</span>
            </div>
          )}

          {/* Calculate CTA */}
          <Button
            onClick={handleCalculate}
            disabled={loading}
            className="w-full bg-amber-400 hover:bg-amber-300 text-zinc-950 font-bold text-xs h-11 shadow-lg shadow-amber-400/20 cursor-pointer"
          >
            {loading ? (
              <ButtonLoader label="Computing Driving Routes..." />
            ) : (
              <>
                <Navigation className="w-4 h-4 mr-1.5" /> Calculate Real Road Route
              </>
            )}
          </Button>

          {/* Round Trip Distance Card (Section 9) */}
          {tripType === "round" && totalMapKm > 0 && (
            <div className="bg-background p-4 rounded-xl border border-amber-300 dark:border-amber-500/30 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-mono font-bold uppercase text-amber-700 dark:text-amber-400 flex items-center gap-1">
                  <RotateCcw className="w-3 h-3" /> ROUND TRIP BREAKDOWN
                </span>
                <span className="text-[10px] font-mono bg-amber-100 dark:bg-amber-400/10 text-amber-700 dark:text-amber-300 px-2 py-0.5 rounded border border-amber-300 dark:border-amber-500/30">
                  REAL ROAD LEGS
                </span>
              </div>

              <div className="space-y-1.5 text-xs font-mono">
                <div className="flex justify-between items-center text-foreground">
                  <span className="text-muted-foreground">Outbound Leg</span>
                  <span className="font-bold text-sky-700 dark:text-sky-400">{outboundMapKm} km</span>
                </div>
                <div className="flex justify-between items-center text-foreground">
                  <span className="text-muted-foreground">Return Leg</span>
                  <span className="font-bold text-purple-700 dark:text-purple-400">{returnMapKm} km</span>
                </div>
                <div className="border-t border-border pt-1.5 flex justify-between items-center font-bold text-foreground">
                  <span>Total Billable Distance</span>
                  <span className="text-amber-700 dark:text-amber-400 text-sm">{totalMapKm} km</span>
                </div>
              </div>

              <div className="border-t border-border pt-2 text-[11px] font-mono text-muted-foreground space-y-1">
                <div className="flex justify-between">
                  <span>Outbound Time:</span>
                  <span className="text-foreground">~{Math.floor(outboundDurationMinutes / 60)}h {outboundDurationMinutes % 60}m</span>
                </div>
                <div className="flex justify-between">
                  <span>Return Time:</span>
                  <span className="text-foreground">~{Math.floor(returnDurationMinutes / 60)}h {returnDurationMinutes % 60}m</span>
                </div>
                <div className="flex justify-between">
                  <span>Highway Toll:</span>
                  <span className="text-emerald-700 dark:text-emerald-400 font-bold">
                    {estimatedToll > 0 ? formatINR(estimatedToll) : tollStatus}
                  </span>
                </div>
              </div>
            </div>
          )}

          {/* Route Options Selector */}
          {routes.length > 0 && (
            <div className="pt-2 space-y-2.5">
              <div className="text-[11px] font-bold text-muted-foreground uppercase">Available Route Options ({routes.length})</div>
              {routes.map((opt, idx) => (
                <div
                  key={idx}
                  onClick={() => setSelectedRouteIdx(idx)}
                  className={`p-3.5 rounded-xl border cursor-pointer transition-all space-y-2 ${
                    selectedRouteIdx === idx
                      ? "bg-amber-950/30 border-amber-400 ring-1 ring-amber-400/50"
                      : "bg-background border-border hover:border-border"
                  }`}
                >
                  <div className="flex justify-between items-start gap-2">
                    <span className="font-bold text-xs text-foreground">{opt.summary}</span>
                    <span className="text-[9px] bg-card text-amber-700 dark:text-amber-300 px-2 py-0.5 rounded font-mono font-bold whitespace-nowrap">
                      {opt.via}
                    </span>
                  </div>

                  <div className="grid grid-cols-3 gap-2 text-xs font-mono pt-1">
                    <div>
                      <span className="text-[9px] text-muted-foreground block uppercase">Distance</span>
                      <span className="font-bold text-foreground">{opt.distanceKm} KM</span>
                    </div>
                    <div>
                      <span className="text-[9px] text-muted-foreground block uppercase">Travel Time</span>
                      <span className="font-bold text-sky-700 dark:text-sky-300">~{Math.floor(opt.durationMinutes / 60)}h {opt.durationMinutes % 60}m</span>
                    </div>
                    <div>
                      <span className="text-[9px] text-muted-foreground block uppercase">Toll Fee</span>
                      <span className="font-bold text-emerald-700 dark:text-emerald-400">
                        {opt.estimatedToll > 0 ? formatINR(opt.estimatedToll) : (opt.tollStatus || "At Actuals")}
                      </span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Right Side: Interactive Real-Time Map Canvas */}
        <div className="lg:col-span-8 space-y-4">
          <RealtimeFleetMap
            pickup={{
              name: selectedPickup ? selectedPickup.name : pickupInput,
              address: selectedPickup ? selectedPickup.formattedAddress : pickupInput,
              lat: selectedPickup?.lat,
              lng: selectedPickup?.lng,
            }}
            destination={{
              name: selectedDest ? selectedDest.name : destInput,
              address: selectedDest ? selectedDest.formattedAddress : destInput,
              lat: selectedDest?.lat,
              lng: selectedDest?.lng,
            }}
            stops={stops.filter((s) => (s.name || "").trim() !== "")}
            selectedRouteSummary={selected?.summary}
            billingKm={totalMapKm || selected?.distanceKm || 0}
            outboundMapKm={outboundMapKm}
            returnMapKm={returnMapKm}
            totalMapKm={totalMapKm}
            outboundDurationMinutes={outboundDurationMinutes}
            returnDurationMinutes={returnDurationMinutes}
            tripType={tripType === "round" ? "round_trip" : "single_trip"}
            outboundCoordinates={outboundCoordinates}
            returnCoordinates={returnCoordinates}
            routeCoordinates={routeCoordinates}
            estimatedToll={estimatedToll}
            tollStatus={tollStatus}
            height="520px"
          />

          {/* Quick Route Summary Card */}
          {selected && (
            <div className="bg-gradient-to-r from-amber-950/30 via-card to-card/90 border border-amber-300 dark:border-amber-500/30 p-4 sm:p-5 rounded-2xl flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 shadow-xl">
              <div className="space-y-1">
                <div className="text-[10px] text-amber-700 dark:text-amber-400 font-bold uppercase tracking-wider font-mono">
                  {tripType === "round" ? "ROUND TRIP REAL ROAD ROUTE" : "ONE WAY REAL ROAD ROUTE"}
                </div>
                <h3 className="font-black text-foreground text-sm sm:text-base">
                  {pickupInput.split(",")[0]} {tripType === "round" ? "⇄" : "➔"} {destInput.split(",")[0]} ({totalMapKm || selected.distanceKm} km)
                </h3>
                <p className="text-xs text-muted-foreground">
                  Highway Time: ~{Math.floor((outboundDurationMinutes + returnDurationMinutes || selected.durationMinutes) / 60)}h {(outboundDurationMinutes + returnDurationMinutes || selected.durationMinutes) % 60}m • Toll: <strong className="text-emerald-700 dark:text-emerald-400">{estimatedToll > 0 ? formatINR(estimatedToll) : tollStatus}</strong>
                </p>
              </div>

              {onOpenTripWizardWithRoute && (
                <Button
                  onClick={() => onOpenTripWizardWithRoute(buildRoutePlan())}
                  className="bg-amber-400 hover:bg-amber-300 text-zinc-950 font-black text-xs h-10 px-5 shadow-xl shadow-amber-400/25 flex items-center gap-1.5 cursor-pointer w-full sm:w-auto flex-shrink-0"
                >
                  <Plus className="w-4 h-4" /> Book This Route
                </Button>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

