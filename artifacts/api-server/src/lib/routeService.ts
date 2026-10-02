import type { TripLocation, RouteAlternative } from "@workspace/db/schema";
import { estimateTollForRoute, type TollMatch, type TollRateMode } from "./tollService.js";

export interface PlaceSearchResult {
  placeId: string;
  name: string;
  formattedAddress: string;
  latitude: number;
  longitude: number;
  lat: number;
  lng: number;
  city?: string;
  district?: string;
  state?: string;
  country?: string;
}

export interface DrivingLegResult {
  distanceMeters: number;
  distanceKm: number;
  durationSeconds: number;
  durationMinutes: number;
  encodedPolyline?: string;
  coordinates: [number, number][]; // [latitude, longitude][]
  summary: string;
  estimatedToll: number | null;
  tollAvailable: boolean;
}

export interface ComputedRouteOptions {
  provider: "google_routes" | "geoapify";
  tripType: "single_trip" | "round_trip";
  outbound: DrivingLegResult;
  return?: DrivingLegResult;
  totalRoadDistanceKm: number;
  totalDurationMinutes: number;
  estimatedToll: number | null;
  tollAvailable: boolean;
  tollSource: "google_routes" | "nhai_open_dataset" | null;
  tollPlazas: TollMatch[];
  tollRateMode: TollRateMode | null;
  alternatives: RouteAlternative[];
  resolvedPickup: { name: string; formattedAddress?: string; lat: number; lng: number };
  resolvedDestination: { name: string; formattedAddress?: string; lat: number; lng: number };
}

const GOOGLE_API_KEY = process.env.GOOGLE_MAPS_API_KEY || process.env.GOOGLE_ROUTES_API_KEY || "";
const GEOAPIFY_API_KEY = process.env.GEOAPIFY_API_KEY || "fccc330705934d6abd2be56e77dff380";

// Route Cache to avoid redundant external network roundtrips (TTL 1 hour)
interface CacheEntry<T> {
  data: T;
  expiresAt: number;
}
const routeCache = new Map<string, CacheEntry<DrivingLegResult>>();
const autocompleteCache = new Map<string, CacheEntry<PlaceSearchResult[]>>();
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

/**
 * Standard Polyline Decoding (used for Google Routes API encodedPolyline)
 */
