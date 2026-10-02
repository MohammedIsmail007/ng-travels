import { apiFetch } from "@/lib/apiFetch";
import React, { useEffect, useRef, useState } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { Browser } from "@capacitor/browser";
import {
  Navigation, MapPin, Gauge, Clock, ShieldCheck, Car, Radio,
  Compass, ExternalLink, RefreshCw, Layers, Plus, Minus, LocateFixed,
  CircleDollarSign, Sparkles
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatINR } from "@/lib/fareEngine";

export interface WaypointLocation {
  name: string;
  lat?: number;
  lng?: number;
  latitude?: number;
  longitude?: number;
  address?: string;
}

export interface TollPlazaMarker {
  id?: number;
  name: string;
  lat: number;
  lon: number;
  rate: number;
  distanceAlongRouteKm?: number;
}

export interface RealtimeFleetMapProps {
  pickup: WaypointLocation;
  destination: WaypointLocation;
  stops?: WaypointLocation[];
  activeTrip?: any;
  height?: string | number;
  interactive?: boolean;
  showLiveTelemetry?: boolean;
  showRoutePolyline?: boolean;
  selectedRouteSummary?: string;
  estimatedToll?: number;
  billingKm?: number;
  className?: string;
  routeCoordinates?: [number, number][];
  outboundCoordinates?: [number, number][];
  returnCoordinates?: [number, number][];
  tripType?: string;
  outboundDistanceKm?: number;
  returnDistanceKm?: number;
  outboundMapKm?: number;
  returnMapKm?: number;
  totalMapKm?: number;
  outboundDurationMinutes?: number;
  returnDurationMinutes?: number;
  tollPlazas?: TollPlazaMarker[];
}

export const GEOAPIFY_API_KEY = "fccc330705934d6abd2be56e77dff380";

const GPS_TRACKED_STATUSES = new Set(["started", "reached_pickup", "customer_picked_up", "in_progress"]);

// Fallback coordinate dictionary for common cities/landmarks across India
const CITY_COORDS: Record<string, [number, number]> = {
  erode: [11.341, 77.7172],
  coimbatore: [11.0168, 76.9558],
  bengaluru: [12.9716, 77.5946],
  bangalore: [12.9716, 77.5946],
  mysuru: [12.2958, 76.6394],
  mysore: [12.2958, 76.6394],
  chennai: [13.0827, 80.2707],
  salem: [11.6643, 78.146],
  tirupur: [11.1085, 77.3411],
  trichy: [10.7905, 78.7047],
  madurai: [9.9252, 78.1198],
  ooty: [11.4102, 76.695],
  kochi: [9.9312, 76.2673],
  hyderabad: [17.385, 78.4867],
  mumbai: [19.076, 72.8777],
  delhi: [28.6139, 77.209],
  indiranagar: [12.9784, 77.6408],
  whitefield: [12.9698, 77.7499],
  kempegowda: [13.1986, 77.7066],
  airport: [13.1986, 77.7066],
};

function getCoordsForPlace(placeName: string, customLat?: number, customLng?: number): [number, number] {
  if (customLat && customLng && customLat > 0) return [customLat, customLng];
  const p = (placeName || "").toLowerCase();
  for (const [key, coords] of Object.entries(CITY_COORDS)) {
    if (p.includes(key)) return coords;
  }
  return [11.341, 77.7172];
}

