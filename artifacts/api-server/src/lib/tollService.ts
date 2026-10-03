import tollPlazasRaw from "../data/toll-plazas-india.json";

/**
 * NHAI toll-plaza rates + coordinates, community-maintained from NHAI's own
 * RajMargyatra portal (https://github.com/ForceGT/india-toll-plazas,
 * "Government Open Data"-style reuse — no formal OSS license, confirm terms
 * with counsel if this needs to be airtight for billing). Re-vendor
 * periodically; rates revise roughly annually.
 */
interface TollPlaza {
  id: number;
  name: string;
  state: string | null;
  nh: string | null;
  lat: number;
  lon: number;
  carSingle: number;
  carReturn: number;
}

const tollPlazas = tollPlazasRaw as TollPlaza[];

export interface TollMatch {
  id: number;
  name: string;
  state: string | null;
  rate: number;
  distanceMeters: number;
  lat: number;
  lon: number;
  distanceAlongRouteKm: number;
}

export interface TollEstimateResult {
  totalToll: number;
  plazas: TollMatch[];
}

const EARTH_RADIUS_M = 6371000;
const MAX_MATCH_DISTANCE_M = 750;

function toRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

function haversineMeters(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(a));
}

/**
 * Approximate min distance from a point to a polyline segment, in meters.
 * Treats short segments as locally flat (fine at highway-segment scale).
 */
function distanceToSegmentMeters(
  pLat: number,
  pLon: number,
  aLat: number,
  aLon: number,
  bLat: number,
  bLon: number,
): { distanceMeters: number; t: number } {
  const latScale = 110574; // meters per degree latitude (roughly constant)
  const lonScale = 111320 * Math.cos(toRad(pLat)); // meters per degree longitude at this latitude

  const ax = (aLon - pLon) * lonScale;
  const ay = (aLat - pLat) * latScale;
  const bx = (bLon - pLon) * lonScale;
  const by = (bLat - pLat) * latScale;

  const abx = bx - ax;
  const aby = by - ay;
  const lenSq = abx * abx + aby * aby;

  let t = lenSq > 0 ? -(ax * abx + ay * aby) / lenSq : 0;
  t = Math.max(0, Math.min(1, t));

  const cx = ax + t * abx;
  const cy = ay + t * aby;
  return { distanceMeters: Math.sqrt(cx * cx + cy * cy), t };
}

interface RouteMatch {
  distanceMeters: number;
  distanceAlongRouteMeters: number;
}

/**
 * Perpendicular distance from a point to the nearest route segment, plus
 * how far along the route (from the origin) that nearest point sits — the
 * latter lets the UI show each toll plaza's position along the trip, the
 * way a highway toll calculator marks plazas on the route line.
 */
function matchToRoute(
  plazaLat: number,
  plazaLon: number,
  coordinates: [number, number][],
  cumulativeMeters: number[],
): RouteMatch {
  if (coordinates.length === 0) return { distanceMeters: Infinity, distanceAlongRouteMeters: 0 };
  if (coordinates.length === 1) {
    return {
      distanceMeters: haversineMeters(plazaLat, plazaLon, coordinates[0][0], coordinates[0][1]),
      distanceAlongRouteMeters: 0,
    };
  }

  let best: RouteMatch = { distanceMeters: Infinity, distanceAlongRouteMeters: 0 };
  for (let i = 0; i < coordinates.length - 1; i++) {
    const [aLat, aLon] = coordinates[i];
    const [bLat, bLon] = coordinates[i + 1];
    const { distanceMeters, t } = distanceToSegmentMeters(plazaLat, plazaLon, aLat, aLon, bLat, bLon);
    if (distanceMeters < best.distanceMeters) {
      const segmentLength = cumulativeMeters[i + 1] - cumulativeMeters[i];
      best = {
        distanceMeters,
        distanceAlongRouteMeters: cumulativeMeters[i] + t * segmentLength,
      };
      if (distanceMeters < 50) break; // close enough, stop early
    }
  }
  return best;
}

/**
 * Which NHAI fare applies for the whole journey at a matched plaza:
 * - "single": one crossing, one-way — `carSingle`.
 * - "round_trip_same_day": both crossings happen at the same plaza within the
 *   24-hour window the National Highways Fee Rules, 2008 give for a return
 *   journey — NHAI's discounted same-booth rate applies (`carReturn`, a
 *   ~1.5x-of-single fare, not 2x).
 * - "round_trip_multi_day": a round trip whose return leg passes the plaza
 *   more than 24 hours after the outbound leg (the common case for
 *   multi-day outstation tours) — the 24-hour concession no longer applies,
 *   so the return crossing is billed as a fresh single trip: `carSingle x 2`.
 */
export type TollRateMode = "single" | "round_trip_same_day" | "round_trip_multi_day";