export function decodeGooglePolyline(encoded: string): [number, number][] {
  const points: [number, number][] = [];
  let index = 0;
  const len = encoded.length;
  let lat = 0;
  let lng = 0;

  while (index < len) {
    let b: number;
    let shift = 0;
    let result = 0;
    do {
      b = encoded.charCodeAt(index++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20);
    const dlat = (result & 1) !== 0 ? ~(result >> 1) : result >> 1;
    lat += dlat;

    shift = 0;
    result = 0;
    do {
      b = encoded.charCodeAt(index++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20);
    const dlng = (result & 1) !== 0 ? ~(result >> 1) : result >> 1;
    lng += dlng;

    points.push([Math.round((lat / 1e5) * 1e6) / 1e6, Math.round((lng / 1e5) * 1e6) / 1e6]);
  }
  return points;
}

/**
 * Real Location Search / Autocomplete
 * Uses Google Places API if GOOGLE_API_KEY is configured, else Geoapify Places Autocomplete
 */
export async function searchPlaces(input: string): Promise<PlaceSearchResult[]> {
  const q = input.trim();
  if (!q || q.length < 2) return [];

  const cacheKey = q.toLowerCase();
  const cached = autocompleteCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.data;
  }

  // 1. If Google Maps is configured, use Google Places API
  if (GOOGLE_API_KEY) {
    try {
      const url = `https://maps.googleapis.com/maps/api/place/autocomplete/json?input=${encodeURIComponent(
        q,
      )}&components=country:in&key=${GOOGLE_API_KEY}`;
      const res = await fetch(url);
      if (res.ok) {
        const json = (await res.json()) as any;
        if (json.predictions && json.predictions.length > 0) {
          // Fetch place details for coordinates
          const detailedPromises = json.predictions.slice(0, 7).map(async (pred: any) => {
            const detailUrl = `https://maps.googleapis.com/maps/api/place/details/json?place_id=${pred.place_id}&fields=name,formatted_address,geometry,address_components&key=${GOOGLE_API_KEY}`;
            const detailRes = await fetch(detailUrl);
            if (!detailRes.ok) return null;
            const detailJson = (await detailRes.json()) as any;
            const result = detailJson.result;
            if (!result || !result.geometry) return null;

            let city: string | undefined;
            let district: string | undefined;
            let state: string | undefined;
            let country: string | undefined;

            if (Array.isArray(result.address_components)) {
              for (const comp of result.address_components) {
                if (comp.types.includes("locality")) city = comp.long_name;
                if (comp.types.includes("administrative_area_level_2")) district = comp.long_name;
                if (comp.types.includes("administrative_area_level_1")) state = comp.long_name;
                if (comp.types.includes("country")) country = comp.long_name;
              }
            }

            const latVal = result.geometry.location.lat;
            const lngVal = result.geometry.location.lng;
            return {
              placeId: pred.place_id,
              name: result.name || pred.structured_formatting?.main_text || pred.description,
              formattedAddress: result.formatted_address || pred.description,
              latitude: latVal,
              longitude: lngVal,
              lat: latVal,
              lng: lngVal,
              city: city || district,
              district,
              state,
              country: country || "India",
            } as PlaceSearchResult;
          });

          const results = (await Promise.all(detailedPromises)).filter(
            (p): p is PlaceSearchResult => p !== null,
          );
          if (results.length > 0) {
            autocompleteCache.set(cacheKey, { data: results, expiresAt: Date.now() + CACHE_TTL_MS });
            return results;
          }
        }
      }
    } catch (err) {
      console.error("[routeService] Google Places Autocomplete error:", err);
    }
  }

  // 2. Geoapify Places Autocomplete
  try {
    const url = `https://api.geoapify.com/v1/geocode/autocomplete?text=${encodeURIComponent(
      q,
    )}&apiKey=${GEOAPIFY_API_KEY}&countrycode=in`;
    const res = await fetch(url);
    if (res.ok) {
      const data = (await res.json()) as any;
      if (data.features && Array.isArray(data.features) && data.features.length > 0) {
        const results: PlaceSearchResult[] = data.features.map((f: any) => {
          const props = f.properties || {};
          const coords = f.geometry?.coordinates || [77.5946, 12.9716];
          const latVal = props.lat != null ? Number(props.lat) : coords[1];
          const lonVal = props.lon != null ? Number(props.lon) : coords[0];
          return {
            placeId: props.place_id || `geo_${props.lat}_${props.lon}`,
            name: props.name || props.address_line1 || props.city || q,
            formattedAddress: props.formatted || `${props.name || q}, India`,
            latitude: latVal,
            longitude: lonVal,
            lat: latVal,
            lng: lonVal,
            city: props.city || props.county,
            district: props.state_district || props.county,
            state: props.state,
            country: props.country || "India",
          };
        });

        autocompleteCache.set(cacheKey, { data: results, expiresAt: Date.now() + CACHE_TTL_MS });
        return results;
      }
    }
  } catch (err) {
    console.error("[routeService] Geoapify Autocomplete error:", err);
  }

  return [];
}

/**
 * Reverse geocode a coordinate pair into a human-readable place, so a
 * map-pin or pasted lat/lng doesn't have to be shown to the user as bare
 * numbers. Falls back to a generic "Pinned Location" label if both
 * providers fail — the coordinates themselves are still usable either way.
 */
export async function reverseGeocode(lat: number, lng: number): Promise<PlaceSearchResult | null> {
  if (GOOGLE_API_KEY) {
    try {
      const url = `https://maps.googleapis.com/maps/api/geocode/json?latlng=${lat},${lng}&key=${GOOGLE_API_KEY}`;
      const res = await fetch(url);
      if (res.ok) {
        const json = (await res.json()) as any;
        const result = json.results?.[0];
        if (result) {
          let city: string | undefined, district: string | undefined, state: string | undefined, country: string | undefined;
          for (const comp of result.address_components || []) {
            if (comp.types.includes("locality")) city = comp.long_name;
            if (comp.types.includes("administrative_area_level_2")) district = comp.long_name;
            if (comp.types.includes("administrative_area_level_1")) state = comp.long_name;
            if (comp.types.includes("country")) country = comp.long_name;
          }
          return {
            placeId: result.place_id || `geo_${lat}_${lng}`,
            name: result.formatted_address?.split(",")[0] || "Pinned Location",
            formattedAddress: result.formatted_address || `${lat.toFixed(5)}, ${lng.toFixed(5)}`,
            latitude: lat,
            longitude: lng,
            lat,
            lng,
            city: city || district,
            district,
            state,
            country: country || "India",
          };
        }
      }
    } catch (err) {
      console.error("[routeService] Google reverse geocode error:", err);
    }
  }

  try {
    const url = `https://api.geoapify.com/v1/geocode/reverse?lat=${lat}&lon=${lng}&apiKey=${GEOAPIFY_API_KEY}`;
    const res = await fetch(url);
    if (res.ok) {
      const data = (await res.json()) as any;
      const feat = data.features?.[0];
      if (feat) {
        const props = feat.properties || {};
        return {
          placeId: props.place_id || `geo_${lat}_${lng}`,
          name: props.name || props.address_line1 || props.city || "Pinned Location",
          formattedAddress: props.formatted || `${lat.toFixed(5)}, ${lng.toFixed(5)}`,
          latitude: lat,
          longitude: lng,
          lat,
          lng,
          city: props.city || props.county,
          district: props.state_district || props.county,
          state: props.state,
          country: props.country || "India",
        };
      }
    }
  } catch (err) {
    console.error("[routeService] Geoapify reverse geocode error:", err);
  }

  return null;
}

/**
 * Pull a lat/lng pair out of free text: a plain "lat,lng", or any of the
 * common Google Maps URL shapes (@lat,lng, ?q=lat,lng, ll=lat,lng, or the
 * !3d..!4d.. pattern used on place-detail URLs).
 */
export function extractLatLngFromText(text: string): { lat: number; lng: number } | null {
  const isValid = (lat: number, lng: number) =>
    Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180;

  const plain = text.match(/^\s*(-?\d{1,3}(?:\.\d+)?)\s*,\s*(-?\d{1,3}(?:\.\d+)?)\s*$/);
  if (plain) {
    const lat = parseFloat(plain[1]), lng = parseFloat(plain[2]);
    if (isValid(lat, lng)) return { lat, lng };
  }

  const patterns = [
    /@(-?\d{1,3}(?:\.\d+)?),(-?\d{1,3}(?:\.\d+)?)/,
    /[?&]q=(-?\d{1,3}(?:\.\d+)?),(-?\d{1,3}(?:\.\d+)?)/,
    /[?&]ll=(-?\d{1,3}(?:\.\d+)?),(-?\d{1,3}(?:\.\d+)?)/,
    /!3d(-?\d{1,3}(?:\.\d+)?)!4d(-?\d{1,3}(?:\.\d+)?)/,
  ];
  for (const pattern of patterns) {
    const m = text.match(pattern);
    if (m) {
      const lat = parseFloat(m[1]), lng = parseFloat(m[2]);
      if (isValid(lat, lng)) return { lat, lng };
    }
  }

  return null;
}

/**
 * Resolve a pasted Google Maps link (including shortened goo.gl /
 * maps.app.goo.gl links, which need a server-side redirect follow — the
 * browser can't read the final URL of a cross-origin redirect) or a plain
 * "lat, lng" string into coordinates.
 */
export async function resolveLocationInput(input: string): Promise<{ lat: number; lng: number } | null> {
  const direct = extractLatLngFromText(input);
  if (direct) return direct;

  if (/^https?:\/\//i.test(input)) {
    try {
      const res = await fetch(input, { method: "GET", redirect: "follow" });
      const finalUrl = res.url || input;
      const fromRedirect = extractLatLngFromText(finalUrl);
      if (fromRedirect) return fromRedirect;
      // Some short links only reveal coordinates in the HTML body, not the redirect URL
      const body = await res.text();
      return extractLatLngFromText(body);
    } catch (err) {
      console.error("[routeService] resolveLocationInput URL fetch error:", err);
      return null;
    }
  }

  return null;
}

/**
 * Single Leg Driving Route Calculation
 * Calculates exact road route between origin and destination with optional waypoints
 */
export async function calculateSingleDrivingLeg(
  origin: { lat: number; lng: number; name?: string; placeId?: string },
  destination: { lat: number; lng: number; name?: string; placeId?: string },
  waypoints: Array<{ lat: number; lng: number }> = [],
  options: { avoidTolls?: boolean; avoidHighways?: boolean } = {},
): Promise<DrivingLegResult> {
  const cacheKey = `${origin.lat.toFixed(5)},${origin.lng.toFixed(5)}->${destination.lat.toFixed(
    5,
  )},${destination.lng.toFixed(5)}|wp:${waypoints.map((w) => `${w.lat.toFixed(4)},${w.lng.toFixed(4)}`).join(";")}|tolls:${options.avoidTolls}`;

  const cached = routeCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.data;
  }

  // 1. Google Routes API (Directions API v2)
  if (GOOGLE_API_KEY) {
    try {
      const bodyPayload = {
        origin: origin.placeId
          ? { placeId: origin.placeId }
          : { location: { latLng: { latitude: origin.lat, longitude: origin.lng } } },
        destination: destination.placeId
          ? { placeId: destination.placeId }
          : { location: { latLng: { latitude: destination.lat, longitude: destination.lng } } },
        intermediates: waypoints.map((w) => ({
          location: { latLng: { latitude: w.lat, longitude: w.lng } },
        })),
        travelMode: "DRIVE",
        routingPreference: "TRAFFIC_AWARE",
        routeModifiers: {
          avoidTolls: !!options.avoidTolls,
          avoidHighways: !!options.avoidHighways,
        },
      };

      const res = await fetch("https://routes.googleapis.com/directions/v2:computeRoutes", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Goog-Api-Key": GOOGLE_API_KEY,
          "X-Goog-FieldMask":
            "routes.duration,routes.distanceMeters,routes.polyline.encodedPolyline,routes.description,routes.travelAdvisory.tollInfo",
        },
        body: JSON.stringify(bodyPayload),
      });

      if (res.ok) {
        const json = (await res.json()) as any;
        if (json.routes && json.routes.length > 0) {
          const route = json.routes[0];
          const distanceMeters = Number(route.distanceMeters || 0);
          const durationSeconds = parseInt(String(route.duration || "0").replace("s", ""), 10);
          const distanceKm = Math.round((distanceMeters / 1000) * 10) / 10;
          const durationMinutes = Math.round(durationSeconds / 60);
          const encoded = route.polyline?.encodedPolyline || "";
          const coordinates = encoded ? decodeGooglePolyline(encoded) : [];

          // Real toll extraction if supported
          let estimatedToll: number | null = null;
          let tollAvailable = false;
          if (route.travelAdvisory?.tollInfo?.estimatedPrice) {
            const price = route.travelAdvisory.tollInfo.estimatedPrice[0];
            if (price && price.units) {
              estimatedToll = Number(price.units);
              tollAvailable = true;
            }
          }

          const result: DrivingLegResult = {
            distanceMeters,
            distanceKm,
            durationSeconds,
            durationMinutes,
            encodedPolyline: encoded,
            coordinates,
            summary: route.description || `Fastest Highway Route (${distanceKm} km)`,
            estimatedToll,
            tollAvailable,
          };

          routeCache.set(cacheKey, { data: result, expiresAt: Date.now() + CACHE_TTL_MS });
          return result;
        }
      }
    } catch (err) {
      console.error("[routeService] Google Routes API error:", err);
    }
  }

  // 2. Geoapify Driving Routing
  try {
    const allPoints = [{ lat: origin.lat, lon: origin.lng }, ...waypoints.map((w) => ({ lat: w.lat, lon: w.lng })), { lat: destination.lat, lon: destination.lng }];
    const wpStr = allPoints.map((p) => `${p.lat},${p.lon}`).join("|");
    let url = `https://api.geoapify.com/v1/routing?waypoints=${wpStr}&mode=drive&apiKey=${GEOAPIFY_API_KEY}&details=route_details`;
    if (options.avoidTolls) {
      url += "&avoid=tolls";
    }

    const res = await fetch(url);
    if (res.ok) {
      const json = (await res.json()) as any;
      if (json.features && json.features.length > 0) {
        const feat = json.features[0];
        const props = feat.properties || {};
        const distanceMeters = Number(props.distance || 0);
        const durationSeconds = Number(props.time || 0);
        const distanceKm = Math.round((distanceMeters / 1000) * 10) / 10;
        const durationMinutes = Math.round(durationSeconds / 60);

        // Coordinates from Geoapify are in [lon, lat] format; convert to [lat, lon]
        const rawCoords: [number, number][] = feat.geometry?.coordinates?.[0] || [];
        const coordinates: [number, number][] = rawCoords.map((c: [number, number]) => [c[1], c[0]]);

        const result: DrivingLegResult = {
          distanceMeters,
          distanceKm,
          durationSeconds,
          durationMinutes,
          coordinates,
          summary: `Expressway Driving Route (${distanceKm} km)`,
          estimatedToll: null, // Do not invent fake tolls
          tollAvailable: false,
        };

        routeCache.set(cacheKey, { data: result, expiresAt: Date.now() + CACHE_TTL_MS });
        return result;
      }
    }
  } catch (err) {
    console.error("[routeService] Geoapify Routing API error:", err);
  }

  throw new Error("Unable to calculate driving route between specified locations. Please verify coordinates.");
}

