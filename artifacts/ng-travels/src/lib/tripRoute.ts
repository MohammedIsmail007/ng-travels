interface RoutePoint {
  name?: string | null;
  address?: string | null;
}

const pointName = (p: RoutePoint | null | undefined, fallback: string) => p?.name || p?.address || fallback;

// "Pickup ➔ Stop 1 ➔ Stop 2 ➔ Destination": every in-between stop in order.
export function routeLabel(
  pickup: RoutePoint | null | undefined,
  stops: RoutePoint[] | null | undefined,
  destination: RoutePoint | null | undefined,
): string {
  const between = Array.isArray(stops) ? stops.map((s) => pointName(s, "Stop")) : [];
  return [pointName(pickup, "Pickup"), ...between, pointName(destination, "Destination")].join(" ➔ ");
}