export const RealtimeFleetMap: React.FC<RealtimeFleetMapProps> = ({
  pickup,
  destination,
  stops = [],
  activeTrip,
  height = "440px",
  interactive = true,
  showLiveTelemetry = true,
  showRoutePolyline = true,
  selectedRouteSummary,
  estimatedToll = 0,
  billingKm = 0,
  className = "",
  routeCoordinates = [],
  outboundCoordinates = [],
  returnCoordinates = [],
  tripType = "single_trip",
  outboundDistanceKm = 0,
  returnDistanceKm = 0,
  outboundMapKm,
  returnMapKm,
  totalMapKm,
  outboundDurationMinutes = 0,
  returnDurationMinutes = 0,
  tollPlazas = [],
}) => {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<L.Map | null>(null);
  const tileLayerRef = useRef<L.TileLayer | null>(null);
  const vehicleMarkerRef = useRef<L.Marker | null>(null);
  const polylineRef = useRef<L.Polyline | null>(null);

  // Default to Google Maps Style (Bright & High Contrast)
  const [mapStyle, setMapStyle] = useState<"street" | "satellite" | "dark">("street");
  const [telemetry, setTelemetry] = useState({
    speed: 64,
    progress: 48,
    etaMinutes: 32,
    lat: 11.18,
    lng: 77.35,
    gpsSignal: "GPS Synced",
    heading: 260,
  });

  const pLat = pickup?.lat || pickup?.latitude;
  const pLng = pickup?.lng || pickup?.longitude;
  const dLat = destination?.lat || destination?.latitude;
  const dLng = destination?.lng || destination?.longitude;

  const pickupCoords = getCoordsForPlace(pickup?.name || "", pLat, pLng);
  const destCoords = getCoordsForPlace(destination?.name || "", dLat, dLng);

  // Only poll for GPS telemetry once the trip is actually in a stage that
  // pushes location (mirrors the driver app's own tracking gate) — polling
  // for e.g. an "upcoming"/"assigned" trip just spams 404s since no
  // driverLocations row exists for it yet.
  const isLiveTrip = Boolean(activeTrip?.id) && GPS_TRACKED_STATUSES.has(activeTrip?.status);

  // Real route stats derived from the actual calculated route, not a random simulation.
  const totalDistanceKm = totalMapKm || billingKm || outboundDistanceKm + returnDistanceKm || 0;
  const totalDurationMinutes = (outboundDurationMinutes || 0) + (returnDurationMinutes || 0);
  const previewEtaMinutes = totalDurationMinutes > 0
    ? totalDurationMinutes
    : totalDistanceKm > 0
    ? Math.round((totalDistanceKm / 55) * 60)
    : 0;
  const previewSpeedKmh = totalDurationMinutes > 0 && totalDistanceKm > 0
    ? Math.round(totalDistanceKm / (totalDurationMinutes / 60))
    : 55;

  const formatDuration = (mins: number) => {
    if (mins <= 0) return "0m";
    const h = Math.floor(mins / 60);
    const m = Math.round(mins % 60);
    return h > 0 ? `${h}h ${m}m` : `${m}m`;
  };

  // Initialize Map
  useEffect(() => {
    if (!mapContainerRef.current) return;

    const getTileUrl = (style: string) => {
      if (style === "satellite") {
        return "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{x}/{y}";
      } else if (style === "dark") {
        return `https://maps.geoapify.com/v1/tile/dark-matter-purple-roads/{z}/{x}/{y}.png?apiKey=${GEOAPIFY_API_KEY}`;
      } else {
        // Clean modern street style (Klokantech Basic) — closer to current
        // map UI conventions than the older OSM Bright style.
        return `https://maps.geoapify.com/v1/tile/klokantech-basic/{z}/{x}/{y}.png?apiKey=${GEOAPIFY_API_KEY}`;
      }
    };

    if (!mapInstanceRef.current) {
      const map = L.map(mapContainerRef.current, {
        zoomControl: false,
        attributionControl: false,
      }).setView(pickupCoords, 11);

      const tileLayer = L.tileLayer(getTileUrl(mapStyle), { maxZoom: 20 }).addTo(map);
      tileLayerRef.current = tileLayer;
      mapInstanceRef.current = map;
    } else if (tileLayerRef.current) {
      tileLayerRef.current.setUrl(getTileUrl(mapStyle));
    }

    const map = mapInstanceRef.current;
    if (!map) return;

    // Remove existing markers & polylines
    map.eachLayer((layer) => {
      if (layer instanceof L.Marker || layer instanceof L.Polyline) {
        map.removeLayer(layer);
      }
    });

    // 1. Google Green Origin Pin
    const originIcon = L.divIcon({
      className: "google-origin-pin",
      html: `
        <div style="
          position: relative;
          display: flex;
          align-items: center;
          justify-content: center;
          width: 28px;
          height: 28px;
          background: #0F9D58;
          border-radius: 50%;
          border: 3px solid #ffffff;
          box-shadow: 0 3px 10px rgba(0,0,0,0.5);
          transform: translate(-50%, -50%);
        ">
          <div style="width: 8px; height: 8px; background: #ffffff; border-radius: 50%;"></div>
        </div>
      `,
      iconSize: [28, 28],
      iconAnchor: [14, 14],
    });

    const pickupMarker = L.marker(pickupCoords, { icon: originIcon }).addTo(map);
    pickupMarker.bindPopup(`<b>Pickup:</b> ${pickup?.name || "Origin"}`);

    // 2. Google Red Teardrop Destination Marker
    const destIcon = L.divIcon({
      className: "google-dest-pin",
      html: `
        <div style="
          position: relative;
          display: flex;
          align-items: center;
          justify-content: center;
          width: 32px;
          height: 32px;
          background: #EA4335;
          border-radius: 50% 50% 50% 0;
          transform: rotate(-45deg) translate(-10px, -10px);
          border: 2px solid #ffffff;
          box-shadow: 0 4px 12px rgba(0,0,0,0.6);
        ">
          <div style="width: 10px; height: 10px; background: #ffffff; border-radius: 50%; transform: rotate(45deg);"></div>
        </div>
      `,
      iconSize: [32, 32],
      iconAnchor: [16, 32],
    });

    const destMarker = L.marker(destCoords, { icon: destIcon }).addTo(map);
    destMarker.bindPopup(`<b>Destination:</b> ${destination?.name || "Destination"}`);

    // 3. Intermediate Stops (Purple / Amber Waypoint Pins)
    const routePoints: [number, number][] = [pickupCoords];
    stops.forEach((stop, idx) => {
      const stopCoord = getCoordsForPlace(stop?.name || "", stop?.lat || stop?.latitude, stop?.lng || stop?.longitude);
      routePoints.push(stopCoord);

      const stopIcon = L.divIcon({
        className: "google-stop-pin",
        html: `
          <div style="
            display: flex;
            align-items: center;
            justify-content: center;
            width: 24px;
            height: 24px;
            background: #FBBC04;
            color: #000;
            font-weight: 900;
            font-size: 11px;
            border-radius: 50%;
            border: 2px solid #ffffff;
            box-shadow: 0 2px 8px rgba(0,0,0,0.4);
            transform: translate(-50%, -50%);
          ">
            ${idx + 1}
          </div>
        `,
        iconSize: [24, 24],
        iconAnchor: [12, 12],
      });

      L.marker(stopCoord, { icon: stopIcon }).addTo(map).bindPopup(`<b>Stop ${idx + 1}:</b> ${stop?.name}`);
    });
    routePoints.push(destCoords);

    // 3b. NHAI Toll Plaza Pins — real coordinates + fare, in the order the
    // vehicle actually reaches them along the route (matches the FASTag-style
    // toll calculator: a marker per plaza with its exact rate on the map).
    tollPlazas.forEach((plaza) => {
      if (!plaza?.lat || !plaza?.lon) return;
      const tollIcon = L.divIcon({
        className: "google-toll-pin",
        html: `
          <div style="
            display: flex;
            align-items: center;
            justify-content: center;
            width: 22px;
            height: 22px;
            background: #1f2937;
            color: #FBBC04;
            font-weight: 900;
            font-size: 12px;
            border-radius: 6px;
            border: 2px solid #ffffff;
            box-shadow: 0 2px 8px rgba(0,0,0,0.5);
            transform: translate(-50%, -50%);
          ">
            ₹
          </div>
        `,
        iconSize: [22, 22],
        iconAnchor: [11, 11],
      });

      L.marker([plaza.lat, plaza.lon], { icon: tollIcon })
        .addTo(map)
        .bindPopup(`
          <div style="font-size: 12px; color: #1f2937; font-family: sans-serif;">
            <b>${plaza.name}</b><br/>
            ${plaza.distanceAlongRouteKm != null ? `${plaza.distanceAlongRouteKm} km into route<br/>` : ""}
            Toll: <strong>${formatINR(plaza.rate)}</strong>
          </div>
        `);
    });

    // 4. Authentic Real Driving Road Polylines (Phase 52)
    if (showRoutePolyline) {
      const isRound = tripType.toLowerCase().includes("round");
      const outboundPts: [number, number][] =
        outboundCoordinates.length > 1
          ? outboundCoordinates
          : routeCoordinates.length > 1
          ? routeCoordinates
          : [];
      const returnPts: [number, number][] = returnCoordinates.length > 1 ? returnCoordinates : [];

      // Render Outbound Driving Route (Google Blue #4285F4)
      if (outboundPts.length > 1) {
        L.polyline(outboundPts, {
          color: "#1a73e8",
          weight: 7,
          opacity: 0.9,
          lineCap: "round",
          lineJoin: "round",
        }).addTo(map);

        const mainPolyline = L.polyline(outboundPts, {
          color: "#4285F4",
          weight: 4.5,
          opacity: 1,
          lineCap: "round",
          lineJoin: "round",
        }).addTo(map);
        polylineRef.current = mainPolyline;
      }

      // Render Return Driving Route (Violet / Purple #8B5CF6)
      if (isRound && returnPts.length > 1) {
        L.polyline(returnPts, {
          color: "#6d28d9",
          weight: 7,
          opacity: 0.85,
          lineCap: "round",
          lineJoin: "round",
        }).addTo(map);

        L.polyline(returnPts, {
          color: "#a855f7",
          weight: 4,
          opacity: 1,
          dashArray: "6, 8",
          lineCap: "round",
          lineJoin: "round",
        }).addTo(map);
      }

      // Auto-fit bounds to the actual driving road coordinates
      const allPoints = [...outboundPts, ...returnPts];
      if (allPoints.length > 1) {
        map.fitBounds(L.latLngBounds(allPoints), { padding: [40, 40] });
      } else if (pickupCoords && destCoords) {
        map.fitBounds(L.latLngBounds([pickupCoords, destCoords]), { padding: [40, 40] });
      }
    }

    // 5. Google Maps Blue Live Vehicle Navigation Arrow with Direction Cone
    const initLat = telemetry.lat || (pickupCoords[0] + destCoords[0]) / 2;
    const initLng = telemetry.lng || (pickupCoords[1] + destCoords[1]) / 2;

    const googleVehicleIcon = L.divIcon({
      className: "google-vehicle-live-marker",
      html: `
        <div style="
          position: relative;
          display: flex;
          align-items: center;
          justify-content: center;
          width: 38px;
          height: 38px;
          border-radius: 50%;
          background: #1a73e8;
          border: 3px solid #ffffff;
          box-shadow: 0 0 18px rgba(26, 115, 232, 0.9), 0 4px 12px rgba(0,0,0,0.6);
          transform: translate(-50%, -50%);
          transition: transform 0.8s ease-in-out;
        ">
          <div style="
            width: 0;
            height: 0;
            border-left: 6px solid transparent;
            border-right: 6px solid transparent;
            border-bottom: 12px solid #ffffff;
            transform: rotate(${telemetry.heading}deg);
            transition: transform 0.5s ease;
          "></div>
        </div>
      `,
      iconSize: [38, 38],
      iconAnchor: [19, 19],
    });

    const vehicleMarker = L.marker([initLat, initLng], { icon: googleVehicleIcon }).addTo(map);
    vehicleMarker.bindPopup(`
      <div style="font-size: 12px; color: #1f2937; font-family: sans-serif;">
        <b style="color: #1a73e8;">NG Travels Live GPS Fleet</b><br/>
        Driver: <strong>${activeTrip?.driverName || "Suresh K"}</strong><br/>
        Speed: <strong>${telemetry.speed} km/h</strong> • Live Synced
      </div>
    `);
    vehicleMarkerRef.current = vehicleMarker;

    // Fit Bounds smoothly
    const bounds = L.latLngBounds(routePoints);
    map.fitBounds(bounds, { padding: [40, 40] });
  }, [pickup?.name, destination?.name, stops, mapStyle, showRoutePolyline, tollPlazas, outboundCoordinates, returnCoordinates, routeCoordinates]);

  // Live GPS Telemetry Polling from Server (only for an actual dispatched trip)
  useEffect(() => {
    if (!isLiveTrip) return;
    let timer: NodeJS.Timeout | null = null;

    const pollLiveGps = async () => {
      try {
        const res = await apiFetch(`/api/trips/${activeTrip.id}/live-location`);
        if (res.ok) {
          const data = await res.json();
          setTelemetry({
            speed: Number(data.speed || 62),
            progress: 50,
            etaMinutes: Number(data.etaMinutes || previewEtaMinutes || 30),
            lat: Number(data.latitude || pickupCoords[0]),
            lng: Number(data.longitude || pickupCoords[1]),
            gpsSignal: "GPS Synced",
            heading: Number(data.heading || 260),
          });

          // Update Leaflet marker position smoothly
          if (vehicleMarkerRef.current && data.latitude && data.longitude) {
            vehicleMarkerRef.current.setLatLng([data.latitude, data.longitude]);
          }
        }
      } catch {
        // Ignore transient polling errors — keep the last known telemetry
      }
    };

    pollLiveGps();
    // Matches the driver app's 15s upload cadence — polling faster just
    // re-reads the same position. Paused while the tab is hidden.
    timer = setInterval(() => {
      if (document.visibilityState === "visible") pollLiveGps();
    }, 15000);
    return () => {
      if (timer) clearInterval(timer);
    };
  }, [isLiveTrip, activeTrip?.id, pickupCoords[0], pickupCoords[1], destCoords[0], destCoords[1]]);

  // Route Preview Mode (no dispatched trip yet): reflect the actual calculated
  // route distance/duration instead of a fake moving vehicle simulation.
  useEffect(() => {
    if (isLiveTrip) return;
    const midLat = (pickupCoords[0] + destCoords[0]) / 2;
    const midLng = (pickupCoords[1] + destCoords[1]) / 2;

    setTelemetry({
      speed: previewSpeedKmh,
      progress: 50,
      etaMinutes: previewEtaMinutes,
      lat: midLat,
      lng: midLng,
      gpsSignal: "Route Preview",
      heading: 260,
    });

    if (vehicleMarkerRef.current) {
      vehicleMarkerRef.current.setLatLng([midLat, midLng]);
    }
  }, [isLiveTrip, previewSpeedKmh, previewEtaMinutes, pickupCoords[0], pickupCoords[1], destCoords[0], destCoords[1]]);

  const openGoogleMapsDirections = () => {
    // Prefer exact resolved coordinates over the typed name — Google Maps
    // would otherwise re-geocode a plain name itself, which can land on a
    // different same-named place than the one the app actually routed.
    const origin = pLat && pLng ? `${pLat},${pLng}` : encodeURIComponent(pickup?.name || "Erode");
    const dest = dLat && dLng ? `${dLat},${dLng}` : encodeURIComponent(destination?.name || "Coimbatore");
    const waypointsParam = stops.length > 0 ? `&waypoints=${encodeURIComponent(stops.map((s) => s.name).join("|"))}` : "";
    const url = `https://www.google.com/maps/dir/?api=1&origin=${origin}&destination=${dest}${waypointsParam}`;

    // In the Android app, Browser.open() shows the page in an in-app Custom
    // Tabs sheet that slides over the app (no separate browser switch, no
    // Google API key needed). In a plain web browser it falls back to a
    // normal new tab, same as before.
    Browser.open({ url });
  };

  const handleZoomIn = () => mapInstanceRef.current?.zoomIn();
  const handleZoomOut = () => mapInstanceRef.current?.zoomOut();
  const handleRecenter = () => {
    if (mapInstanceRef.current) {
      const bounds = L.latLngBounds([pickupCoords, destCoords]);
      mapInstanceRef.current.fitBounds(bounds, { padding: [30, 30] });
    }
  };

  return (
    <div className={`relative isolate z-0 rounded-2xl overflow-hidden border border-border bg-background shadow-2xl ${className}`}>
      {/* Realtime Map Canvas */}
      <div ref={mapContainerRef} style={{ height, width: "100%" }} className="z-10" />

      {/* Top Header Floating Banner (Google Maps Card Style) */}
      <div className="absolute top-2.5 left-2.5 right-2.5 z-20 flex items-center justify-between gap-2 pointer-events-none">
        {/* Route Summary Pill */}
        <div className="bg-background/95 backdrop-blur border border-border px-3 py-1.5 rounded-xl shadow-xl flex items-center gap-2 pointer-events-auto max-w-[75%]">
          <div className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-ping flex-shrink-0" />
          <div className="text-xs font-bold text-foreground truncate">
            {pickup?.name || "Origin"} ➔ {destination?.name || "Destination"}
          </div>
          {tripType.toLowerCase().includes("round") ? (
            <div className="flex items-center gap-1 flex-shrink-0">
              {outboundDistanceKm > 0 && (
                <span className="text-[10px] bg-blue-100 dark:bg-blue-500/20 text-blue-700 dark:text-blue-400 border border-blue-300 dark:border-blue-500/30 px-1.5 py-0.5 rounded font-mono font-bold">
                  Go: {outboundDistanceKm} km
                </span>
              )}
              {returnDistanceKm > 0 && (
                <span className="text-[10px] bg-purple-100 dark:bg-purple-500/20 text-purple-700 dark:text-purple-400 border border-purple-300 dark:border-purple-500/30 px-1.5 py-0.5 rounded font-mono font-bold">
                  Ret: {returnDistanceKm} km
                </span>
              )}
              {(outboundDistanceKm > 0 || billingKm > 0) && (
                <span className="text-[10px] bg-amber-400 text-zinc-950 px-1.5 py-0.5 rounded font-mono font-black">
                  Total: {Math.round(((outboundDistanceKm || 0) + (returnDistanceKm || 0) || billingKm) * 10) / 10} KM
                </span>
              )}
            </div>
          ) : (
            billingKm > 0 && (
              <span className="text-[10px] bg-amber-400 text-zinc-950 px-1.5 py-0.5 rounded font-mono font-black flex-shrink-0">
                {billingKm} KM
              </span>
            )
          )}
        </div>

        {/* Map Layers & Google Maps Direct Link */}
        <div className="flex items-center gap-1.5 pointer-events-auto flex-shrink-0">
          <Button
            size="sm"
            variant="outline"
            onClick={() => setMapStyle(mapStyle === "street" ? "satellite" : mapStyle === "satellite" ? "dark" : "street")}
            className="bg-background/95 border-border text-foreground hover:text-white text-xs h-7 sm:h-8 px-2.5 shadow-lg"
          >
            <Layers className="w-3.5 h-3.5 mr-1" />
            <span className="capitalize text-[10px] hidden xs:inline">{mapStyle === "street" ? "Street" : mapStyle}</span>
          </Button>

          <Button
            size="sm"
            onClick={openGoogleMapsDirections}
            className="bg-amber-400 hover:bg-amber-300 text-zinc-950 font-black text-xs h-7 sm:h-8 px-2.5 shadow-lg shadow-amber-400/20 flex items-center gap-1 cursor-pointer"
          >
            <ExternalLink className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Open in Google Maps</span>
          </Button>
        </div>
      </div>

      {/* Right Side Zoom & Recenter Controls (Google Maps Style) */}
      <div className="absolute right-2.5 bottom-12 z-20 flex flex-col gap-1 pointer-events-auto">
        <button
          onClick={handleRecenter}
          className="w-8 h-8 rounded-lg bg-background/95 hover:bg-card border border-border text-foreground flex items-center justify-center shadow-lg transition-colors cursor-pointer"
          title="Recenter Route"
        >
          <LocateFixed className="w-4 h-4 text-amber-700 dark:text-amber-400" />
        </button>
        <button
          onClick={handleZoomIn}
          className="w-8 h-8 rounded-lg bg-background/95 hover:bg-card border border-border text-foreground flex items-center justify-center shadow-lg transition-colors cursor-pointer"
          title="Zoom In"
        >
          <Plus className="w-4 h-4" />
        </button>
        <button
          onClick={handleZoomOut}
          className="w-8 h-8 rounded-lg bg-background/95 hover:bg-card border border-border text-foreground flex items-center justify-center shadow-lg transition-colors cursor-pointer"
          title="Zoom Out"
        >
          <Minus className="w-4 h-4" />
        </button>
      </div>

      {/* Compact Bottom Live Telemetry HUD Bar (Unobtrusive) */}
      {showLiveTelemetry && (
        <div className="absolute bottom-2 left-2 right-12 z-20 pointer-events-none">
          <div className="bg-background/95 backdrop-blur border border-border rounded-xl px-3 py-1.5 shadow-2xl pointer-events-auto flex items-center justify-between gap-3 text-xs">
            {/* Speed */}
            <div className="flex items-center gap-1.5">
              <Gauge className="w-3.5 h-3.5 text-amber-700 dark:text-amber-400 flex-shrink-0" />
              <span className="font-mono font-bold text-foreground text-xs">{telemetry.speed} km/h</span>
            </div>

            {/* ETA / Duration */}
            <div className="flex items-center gap-1.5">
              <Clock className="w-3.5 h-3.5 text-sky-700 dark:text-sky-400 flex-shrink-0" />
              <span className="font-mono font-bold text-sky-700 dark:text-sky-300 text-xs">
                {isLiveTrip ? `~${telemetry.etaMinutes} mins` : `Est. ${formatDuration(telemetry.etaMinutes)}`}
              </span>
            </div>

            {/* Toll */}
            <div className="flex items-center gap-1.5">
              <CircleDollarSign className="w-3.5 h-3.5 text-emerald-700 dark:text-emerald-400 flex-shrink-0" />
              <span className="font-mono font-bold text-emerald-700 dark:text-emerald-400 text-xs">
                {estimatedToll > 0 ? formatINR(estimatedToll) : "Toll Free"}
              </span>
            </div>

            {/* GPS Signal */}
            <div className="hidden xs:flex items-center gap-1 text-[10px] text-muted-foreground font-mono">
              <span className={`w-1.5 h-1.5 rounded-full ${isLiveTrip ? "bg-emerald-400 animate-ping" : "bg-muted-foreground"}`} />
              {isLiveTrip ? "Live Sync" : "Route Preview"}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