/**
 * Decide which NHAI fare basis applies to a round trip: the discounted
 * same-booth rate only covers a return crossing within 24 hours of the
 * outbound one (National Highways Fee Rules, 2008). Most bookings here are
 * multi-day outstation tours, so without explicit dates we can't assume the
 * discount — but when the caller doesn't supply dates at all (e.g. a
 * same-day-only route-planning tool with no date fields), fall back to the
 * previous same-day assumption rather than changing that caller's numbers.
 */
function resolveTollRateMode(
  isRoundTrip: boolean,
  startDate?: string | null,
  startTime?: string | null,
  returnDate?: string | null,
  returnTime?: string | null,
): TollRateMode {
  if (!isRoundTrip) return "single";
  if (!startDate || !returnDate) return "round_trip_same_day";

  const start = new Date(`${startDate}T${startTime || "00:00"}:00`);
  const ret = new Date(`${returnDate}T${returnTime || "00:00"}:00`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(ret.getTime())) return "round_trip_same_day";

  const hoursGap = (ret.getTime() - start.getTime()) / (1000 * 60 * 60);
  return hoursGap >= 0 && hoursGap <= 24 ? "round_trip_same_day" : "round_trip_multi_day";
}

/**
 * Real Comprehensive Route Engine (One-Way and Round-Trip)
 * For Round-Trip:
 *  - Calculates Outbound leg: Pickup -> Destination
 *  - Calculates Return leg: Destination -> Pickup
 *  - Total distance = Outbound distance + Return distance (never simply * 2)
 */