/**
 * Estimate toll cost for a driving route by matching NHAI toll plazas whose
 * coordinates fall within MAX_MATCH_DISTANCE_M of the route polyline.
 */
export function estimateTollForRoute(
  coordinates: [number, number][],
  rateMode: TollRateMode,
): TollEstimateResult {
  if (!Array.isArray(coordinates) || coordinates.length === 0) {
    return { totalToll: 0, plazas: [] };
  }

  let minLat = Infinity, maxLat = -Infinity, minLon = Infinity, maxLon = -Infinity;
  for (const [lat, lon] of coordinates) {
    if (lat < minLat) minLat = lat;
    if (lat > maxLat) maxLat = lat;
    if (lon < minLon) minLon = lon;
    if (lon > maxLon) maxLon = lon;
  }
  const pad = 0.02; // ~2km bounding-box pad, cheap prefilter before the real distance check

  // Cumulative distance (meters) at each coordinate, so a matched plaza's
  // nearest point on the route can be converted into "N km into the trip".
  const cumulativeMeters: number[] = [0];
  for (let i = 1; i < coordinates.length; i++) {
    const [aLat, aLon] = coordinates[i - 1];
    const [bLat, bLon] = coordinates[i];
    cumulativeMeters.push(cumulativeMeters[i - 1] + haversineMeters(aLat, aLon, bLat, bLon));
  }

  const matches: TollMatch[] = [];
  for (const plaza of tollPlazas) {
    if (plaza.lat < minLat - pad || plaza.lat > maxLat + pad) continue;
    if (plaza.lon < minLon - pad || plaza.lon > maxLon + pad) continue;

    const { distanceMeters, distanceAlongRouteMeters } = matchToRoute(
      plaza.lat,
      plaza.lon,
      coordinates,
      cumulativeMeters,
    );
    if (distanceMeters <= MAX_MATCH_DISTANCE_M) {
      const rate =
        rateMode === "round_trip_same_day"
          ? plaza.carReturn
          : rateMode === "round_trip_multi_day"
            ? plaza.carSingle * 2
            : plaza.carSingle;

      matches.push({
        id: plaza.id,
        name: plaza.name,
        state: plaza.state,
        rate,
        distanceMeters: Math.round(distanceMeters),
        lat: plaza.lat,
        lon: plaza.lon,
        distanceAlongRouteKm: Math.round((distanceAlongRouteMeters / 1000) * 10) / 10,
      });
    }
  }

  // Present plazas in the order the vehicle actually reaches them along the route.
  matches.sort((a, b) => a.distanceAlongRouteKm - b.distanceAlongRouteKm);

  const totalToll = matches.reduce((sum, m) => sum + m.rate, 0);
  return { totalToll, plazas: matches };
}

/**
 * Round-trip toll estimate that matches the outbound and return legs
 * against the NHAI dataset independently, instead of assuming both legs
 * retrace the same road (which breaks once a leg routes through its own
 * waypoints and takes a genuinely different path). A plaza crossed on only
 * one leg — the common case for an asymmetric outbound/return route — is
 * billed as a single crossing; a plaza crossed on both legs is treated as
 * the same booth and billed once at the round-trip rate (or twice at the
 * single rate when the gap is beyond the 24-hour same-day window).
 */
export function estimateTollForRoundTrip(
  outboundCoordinates: [number, number][],
  returnCoordinates: [number, number][],
  rateMode: TollRateMode,
): TollEstimateResult {
  const out = estimateTollForRoute(outboundCoordinates, "single");
  const ret = estimateTollForRoute(returnCoordinates, "single");

  if (rateMode === "round_trip_multi_day") {
    // Beyond the 24-hour concession window, every crossing is billed fresh —
    // the same plaza on both legs is just two single-rate crossings.
    const plazas = [...out.plazas, ...ret.plazas];
    return { totalToll: plazas.reduce((sum, m) => sum + m.rate, 0), plazas };
  }

  const retById = new Map(ret.plazas.map((m) => [m.id, m]));
  const merged: TollMatch[] = [];

  for (const m of out.plazas) {
    const roundTripMatch = retById.has(m.id);
    if (roundTripMatch) {
      const plaza = tollPlazas.find((p) => p.id === m.id);
      merged.push({ ...m, rate: plaza ? plaza.carReturn : m.rate * 2 });
      retById.delete(m.id);
    } else {
      merged.push(m); // only crossed outbound
    }
  }
  // Whatever's left in retById was only crossed on the return leg.
  merged.push(...retById.values());

  merged.sort((a, b) => a.distanceAlongRouteKm - b.distanceAlongRouteKm);
  return { totalToll: merged.reduce((sum, m) => sum + m.rate, 0), plazas: merged };
}
