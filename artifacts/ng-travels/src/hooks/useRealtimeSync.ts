import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "@/hooks/use-toast";
import { syncEngine } from "@/lib/syncEngine";
import { supabase } from "@/lib/supabase/client";

export type ConnectionStatus = "connected" | "connecting" | "offline" | "standalone";

// Query keys each kind of change can affect. Only these get refetched —
// previously every event refetched a dozen endpoints.
const TRIP_KEYS = ["/api/trips", "/api/dashboard", "/api/driver/today", "/api/driver/current-trip"];

const EVENT_KEYS: Record<string, string[]> = {
  TRIP_CREATED: [...TRIP_KEYS, "/api/customers", "/api/notifications"],
  TRIP_UPDATED: TRIP_KEYS,
  TRIP_ASSIGNED: [...TRIP_KEYS, "/api/drivers", "/api/notifications"],
  TRIP_STATUS_CHANGED: TRIP_KEYS,
  TRIP_ACCEPTED: TRIP_KEYS,
  DRIVER_ARRIVED: TRIP_KEYS,
  REACHED_PICKUP: TRIP_KEYS,
  CUSTOMER_PICKED: TRIP_KEYS,
  JOURNEY_STARTED: TRIP_KEYS,
  REACHED_DESTINATION: TRIP_KEYS,
  TRIP_STARTED: [...TRIP_KEYS, "/api/drivers"],
  TRIP_COMPLETED: [...TRIP_KEYS, "/api/drivers", "/api/vehicles", "/api/customers"],
  TRIP_CANCELLED: [...TRIP_KEYS, "/api/drivers", "/api/vehicles"],
  DRIVER_STATUS_CHANGED: ["/api/drivers", "/api/driver/me", "/api/dashboard"],
  VEHICLE_CREATED: ["/api/vehicles", "/api/dashboard"],
  VEHICLE_UPDATED: ["/api/vehicles", "/api/dashboard"],
  PAYMENT_ADDED: ["/api/payments", "/api/trips", "/api/dashboard", "/api/customers"],
  PAYMENT_UPDATED: ["/api/payments", "/api/trips", "/api/dashboard", "/api/customers"],
  EXPENSE_SUBMITTED: ["/api/expenses", "/api/trips"],
  EXPENSE_APPROVED: ["/api/expenses", "/api/trips", "/api/dashboard"],
  EXPENSE_REJECTED: ["/api/expenses", "/api/trips"],
  NOTIFICATION_CREATED: ["/api/notifications"],
  AUDIT_LOG_CREATED: ["/api/audit-logs"],
  // LOCATION_UPDATED is deliberately absent: GPS pings arrive every few
  // seconds and only the live map needs them (it polls live-location itself).
};

// Supabase postgres_changes, by table
const TABLE_KEYS: Record<string, string[]> = {
  trips: TRIP_KEYS,
  drivers: ["/api/drivers", "/api/driver/me"],
  vehicles: ["/api/vehicles"],
  payments: ["/api/payments", "/api/dashboard"],
  trip_expenses: ["/api/expenses"],
  notifications: ["/api/notifications"],
};

// The SSE event and the Supabase change for the same edit arrive within
// moments of each other; collect keys briefly and refetch each once.
const INVALIDATE_DEBOUNCE_MS = 400;

export function useRealtimeSync() {
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<ConnectionStatus>(() => syncEngine.getState().status);

  useEffect(() => {
    const pendingKeys = new Set<string>();
    let flushTimer: ReturnType<typeof setTimeout> | null = null;
    const scheduleInvalidate = (keys: string[] | undefined) => {
      if (!keys || keys.length === 0) return;
      keys.forEach((k) => pendingKeys.add(k));
      if (flushTimer) return;
      flushTimer = setTimeout(() => {
        flushTimer = null;
        const keysToRefresh = [...pendingKeys];
        pendingKeys.clear();
        // Only active (mounted, enabled) queries refetch now; inactive ones
        // are just marked stale and refetch when next used.
        keysToRefresh.forEach((key) => queryClient.invalidateQueries({ queryKey: [key] }));
      }, INVALIDATE_DEBOUNCE_MS);
    };

    // 1. Subscribe to SyncEngine state changes
    const unsubscribeSync = syncEngine.subscribe((state) => {
      setStatus(state.status);
    });

    // 2. Connect Supabase Realtime PostgreSQL Change Stream (ddysnnfnzlhiidxkuvmh)
    let supabaseChannel: any = null;
    try {
      let channel = supabase.channel("ng_travels_realtime_changes");
      for (const [table, keys] of Object.entries(TABLE_KEYS)) {
        channel = channel.on("postgres_changes", { event: "*", schema: "public", table }, () =>
          scheduleInvalidate(keys),
        );
      }
      supabaseChannel = channel.subscribe((subStatus) => {
        if (subStatus === "SUBSCRIBED") {
          setStatus("connected");
        }
      });
    } catch (e) {
      console.warn("[Realtime] Supabase Realtime client initialization notice:", e);
    }

    // 3. Listen to local operational broadcast events
    const handleRealtimeEvent = (event: CustomEvent<any>) => {
      try {
        const { type, payload } = event.detail || {};

        // Refetch only the data this event can have changed
        scheduleInvalidate(EVENT_KEYS[type]);

        // Alert toasts for operational milestones
        if (type === "TRIP_STARTED") {
          toast({
            title: "🚀 Journey Started",
            description: `Trip ${payload?.bookingId || ""} started (Odometer: ${payload?.startingKm || ""} KM)`,
          });
        } else if (type === "TRIP_COMPLETED") {
          toast({
            title: "✓ Trip Completed",
            description: `Trip ${payload?.bookingId || ""} completed (${payload?.actualKm || ""} Actual KM clocked)`,
          });
        } else if (type === "PAYMENT_ADDED") {
          toast({
            title: "💰 Payment Recorded",
            description: `₹${payload?.amount || 0} recorded for trip #${payload?.tripId || ""}`,
          });
        } else if (type === "EXPENSE_SUBMITTED") {
          toast({
            title: "📋 New Expense Submitted",
            description: `₹${payload?.amount || 0} (${payload?.category || ""}) submitted for approval`,
          });
        } else if (type === "TRIP_CANCELLED") {
          toast({
            title: "⚠️ Trip Cancelled",
            description: `Trip ${payload?.bookingId || ""} was cancelled`,
            variant: "destructive",
          });
        }
      } catch (err) {
        console.error("[useRealtimeSync] Parse error:", err);
      }
    };

    window.addEventListener("ng_realtime_sync", handleRealtimeEvent as EventListener);

    return () => {
      if (flushTimer) clearTimeout(flushTimer);
      unsubscribeSync();
      if (supabaseChannel) {
        try {
          supabase.removeChannel(supabaseChannel);
        } catch {}
      }
      window.removeEventListener("ng_realtime_sync", handleRealtimeEvent as EventListener);
    };
  }, [queryClient]);

  return { status };
}