// Leg results are cached briefly: the Route Planner / trip popup compute a
// route, then saving the trip recomputes the identical route server-side.
// Each leg is an external routing call (several seconds for long routes),
// so reusing them turns the save from ~12s+ into near-instant. Promises are
// cached so concurrent identical requests share one call.
const LEG_CACHE_TTL_MS = 30 * 60 * 1000;
const LEG_CACHE_MAX = 300;
const legCache = new Map<string, { at: number; leg: Promise<DrivingLegResult> }>();

function cachedDrivingLeg(...args: Parameters<typeof calculateSingleDrivingLeg>): Promise<DrivingLegResult> {
  const [from, to, waypoints, options] = args;
  const pt = (p: { lat: number; lng: number }) => `${Number(p.lat).toFixed(5)},${Number(p.lng).toFixed(5)}`;
  const key = [
    pt(from),
    pt(to),
    (waypoints || []).map(pt).join(";"),
    options?.avoidTolls ? "notoll" : "",
    options?.avoidHighways ? "nohwy" : "",
  ].join("|");

  const now = Date.now();
  const hit = legCache.get(key);
  if (hit && now - hit.at < LEG_CACHE_TTL_MS) return hit.leg;

  const leg = calculateSingleDrivingLeg(...args);
  legCache.set(key, { at: now, leg });
  // Never cache a failure — the next request should retry the provider
  leg.catch(() => legCache.delete(key));

  if (legCache.size > LEG_CACHE_MAX) {
    for (const [k, v] of legCache) {
      if (now - v.at >= LEG_CACHE_TTL_MS || legCache.size > LEG_CACHE_MAX) legCache.delete(k);
      if (legCache.size <= LEG_CACHE_MAX) break;
    }
  }
  return leg;
}

export async function calculateRouteJourney(
  pickupOrOptions: TripLocation | {
    pickup: TripLocation;
    destination: TripLocation;
    stops?: TripLocation[];
    tripType?: string;
    options?: { avoidTolls?: boolean; avoidHighways?: boolean };
    startDate?: string | null;
    startTime?: string | null;
    returnDate?: string | null;
    returnTime?: string | null;
  },
  destinationParam?: TripLocation,
  stopsParam: TripLocation[] = [],
  tripTypeParam: string = "single_trip",
  optionsParam: { avoidTolls?: boolean; avoidHighways?: boolean } = {},
): Promise<ComputedRouteOptions> {
  let pickup: TripLocation;
  let destination: TripLocation;
  let stops = stopsParam;
  let tripType = tripTypeParam;
  let options = optionsParam;
  let startDate: string | null | undefined;
  let startTime: string | null | undefined;
  let returnDate: string | null | undefined;
  let returnTime: string | null | undefined;

  if (pickupOrOptions && "pickup" in pickupOrOptions && "destination" in pickupOrOptions) {
    pickup = (pickupOrOptions as any).pickup;
    destination = (pickupOrOptions as any).destination;
    stops = (pickupOrOptions as any).stops || [];
    tripType = (pickupOrOptions as any).tripType || "single_trip";
    options = (pickupOrOptions as any).options || {};
    startDate = (pickupOrOptions as any).startDate;
    startTime = (pickupOrOptions as any).startTime;
    returnDate = (pickupOrOptions as any).returnDate;
    returnTime = (pickupOrOptions as any).returnTime;
  } else {
    pickup = pickupOrOptions as TripLocation;
    destination = destinationParam!;
  }

  let pLat = Number(pickup?.latitude ?? (pickup as any)?.lat);
  let pLng = Number(pickup?.longitude ?? (pickup as any)?.lng);
  let dLat = Number(destination?.latitude ?? (destination as any)?.lat);
  let dLng = Number(destination?.longitude ?? (destination as any)?.lng);

  if ((!pLat || !pLng) && (pickup?.address || pickup?.name)) {
    const found = await searchPlaces(pickup.address || pickup.name);
    if (found.length > 0) {
      pLat = found[0].latitude;
      pLng = found[0].longitude;
      pickup.latitude = pLat;
      pickup.longitude = pLng;
      if (!pickup.placeId) pickup.placeId = found[0].placeId;
    }
  }

  if ((!dLat || !dLng) && (destination?.address || destination?.name)) {
    const found = await searchPlaces(destination.address || destination.name);
    if (found.length > 0) {
      dLat = found[0].latitude;
      dLng = found[0].longitude;
      destination.latitude = dLat;
      destination.longitude = dLng;
      if (!destination.placeId) destination.placeId = found[0].placeId;
    }
  }

  if (!pLat || !pLng || !dLat || !dLng) {
    throw new Error("Invalid pickup or destination coordinates for route calculation.");
  }

  const isRoundTrip = tripType.toLowerCase().includes("round");

  const waypoints = stops
    .filter((s) => s.latitude && s.longitude)
    .map((s) => ({ lat: Number(s.latitude), lng: Number(s.longitude) }));

  // 1. Outbound Leg (Pickup -> Destination) and, for a round trip, the
  // independent Return Leg (Destination -> Pickup) — fetched in parallel.
  const [outbound, returnLegResult] = await Promise.all([
    cachedDrivingLeg(
      { lat: pLat, lng: pLng, name: pickup.name, placeId: pickup.placeId || undefined },
      { lat: dLat, lng: dLng, name: destination.name, placeId: destination.placeId || undefined },
      waypoints,
      options,
    ),
    isRoundTrip
      ? cachedDrivingLeg(
          { lat: dLat, lng: dLng, name: destination.name, placeId: destination.placeId || undefined },
          { lat: pLat, lng: pLng, name: pickup.name, placeId: pickup.placeId || undefined },
          [...waypoints].reverse(),
          options,
        )
      : Promise.resolve(undefined),
  ]);

  let returnLeg: DrivingLegResult | undefined = returnLegResult;
  let totalRoadDistanceKm = outbound.distanceKm;
  let totalDurationMinutes = outbound.durationMinutes;
  let estimatedToll = outbound.estimatedToll;
  let tollAvailable = outbound.tollAvailable;

  // 2. For Round-Trip: combine with the Return Leg
  if (isRoundTrip && returnLeg) {

    // Sum of actual Outbound + actual Return
    totalRoadDistanceKm = Math.round((outbound.distanceKm + returnLeg.distanceKm) * 10) / 10;
    totalDurationMinutes = outbound.durationMinutes + returnLeg.durationMinutes;

    if (outbound.tollAvailable && returnLeg.tollAvailable) {
      estimatedToll = (outbound.estimatedToll || 0) + (returnLeg.estimatedToll || 0);
      tollAvailable = true;
    } else {
      estimatedToll = null;
      tollAvailable = false;
    }
  }

  // Neither Google Routes (not configured here) nor Geoapify provide toll
  // pricing — fall back to matching NHAI toll plazas (open dataset) against
  // the outbound road path. Outbound and return normally retrace the same
  // highway, so this is priced once for the whole journey, at whichever
  // NHAI fare basis the actual outbound/return gap earns (same-day
  // discounted rate, or the full rate for both crossings beyond 24 hours).
  let tollSource: ComputedRouteOptions["tollSource"] = tollAvailable ? "google_routes" : null;
  let tollPlazas: TollMatch[] = [];
  let tollRateMode: TollRateMode | null = null;
  if (!tollAvailable) {
    tollRateMode = resolveTollRateMode(isRoundTrip, startDate, startTime, returnDate, returnTime);
    const tollEstimate = estimateTollForRoute(outbound.coordinates, tollRateMode);
    estimatedToll = tollEstimate.totalToll;
    tollPlazas = tollEstimate.plazas;
    tollAvailable = true;
    tollSource = "nhai_open_dataset";
  }

  // 3. Alternatives for UI route selection: the primary (fastest) route, plus
  // a toll-avoiding route when the primary actually carries a toll — computed
  // as a genuinely separate routing request (not a price toggle on the same
  // path), so distance/duration reflect the real toll-free road.
  let tollFreeAlt: RouteAlternative | null = null;
  if (!options.avoidTolls && (estimatedToll || 0) > 0) {
    try {
      const [outboundNoToll, returnNoToll] = await Promise.all([
        cachedDrivingLeg(
          { lat: pLat, lng: pLng, name: pickup.name, placeId: pickup.placeId || undefined },
          { lat: dLat, lng: dLng, name: destination.name, placeId: destination.placeId || undefined },
          waypoints,
          { ...options, avoidTolls: true },
        ),
        isRoundTrip
          ? cachedDrivingLeg(
              { lat: dLat, lng: dLng, name: destination.name, placeId: destination.placeId || undefined },
              { lat: pLat, lng: pLng, name: pickup.name, placeId: pickup.placeId || undefined },
              [...waypoints].reverse(),
              { ...options, avoidTolls: true },
            )
          : Promise.resolve(undefined),
      ]);

      let noTollTotalKm = outboundNoToll.distanceKm;
      let noTollDurationMinutes = outboundNoToll.durationMinutes;
      if (isRoundTrip && returnNoToll) {
        noTollTotalKm = Math.round((outboundNoToll.distanceKm + returnNoToll.distanceKm) * 10) / 10;
        noTollDurationMinutes = outboundNoToll.durationMinutes + returnNoToll.durationMinutes;
      }

      // Indian toll roads are often untagged in the underlying map data, so
      // "avoid tolls" frequently comes back as either the identical road or
      // a trivial few-hundred-metre nudge — not a real alternative. Only
      // surface it once the detour is big enough to actually be a distinct
      // choice (a real bypass), not noise that looks unchanged on the map.
      const extraKm = Math.round((noTollTotalKm - totalRoadDistanceKm) * 10) / 10;
      const MIN_MEANINGFUL_DETOUR_KM = 3;
      if (extraKm > MIN_MEANINGFUL_DETOUR_KM) {
        tollFreeAlt = {
          routeIndex: 1,
          summary: `Toll-Free Route (+${extraKm} km detour, ${Math.floor(noTollDurationMinutes / 60)}h ${noTollDurationMinutes % 60}m)`,
          distanceKm: noTollTotalKm,
          durationMinutes: noTollDurationMinutes,
          estimatedToll: 0,
          via: isRoundTrip ? "Outbound & Return avoiding toll roads" : "Avoids toll roads",
          polylineCoordinates: outboundNoToll.coordinates,
          extraKm,
        };
      }
    } catch (err) {
      console.warn("[routeService] Toll-free alternative computation failed:", err);
    }
  }

  const alternatives: RouteAlternative[] = [
    {
      routeIndex: 0,
      summary: `Primary Expressway (${totalRoadDistanceKm} km, ${Math.floor(totalDurationMinutes / 60)}h ${totalDurationMinutes % 60}m)`,
      distanceKm: totalRoadDistanceKm,
      durationMinutes: totalDurationMinutes,
      estimatedToll: estimatedToll || 0,
      via: tollFreeAlt
        ? (isRoundTrip ? "Outbound & Return via toll roads (fastest)" : "Fastest route via toll roads")
        : (isRoundTrip ? "Outbound & Return via National Highway" : "Fastest National Highway"),
      polylineCoordinates: outbound.coordinates,
    },
    ...(tollFreeAlt ? [tollFreeAlt] : []),
  ];

  return {
    provider: GOOGLE_API_KEY ? "google_routes" : "geoapify",
    tripType: isRoundTrip ? "round_trip" : "single_trip",
    outbound,
    return: returnLeg,
    totalRoadDistanceKm,
    totalDurationMinutes,
    estimatedToll,
    tollAvailable,
    tollSource,
    tollPlazas,
    tollRateMode,
    alternatives,
    resolvedPickup: { name: pickup.name, formattedAddress: pickup.address, lat: pLat, lng: pLng },
    resolvedDestination: { name: destination.name, formattedAddress: destination.address, lat: dLat, lng: dLng },
  };
}
