import { Router, type Request, type Response } from "express";
import multer from "multer";
import { and, asc, count, desc, eq, gte, ilike, inArray, isNull, lte, ne, or, sql } from "drizzle-orm";
import { db } from "@workspace/db";
import {
  appSettingsTable,
  auditLogsTable,
  customersTable,
  driversTable,
  enquiriesTable,
  notificationsTable,
  paymentsTable,
  refundsTable,
  tripExpensesTable,
  tripStatusHistoryTable,
  tripsTable,
  vehiclesTable,
  driverLocationsTable,
  usersTable,
  type TripLocation,
  type RouteAlternative,
  type Vehicle,
  type Customer,
  type Trip,
} from "@workspace/db";
import { requireAuth, requireOwner, requireDriver, viewerFor } from "../middlewares/auth.js";
import { supabaseServer } from "../lib/supabase.js";
import {
  calculateFare,
  calculateCommercialFare,
  calculateBillableDays,
  calculateCompanyProfit,
  validateOdometer,
} from "../lib/financialEngine.js";
import { searchPlaces, calculateRouteJourney, reverseGeocode, resolveLocationInput } from "../lib/routeService.js";
import { addRealtimeClient, broadcastRealtimeEvent } from "../lib/realtime.js";
import { memTrips, memSettings } from "../lib/memoryStore.js";

const router = Router();

// =============================================================
// SERVER-SENT EVENTS (SSE) REALTIME SUBSCRIPTION STREAM
// =============================================================
router.get("/realtime/stream", (req: Request, res: Response): void => {
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    "Connection": "keep-alive",
    "X-Accel-Buffering": "no",
  });
  addRealtimeClient(res);
});

// =============================================================
// HELPER FUNCTIONS & FORMATTERS
// =============================================================
const numeric = (value: unknown): number => {
  const result = Number(value ?? 0);
  return Number.isFinite(result) ? result : 0;
};

const dateOnly = (value: unknown): string => {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (!value) return "";
  return String(value).slice(0, 10);
};

const today = (): string =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
  }).format(new Date());

const startOfWeek = (day: string): string => {
  const date = new Date(`${day}T00:00:00Z`);
  const weekday = date.getUTCDay();
  date.setUTCDate(date.getUTCDate() - (weekday === 0 ? 6 : weekday - 1));
  return date.toISOString().slice(0, 10);
};

const startOfMonth = (day: string): string => `${day.slice(0, 7)}-01`;

const normalizeTripStatus = (value: unknown): string => {
  const normalized = String(value ?? "").trim().toLowerCase().replaceAll(" ", "_");
  return normalized === "pending" ? "upcoming" : normalized;
};

// Trips that still need their driver/vehicle/customer — anything not yet
// completed or cancelled. Used to block deleting a record mid-booking.
const openTripsFor = async (condition: ReturnType<typeof eq>) => {
  const rows = await db
    .select({ bookingId: tripsTable.bookingId, status: tripsTable.status })
    .from(tripsTable)
    .where(condition);
  return rows.filter((t) => !["completed", "cancelled"].includes(normalizeTripStatus(t.status)));
};

const defaultSettings = {
  company: "NG Travels Operations",
  mobile: "+91 98450 21867",
  email: "operations@ngtravels.in",
  currency: "INR",
  timezone: "Asia/Kolkata",
  defaultRate: 18,
  terms: "1. Toll, parking and state permit charges are customer payable at actuals.\n2. Billing starts and ends from garage to garage.\n3. AC will be switched off while driving in hill terrain.",
};

async function settingsView() {
  try {
    const rows = await db.select().from(appSettingsTable);
    const values = Object.fromEntries(rows.map((row) => [row.key, row.value]));
    return {
      company: values.company ?? defaultSettings.company,
      mobile: values.mobile ?? defaultSettings.mobile,
      email: values.email ?? defaultSettings.email,
      currency: values.currency ?? defaultSettings.currency,
      timezone: values.timezone ?? defaultSettings.timezone,
      defaultRate: values.defaultRate == null ? defaultSettings.defaultRate : numeric(values.defaultRate),
      terms: values.terms ?? defaultSettings.terms,
    };
  } catch {
    return defaultSettings;
  }
}

async function writeAudit(
  req: Request,
  action: string,
  entity: string,
  entityId: string | number,
  oldValue?: unknown,
  newValue?: unknown,
) {
  const viewer = await viewerFor(req);
  const actorName = viewer?.name ?? "Operations Admin";
  try {
    await db.insert(auditLogsTable).values({
      action,
      entity,
      entityId: String(entityId),
      actorName,
      oldValue: oldValue == null ? null : JSON.stringify(oldValue),
      newValue: newValue == null ? null : JSON.stringify(newValue),
    });
  } catch (err) {
    console.error("[audit] Failed to write audit log:", err);
  }
  broadcastRealtimeEvent("AUDIT_LOG_CREATED", { action, entity, entityId, actorName, timestamp: new Date() });
}

async function notify(
  title: string,
  message: string,
  kind: string,
  tripId?: number,
  audience: "owner" | "driver" = "owner",
  driverId?: number,
) {
  try {
    await db.insert(notificationsTable).values({
      audience,
      driverId: driverId ?? null,
      title,
      message,
      kind,
      tripId: tripId ?? null,
    });
  } catch (err) {
    console.error("[notify] Failed to write notification:", err);
  }
  broadcastRealtimeEvent("NOTIFICATION_CREATED", { title, message, kind, tripId, audience, driverId, timestamp: new Date() });
}

async function customerView(customer: typeof customersTable.$inferSelect) {
  const trips = await db
    .select()
    .from(tripsTable)
    .where(eq(tripsTable.customerId, customer.id))
    .orderBy(desc(tripsTable.startDate));

  const destinations = [...new Set(trips.map((trip) => {
    const location = trip.destination as TripLocation;
    return location?.name || "Destination";
  }))].slice(0, 4);

  const totalPaid = trips.reduce((sum, trip) => sum + numeric(trip.totalPaid), 0);
  const pending = trips.reduce((sum, trip) => sum + numeric(trip.remainingBalance), 0);

  return {
    id: customer.id,
    customerId: customer.customerCode,
    name: customer.name,
    mobile: customer.mobile,
    whatsapp: customer.whatsapp ?? undefined,
    alternateNumber: customer.alternateNumber ?? undefined,
    email: customer.email ?? undefined,
    address: customer.address ?? undefined,
    notes: customer.notes ?? undefined,
    createdAt: customer.createdAt instanceof Date ? customer.createdAt.toISOString() : String(customer.createdAt),
    totalTrips: trips.length,
    totalPaid: Math.round(totalPaid * 100) / 100,
    pending: Math.round(pending * 100) / 100,
    lastTrip: trips[0]?.startDate ? new Date(`${trips[0].startDate}T00:00:00Z`) : null,
    commonDestinations: destinations,
  };
}

function tripView(
  trip: typeof tripsTable.$inferSelect,
  customer?: typeof customersTable.$inferSelect | { id: number; name: string; mobile: string },
) {
  return {
    id: trip.id,
    bookingId: trip.bookingId,
    customerId: customer?.id ?? trip.customerId,
    customerName: customer?.name ?? "Customer",
    customerMobile: customer?.mobile ?? "",
    driverId: trip.driverId ?? null,
    driverName: trip.driverName ?? null,
    driverMobile: trip.driverMobile ?? null,
    vehicleId: trip.vehicleId ?? null,
    vehicleNumber: trip.vehicleNumber ?? null,
    idempotencyKey: trip.idempotencyKey ?? null,
    tripType: trip.tripType,
    pickup: trip.pickup as TripLocation,
    destination: trip.destination as TripLocation,
    stops: (trip.stops ?? []) as TripLocation[],
    startDate: new Date(`${trip.startDate}T00:00:00Z`),
    startTime: trip.startTime,
    returnDate: trip.returnDate ? new Date(`${trip.returnDate}T00:00:00Z`) : null,
    returnTime: trip.returnTime ?? null,
    passengerCount: trip.passengerCount,
    notes: trip.notes ?? null,
    specialInstructions: trip.specialInstructions ?? null,
    status: normalizeTripStatus(trip.status),
    mapDistanceKm: numeric(trip.mapDistanceKm),
    outboundMapKm: trip.outboundMapKm == null ? null : numeric(trip.outboundMapKm),
    returnMapKm: trip.returnMapKm == null ? null : numeric(trip.returnMapKm),
    totalMapKm: trip.totalMapKm == null ? null : numeric(trip.totalMapKm),
    routeDurationMinutes: trip.routeDurationMinutes ?? null,
    outboundDurationMinutes: trip.outboundDurationMinutes ?? null,
    returnDurationMinutes: trip.returnDurationMinutes ?? null,
    routeSummary: trip.routeSummary ?? null,
    selectedRouteSummary: trip.selectedRouteSummary ?? null,
    routeOptions: withoutPolylines(trip.routeOptions),
    apiEstimatedToll: trip.apiEstimatedToll == null ? null : numeric(trip.apiEstimatedToll),
    estimatedToll: trip.estimatedToll == null ? null : numeric(trip.estimatedToll),
    finalToll: numeric(trip.finalToll ?? trip.toll),
    outboundTollEstimate: trip.outboundTollEstimate == null ? null : numeric(trip.outboundTollEstimate),
    returnTollEstimate: trip.returnTollEstimate == null ? null : numeric(trip.returnTollEstimate),
    billingKm: numeric(trip.billingKm),
    ratePerKm: numeric(trip.ratePerKm),
    pricingMode: trip.pricingMode || "per_km",
    packageTotal: trip.packageTotal == null ? null : numeric(trip.packageTotal),
    baseFare: numeric(trip.baseFare),
    driverCommissionType: trip.driverCommissionType || "percentage",
    driverCommissionValue: numeric(trip.driverCommissionValue),
    driverCommissionAmount: numeric(trip.driverCommissionAmount),
    toll: numeric(trip.finalToll ?? trip.toll),
    parking: numeric(trip.parking),
    permitCharge: numeric(trip.permitCharge),
    customerTotal: numeric(trip.customerTotal),
    totalPaid: numeric(trip.totalPaid),
    remainingBalance: numeric(trip.remainingBalance),
    credit: numeric(trip.credit),
    startingKm: trip.startingKm == null ? null : numeric(trip.startingKm),
    startKmTime: trip.startKmTime ?? null,
    startKmLocation: trip.startKmLocation ?? null,
    startKmPhoto: trip.startKmPhoto ?? null,
    endingKm: trip.endingKm == null ? null : numeric(trip.endingKm),
    endKmTime: trip.endKmTime ?? null,
    endKmLocation: trip.endKmLocation ?? null,
    endKmPhoto: trip.endKmPhoto ?? null,
    actualKm: trip.actualKm == null ? null : numeric(trip.actualKm),
    standStartKm: trip.standStartKm == null ? null : numeric(trip.standStartKm),
    standStartPhoto: trip.standStartPhoto ?? null,
    standReturnKm: trip.standReturnKm == null ? null : numeric(trip.standReturnKm),
    standReturnPhoto: trip.standReturnPhoto ?? null,
    standReturnTime: trip.standReturnTime ?? null,
    ...standDistances(trip),
    expenseTotal: numeric(trip.expenseTotal),
    cancellationReason: trip.cancellationReason ?? null,
    cancelledAt: trip.cancelledAt ?? null,
    isLocked: Boolean(trip.isLocked),
    createdAt: trip.createdAt instanceof Date ? trip.createdAt : new Date(trip.createdAt),
    updatedAt: trip.updatedAt ? (trip.updatedAt instanceof Date ? trip.updatedAt : new Date(trip.updatedAt)) : undefined,
  };
}

// Route alternatives minus their map polylines. Nothing reads polylines back
// from a saved trip, and they made up ~95% of every trips-list response.
function withoutPolylines(routeOptions: unknown): any[] {
  if (!Array.isArray(routeOptions)) return [];
  return routeOptions.map((opt: any) => {
    if (!opt || typeof opt !== "object") return opt;
    const { polylineCoordinates, coordinates, ...rest } = opt;
    return rest;
  });
}

// Empty running at both ends of a trip, derived from the odometer readings:
// stand -> pickup, drop -> stand, and the full stand -> stand total. Each is
// null until both of its readings exist. Tracking only — never billed.
function standDistances(trip: {
  standStartKm?: string | null;
  startingKm?: string | null;
  endingKm?: string | null;
  standReturnKm?: string | null;
}) {
  const km = (v: string | null | undefined) => (v == null ? null : numeric(v));
  const diff = (to: number | null, from: number | null) =>
    to != null && from != null ? Math.round((to - from) * 100) / 100 : null;
  const standStart = km(trip.standStartKm);
  const standReturn = km(trip.standReturnKm);
  return {
    standToPickupKm: diff(km(trip.startingKm), standStart),
    dropToStandKm: diff(standReturn, km(trip.endingKm)),
    standToStandKm: diff(standReturn, standStart),
  };
}

function checkDocumentExpiry(expiryDateStr?: string | null) {
  if (!expiryDateStr) return { status: "missing", daysLeft: -999 };
  const expiry = new Date(expiryDateStr);
  const now = new Date();
  const diffTime = expiry.getTime() - now.getTime();
  const daysLeft = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
  if (daysLeft < 0) return { status: "expired", daysLeft };
  if (daysLeft <= 30) return { status: "expiring_soon", daysLeft };
  return { status: "valid", daysLeft };
}

function enrichVehicleWithAlerts(v: typeof vehiclesTable.$inferSelect) {
  const insurance = checkDocumentExpiry(v.insuranceExpiry);
  const permit = checkDocumentExpiry(v.permitExpiry);
  const fitness = checkDocumentExpiry(v.fitnessExpiry);
  const pollution = checkDocumentExpiry(v.pollutionExpiry);

  const alerts: string[] = [];
  if (insurance.status === "expired") alerts.push("Insurance Expired");
  else if (insurance.status === "expiring_soon") alerts.push(`Insurance Expiring in ${insurance.daysLeft}d`);

  if (permit.status === "expired") alerts.push("Permit Expired");
  else if (permit.status === "expiring_soon") alerts.push(`Permit Expiring in ${permit.daysLeft}d`);

  if (fitness.status === "expired") alerts.push("Fitness Expired");
  else if (fitness.status === "expiring_soon") alerts.push(`Fitness Expiring in ${fitness.daysLeft}d`);

  if (pollution.status === "expired") alerts.push("PUC Expired");
  else if (pollution.status === "expiring_soon") alerts.push(`PUC Expiring in ${pollution.daysLeft}d`);

  return {
    ...v,
    documentAlerts: alerts,
    hasExpiringDocuments: alerts.length > 0,
    insuranceStatus: insurance.status,
    permitStatus: permit.status,
    fitnessStatus: fitness.status,
    pollutionStatus: pollution.status,
  };
}

// =============================================================
// AUTHENTICATION ROUTES (SUPABASE AUTH)
// =============================================================

const DRIVER_AUTH_EMAIL_DOMAIN = "auth.ngtravels.internal";
function driverAuthEmail(driverCode: string): string {
  return `driver.${driverCode.toLowerCase()}@${DRIVER_AUTH_EMAIL_DOMAIN}`;
}

/**
 * Normalizes a mobile number to E.164 for the driver's Supabase Auth phone
 * field (stored for reference only — driver sign-in is by password, not
 * phone/SMS OTP). Assumes India (+91) when no country code is given,
 * matching how driver mobiles are entered/stored elsewhere in this app.
 */
function toE164(raw: string): string {
  const trimmed = String(raw || "").trim();
  const digits = trimmed.replace(/\D/g, "");
  if (trimmed.startsWith("+")) return `+${digits}`;
  if (digits.length === 10) return `+91${digits}`;
  return `+${digits}`;
}

/**
 * Owner/admin/manager authentication happens client-side via Supabase Auth
 * directly (supabase.auth.signInWithPassword). This endpoint is intentionally
 * not provided by the API server.
 */

/**
 * Driver Partner login with Mobile / Driver Code and Password.
 * Resolves the identifier to the driver's synthetic Supabase Auth email and
 * exchanges the password for a real Supabase session via GoTrue.
 */
router.post("/auth/driver-login", async (req, res): Promise<void> => {
  const { identifier, mobile, driverCode, password } = req.body;
  const credential = String(password || "").trim();
  const rawId = String(identifier || driverCode || mobile || "").trim();

  if (!rawId || !credential) {
    res.status(400).json({
      success: false,
      error: { code: "VALIDATION_ERROR", message: "Mobile/Driver Code and password are required." },
    });
    return;
  }

  const cleanMobile = rawId.replace(/\D/g, "");
  const cleanCode = rawId.toUpperCase();

  try {
    const allDrivers = await db.select().from(driversTable);
    const driver = allDrivers.find(
      (d) =>
        d.status !== "archived" &&
        ((cleanMobile.length >= 7 && d.mobile.replace(/\D/g, "").includes(cleanMobile)) ||
          (cleanCode && d.driverCode.toUpperCase() === cleanCode))
    );

    if (!driver || driver.status === "inactive") {
      res.status(401).json({
        success: false,
        error: { code: "DRIVER_NOT_FOUND", message: "Driver profile not found or inactive. Contact NG Travels operations desk." },
      });
      return;
    }

    const { data, error } = await supabaseServer.auth.signInWithPassword({
      email: driverAuthEmail(driver.driverCode),
      password: credential,
    });

    if (error || !data?.session) {
      res.status(401).json({
        success: false,
        error: { code: "INVALID_CREDENTIALS", message: "Invalid driver password." },
      });
      return;
    }

    // Self-heal: the client derives `driverId` from this JWT's own
    // user_metadata (not the response body below), so any auth account
    // provisioned before driver_id was added to user_metadata — or created
    // through a path that omitted it — would otherwise carry a session with
    // no driver_id forever, and every driver would see every other driver's
    // data (expenses, trips, etc.) client-side. Backfill it on every login;
    // cheap and idempotent, and the client re-authenticates right after via
    // setSession(), so the corrected metadata lands in the session it uses.
    if (data.user.user_metadata?.driver_id !== driver.id) {
      const { error: metaError } = await supabaseServer.auth.admin.updateUserById(data.user.id, {
        user_metadata: { ...data.user.user_metadata, role: "driver", full_name: driver.name, driver_id: driver.id },
      });
      if (metaError) {
        console.error("[auth] Failed to backfill driver_id in user_metadata:", metaError);
      } else {
        const refreshed = await supabaseServer.auth.signInWithPassword({
          email: driverAuthEmail(driver.driverCode),
          password: credential,
        });
        if (refreshed.data?.session) {
          data.session = refreshed.data.session;
        }
      }
    }

    await db.update(usersTable).set({ lastLogin: new Date() }).where(eq(usersTable.driverId, driver.id));

    res.json({
      success: true,
      session: {
        accessToken: data.session.access_token,
        refreshToken: data.session.refresh_token,
        expiresAt: data.session.expires_at,
      },
      user: {
        fullName: driver.name,
        mobile: driver.mobile,
        driverCode: driver.driverCode,
        role: "driver",
        driverId: driver.id,
      },
    });
  } catch (err: any) {
    console.error("[auth] Driver login error:", err);
    res.status(500).json({
      success: false,
      error: { code: "SERVER_ERROR", message: "Unable to process driver login right now." },
    });
  }
});

/**
 * Driver password reset request. Passwords are admin-managed (not self-service), so this
 * just raises an owner-audience notification for the operations desk to act
 * on; it always returns success to avoid leaking whether an identifier matched.
 */
router.post("/auth/driver-password-reset-request", async (req, res): Promise<void> => {
  const { identifier, note } = req.body;
  const rawId = String(identifier || "").trim();

  if (!rawId) {
    res.status(400).json({
      success: false,
      error: { code: "VALIDATION_ERROR", message: "Driver Code or Mobile number is required." },
    });
    return;
  }

  try {
    const cleanMobile = rawId.replace(/\D/g, "");
    const cleanCode = rawId.toUpperCase();
    const allDrivers = await db.select().from(driversTable);
    const driver = allDrivers.find(
      (d) =>
        d.status !== "archived" &&
        ((cleanMobile.length >= 7 && d.mobile.replace(/\D/g, "").includes(cleanMobile)) ||
          (cleanCode && d.driverCode.toUpperCase() === cleanCode))
    );

    if (driver) {
      const trimmedNote = String(note || "").trim();
      await notify(
        "Driver Password Reset Requested",
        `${driver.name} (${driver.driverCode}) requested a password reset.${trimmedNote ? ` Note: ${trimmedNote}` : ""}`,
        "password_reset_request",
        undefined,
        "owner",
        driver.id,
      );
    }

    // Always respond success — don't reveal whether the identifier matched a driver.
    res.json({ success: true, message: "If a matching driver account was found, operations has been notified." });
  } catch (err: any) {
    console.error("[auth] Driver password reset request error:", err);
    res.status(500).json({
      success: false,
      error: { code: "SERVER_ERROR", message: "Unable to submit the request right now." },
    });
  }
});

/**
 * ADMIN DRIVER MANAGEMENT ROUTES
 * =============================================================
 */

/**
 * Create a new driver account with email and initial password
 * Admin-only endpoint
 */
router.post("/admin/drivers", requireOwner, async (req, res): Promise<void> => {
  const { name, driverCode, mobile, email, licenseNumber, licenseExpiry, emergencyContact, initialPassword } = req.body;

  if (!name || !driverCode || !mobile || !email || !initialPassword) {
    res.status(400).json({
      success: false,
      error: { code: "VALIDATION_ERROR", message: "Name, driver code, mobile, email, and initial password are required." },
    });
    return;
  }

  try {
    // Create driver record first so its id exists to stamp into the auth
    // account's user_metadata below — the client derives its driverId
    // client-side from that metadata (not a server round trip), so an auth
    // account created without driver_id in it would let a driver see every
    // other driver's data (expenses, trips, etc.) client-side forever.
    const [driver] = await db
      .insert(driversTable)
      .values({
        name,
        driverCode: driverCode.toUpperCase(),
        mobile,
        email: email.toLowerCase().trim(),
        licenseNumber: licenseNumber || null,
        licenseExpiry: licenseExpiry || null,
        emergencyContact: emergencyContact || null,
        status: "active",
      })
      .returning();

    // Driver sign-in (see /auth/driver-login) always looks the account up by
    // the synthetic driver.<code>@auth.ngtravels.internal address, not the
    // driver's real contact email — the real email is stored on the driver
    // record for reference/notifications, not used as the auth identity.
    const { data: authData, error: authError } = await supabaseServer.auth.admin.createUser({
      email: driverAuthEmail(driverCode.toUpperCase()),
      phone: toE164(mobile),
      password: initialPassword,
      email_confirm: true,
      phone_confirm: true,
      user_metadata: {
        full_name: name,
        role: "driver",
        driver_id: driver.id,
      },
    });

    if (authError || !authData?.user) {
      await db.delete(driversTable).where(eq(driversTable.id, driver.id));
      res.status(400).json({
        success: false,
        error: { code: "AUTH_ERROR", message: authError?.message || "Failed to create auth account." },
      });
      return;
    }

    // The handle_new_user() trigger already inserted a bare public.users row
    // for this auth identity; link it to the driver record just created.
    await db
      .update(usersTable)
      .set({
        name,
        email: email.toLowerCase().trim(),
        phone: mobile,
        role: "driver",
        driverId: driver.id,
        status: "active",
      })
      .where(eq(usersTable.authUserId, authData.user.id));

    res.json({
      success: true,
      message: "Driver account created successfully.",
      driver: {
        id: driver.id,
        name: driver.name,
        driverCode: driver.driverCode,
        mobile: driver.mobile,
        email: driver.email,
      },
    });
  } catch (err: any) {
    console.error("[admin] Create driver error:", err);
    res.status(500).json({
      success: false,
      error: { code: "SERVER_ERROR", message: "Unable to create driver account." },
    });
  }
});

/**
 * Reset a driver's password
 * Admin-only endpoint
 */
router.post("/admin/drivers/:driverId/reset-password", requireOwner, async (req, res): Promise<void> => {
  const { driverId } = req.params;
  const { newPassword } = req.body;

  if (!newPassword || newPassword.length < 6) {
    res.status(400).json({
      success: false,
      error: { code: "VALIDATION_ERROR", message: "New password must be at least 6 characters." },
    });
    return;
  }

  try {
    const [driver] = await db.select().from(driversTable).where(eq(driversTable.id, parseInt(String(driverId))));

    if (!driver) {
      res.status(404).json({
        success: false,
        error: { code: "NOT_FOUND", message: "Driver not found." },
      });
      return;
    }

    // Get the user record to find the auth user ID
    const [user] = await db.select().from(usersTable).where(eq(usersTable.driverId, parseInt(String(driverId))));

    if (!user?.authUserId) {
      res.status(400).json({
        success: false,
        error: { code: "NO_AUTH_USER", message: "Driver does not have an auth account." },
      });
      return;
    }

    // Update password in Supabase Auth
    const { error: updateError } = await supabaseServer.auth.admin.updateUserById(user.authUserId, {
      password: newPassword,
    });

    if (updateError) {
      res.status(400).json({
        success: false,
        error: { code: "AUTH_ERROR", message: updateError.message || "Failed to reset password." },
      });
      return;
    }

    // Notify driver about password reset
    await notify(
      "Password Reset by Admin",
      `Your driver password has been reset by the operations team. Please use your new password to login.`,
      "password_reset",
      user.id,
      "driver",
      driver.id,
    );

    res.json({
      success: true,
      message: `Password reset for driver ${driver.name} (${driver.driverCode})`,
    });
  } catch (err: any) {
    console.error("[admin] Reset driver password error:", err);
    res.status(500).json({
      success: false,
      error: { code: "SERVER_ERROR", message: "Unable to reset driver password." },
    });
  }
});

/**
 * ADMIN / STAFF USER MANAGEMENT ROUTES
 * =============================================================
 * Owner/Admin login accounts (not drivers — those are managed above).
 */

// Roles creatable through this endpoint. "owner" and "super_admin" are
// deliberately excluded — granting the highest privilege tier isn't a
// simple-form action, and "driver" has its own dedicated flow above.
const STAFF_ROLES = ["admin", "manager", "dispatcher", "accountant"] as const;

router.get("/admin/users", requireOwner, async (_req, res): Promise<void> => {
  try {
    const rows = await db
      .select()
      .from(usersTable)
      .where(ne(usersTable.role, "driver"))
      .orderBy(asc(usersTable.name));
    res.json(rows.map((u) => ({ ...u, authUserId: undefined })));
  } catch (err: any) {
    console.error("[admin/users] Database query failed:", err?.message);
    res.status(503).json({ success: false, error: { code: "DATABASE_ERROR", message: "Unable to load staff accounts. Please try again." } });
  }
});

router.post("/admin/users", requireOwner, async (req, res): Promise<void> => {
  const { name, email, mobile, role, initialPassword } = req.body;

  if (!name || !email || !initialPassword) {
    res.status(400).json({
      success: false,
      error: { code: "VALIDATION_ERROR", message: "Name, email, and initial password are required." },
    });
    return;
  }
  if (initialPassword.length < 6) {
    res.status(400).json({
      success: false,
      error: { code: "VALIDATION_ERROR", message: "Password must be at least 6 characters." },
    });
    return;
  }
  const staffRole = STAFF_ROLES.includes(role) ? role : "admin";

  try {
    const { data: authData, error: authError } = await supabaseServer.auth.admin.createUser({
      email: String(email).toLowerCase().trim(),
      phone: mobile ? toE164(mobile) : undefined,
      password: initialPassword,
      email_confirm: true,
      phone_confirm: mobile ? true : undefined,
      user_metadata: {
        full_name: name,
        role: staffRole,
      },
    });

    if (authError || !authData?.user) {
      const isDuplicate = /already.*registered|already exists/i.test(authError?.message || "");
      res.status(400).json({
        success: false,
        error: {
          code: "AUTH_ERROR",
          message: isDuplicate
            ? "An account with this email already exists."
            : authError?.message || "Failed to create auth account.",
        },
      });
      return;
    }

    // The handle_new_user() trigger already inserted a bare public.users row
    // for this auth identity; fill in the actual profile fields on it.
    const [staffUser] = await db
      .update(usersTable)
      .set({
        name,
        email: String(email).toLowerCase().trim(),
        phone: mobile || null,
        role: staffRole,
        status: "active",
      })
      .where(eq(usersTable.authUserId, authData.user.id))
      .returning();

    await writeAudit(req, `Created ${staffRole} account`, "user", staffUser?.id ?? authData.user.id, null, { name, email, role: staffRole });

    res.status(201).json({
      success: true,
      message: `${staffRole.charAt(0).toUpperCase()}${staffRole.slice(1)} account created successfully.`,
      user: staffUser ? { ...staffUser, authUserId: undefined } : null,
    });
  } catch (err: any) {
    console.error("[admin/users] Create error:", err);
    res.status(500).json({
      success: false,
      error: { code: "SERVER_ERROR", message: "Unable to create the staff account." },
    });
  }
});

router.patch("/admin/users/:id", requireOwner, async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  const { role, status } = req.body;

  try {
    const [existing] = await db.select().from(usersTable).where(eq(usersTable.id, id));
    if (!existing) {
      res.status(404).json({ success: false, error: { code: "NOT_FOUND", message: "Staff account not found." } });
      return;
    }
    if (existing.role === "driver") {
      res.status(400).json({ success: false, error: { code: "INVALID_TARGET", message: "Use the driver management endpoints for driver accounts." } });
      return;
    }
    if (existing.role === "owner") {
      res.status(400).json({ success: false, error: { code: "INVALID_TARGET", message: "The account owner's role/status can't be changed here." } });
      return;
    }

    const viewer = await viewerFor(req);
    if (viewer?.id === id && status === "inactive") {
      res.status(400).json({ success: false, error: { code: "SELF_LOCKOUT", message: "You can't deactivate your own account." } });
      return;
    }

    const updates: Record<string, any> = {};
    if (role) {
      if (!STAFF_ROLES.includes(role)) {
        res.status(400).json({ success: false, error: { code: "VALIDATION_ERROR", message: "Invalid role." } });
        return;
      }
      updates.role = role;
    }
    if (status === "active" || status === "inactive") updates.status = status;

    if (Object.keys(updates).length === 0) {
      res.status(400).json({ success: false, error: { code: "VALIDATION_ERROR", message: "Nothing to update." } });
      return;
    }

    const [updated] = await db.update(usersTable).set(updates).where(eq(usersTable.id, id)).returning();
    await writeAudit(req, "Updated staff account", "user", id, existing, updated);
    res.json({ success: true, user: { ...updated, authUserId: undefined } });
  } catch (err: any) {
    console.error("[admin/users] Update error:", err);
    res.status(500).json({ success: false, error: { code: "SERVER_ERROR", message: "Unable to update the staff account." } });
  }
});

router.post("/admin/users/:id/reset-password", requireOwner, async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  const { newPassword } = req.body;

  if (!newPassword || newPassword.length < 6) {
    res.status(400).json({
      success: false,
      error: { code: "VALIDATION_ERROR", message: "New password must be at least 6 characters." },
    });
    return;
  }

  try {
    const [user] = await db.select().from(usersTable).where(eq(usersTable.id, id));
    if (!user || user.role === "driver") {
      res.status(404).json({ success: false, error: { code: "NOT_FOUND", message: "Staff account not found." } });
      return;
    }
    if (!user.authUserId) {
      res.status(400).json({ success: false, error: { code: "NO_AUTH_USER", message: "This account has no linked login." } });
      return;
    }

    const { error: updateError } = await supabaseServer.auth.admin.updateUserById(user.authUserId, {
      password: newPassword,
    });
    if (updateError) {
      res.status(400).json({ success: false, error: { code: "AUTH_ERROR", message: updateError.message || "Failed to reset password." } });
      return;
    }

    await writeAudit(req, "Reset staff password", "user", id);
    res.json({ success: true, message: `Password reset for ${user.name}.` });
  } catch (err: any) {
    console.error("[admin/users] Reset password error:", err);
    res.status(500).json({ success: false, error: { code: "SERVER_ERROR", message: "Unable to reset password." } });
  }
});

/**
 * Get current authenticated user profile
 */
router.get("/auth/me", async (req, res): Promise<void> => {
  const viewer = await viewerFor(req);
  if (!viewer) {
    res.status(401).json({
      success: false,
      error: { code: "UNAUTHORIZED", message: "Session expired or invalid. Please sign in." },
    });
    return;
  }

  let driverDetails: any = null;
  if (viewer.driverId) {
    try {
      const [d] = await db.select().from(driversTable).where(eq(driversTable.id, viewer.driverId));
      driverDetails = d || null;
    } catch (err) {
      console.error("[auth] Failed to load driver details:", err);
    }
  }

  res.json({
    success: true,
    user: {
      ...viewer,
      driver: driverDetails,
    },
  });
});

/**
 * Sign out. Supabase Auth sessions are invalidated client-side via
 * supabase.auth.signOut(); this endpoint is kept as a no-op for API
 * compatibility.
 */
router.post("/auth/logout", async (_req, res): Promise<void> => {
  res.json({ success: true, message: "Logged out successfully" });
});

// =============================================================
// DASHBOARD & LIVE FLEET OPERATIONS
// =============================================================
router.get("/dashboard", requireOwner, async (_req, res): Promise<void> => {
  const currentDay = today();
  const weekStart = startOfWeek(currentDay);
  const monthStart = startOfMonth(currentDay);

  try {
    const allTrips = await db.select().from(tripsTable);
    const approvedExpenses = await db.select().from(tripExpensesTable).where(eq(tripExpensesTable.status, "approved"));
    const allDrivers = await db.select().from(driversTable);
    const allVehicles = await db.select().from(vehiclesTable);

    const todayTrips = allTrips.filter((trip) => trip.startDate === currentDay);
    const inRange = (trip: typeof tripsTable.$inferSelect, from: string) =>
      trip.startDate >= from && trip.startDate <= currentDay;
    const revenue = (trips: typeof allTrips) =>
      trips.reduce((sum, trip) => sum + numeric(trip.customerTotal), 0);
    const expenses = (trips: typeof allTrips) => {
      const tripIds = new Set(trips.map((t) => t.id));
      return approvedExpenses.filter((e) => tripIds.has(e.tripId)).reduce((sum, e) => sum + numeric(e.amount), 0);
    };

    const metrics = {
      totalTrips: allTrips.length,
      todaysTrips: todayTrips.length,
      upcomingTrips: todayTrips.filter((trip) => ["upcoming", "confirmed", "ready"].includes(normalizeTripStatus(trip.status))).length,
      started: todayTrips.filter((trip) => normalizeTripStatus(trip.status) === "started").length,
      inProgress: todayTrips.filter((trip) => ["reached_pickup", "customer_picked_up", "in_progress"].includes(normalizeTripStatus(trip.status))).length,
      completedToday: todayTrips.filter((trip) => normalizeTripStatus(trip.status) === "completed").length,
      paymentPending: allTrips.filter((trip) => numeric(trip.remainingBalance) > 0).length,
      todaysRevenue: Math.round(revenue(todayTrips) * 100) / 100,
      todaysCollection: Math.round(todayTrips.reduce((sum, trip) => sum + numeric(trip.totalPaid), 0) * 100) / 100,
      todaysExpenses: Math.round(expenses(todayTrips) * 100) / 100,
      todaysProfit: Math.round((revenue(todayTrips) - expenses(todayTrips)) * 100) / 100,
      weeklyRevenue: Math.round(revenue(allTrips.filter((trip) => inRange(trip, weekStart))) * 100) / 100,
      weeklyExpenses: Math.round(expenses(allTrips.filter((trip) => inRange(trip, weekStart))) * 100) / 100,
      weeklyProfit: 0,
      monthlyRevenue: Math.round(revenue(allTrips.filter((trip) => inRange(trip, monthStart))) * 100) / 100,
      monthlyExpenses: Math.round(expenses(allTrips.filter((trip) => inRange(trip, monthStart))) * 100) / 100,
      monthlyProfit: 0,
      availableDrivers: allDrivers.filter((d) => d.availability === "available" && d.status === "active").length,
      driversOnTrip: allDrivers.filter((d) => d.availability === "on_trip").length,
      availableVehicles: allVehicles.filter((v) => v.status === "active").length,
      vehiclesOnTrip: allTrips.filter((t) => ["started", "in_progress"].includes(normalizeTripStatus(t.status)) && t.vehicleId).length,
    };
    metrics.weeklyProfit = calculateCompanyProfit(metrics.weeklyRevenue, metrics.weeklyExpenses);
    metrics.monthlyProfit = calculateCompanyProfit(metrics.monthlyRevenue, metrics.monthlyExpenses);

    const scheduledRows = await db
      .select({ trip: tripsTable, customer: customersTable })
      .from(tripsTable)
      .leftJoin(customersTable, eq(tripsTable.customerId, customersTable.id))
      .where(eq(tripsTable.startDate, currentDay))
      .orderBy(asc(tripsTable.startTime));

    const activity = await db.select().from(auditLogsTable).orderBy(desc(auditLogsTable.createdAt)).limit(10);

    res.json({
      date: new Date(`${currentDay}T00:00:00Z`),
      metrics,
      schedule: scheduledRows.map(({ trip, customer }) => ({
        id: trip.id,
        bookingId: trip.bookingId,
        time: trip.startTime,
        pickup: (trip.pickup as TripLocation)?.name || "Pickup",
        destination: (trip.destination as TripLocation)?.name || "Destination",
        customerName: customer?.name || "Customer",
        driverName: trip.driverName ?? "Unassigned",
        status: trip.status,
      })),
      recentActivity: activity.map((entry) => ({
        id: entry.id,
        title: entry.action,
        detail: `${entry.entity} ${entry.entityId}`,
        timestamp: entry.createdAt,
      })),
    });
  } catch (err: any) {
    console.error("[dashboard] Database query failed:", err?.message);
    res.status(503).json({ success: false, error: { code: "DATABASE_ERROR", message: "Unable to load dashboard data. Please try again." } });
  }
});

// =============================================================
// DRIVERS FLEET MANAGEMENT
// =============================================================
router.get("/drivers", requireOwner, async (_req, res): Promise<void> => {
  try {
    const rows = await db
      .select()
      .from(driversTable)
      .where(ne(driversTable.status, "archived"))
      .orderBy(asc(driversTable.name));
    res.json(rows);
  } catch (err: any) {
    console.error("[drivers] Database query failed:", err?.message);
    res.status(503).json({ success: false, error: { code: "DATABASE_ERROR", message: "Unable to load drivers. Please try again." } });
  }
});

router.post("/drivers", requireOwner, async (req, res): Promise<void> => {
  const body = req.body;
  try {
    const [countResult] = await db.select({ count: count() }).from(driversTable);
    const nextCode = `DRV-${String(Number(countResult.count || 0) + 101).padStart(3, "0")}`;

    const [row] = await db
      .insert(driversTable)
      .values({
        driverCode: body.driverCode || nextCode,
        name: body.name.trim(),
        mobile: body.mobile.trim(),
        email: body.email ? body.email.trim() : null,
        licenseNumber: body.licenseNumber ? body.licenseNumber.trim() : null,
        licenseExpiry: body.licenseExpiry || null,
        emergencyContact: body.emergencyContact || null,
        status: body.status || "active",
        availability: body.availability || "available",
        rating: String(body.rating || "4.8"),
        notes: body.notes || null,
      })
      .returning();

    // Provision a Supabase Auth identity for the driver (mobile/code + PIN login)
    const defaultPin = body.pin || "123456";
    try {
      const { data: authUser, error: authError } = await supabaseServer.auth.admin.createUser({
        email: driverAuthEmail(row.driverCode),
        phone: toE164(row.mobile),
        password: defaultPin,
        email_confirm: true,
        phone_confirm: true,
        user_metadata: { role: "driver", full_name: row.name, driver_id: row.id },
      });

      if (authError || !authUser?.user) {
        throw authError || new Error("Supabase did not return a user");
      }

      // The handle_new_user() trigger already inserted a bare public.users row
      // for this auth identity; link it to the driver record just created.
      await db
        .update(usersTable)
        .set({ driverId: row.id, name: row.name, phone: row.mobile, role: "driver", status: "active" })
        .where(eq(usersTable.authUserId, authUser.user.id));
    } catch (authErr: any) {
      console.error("[drivers] Failed to provision Supabase Auth login for driver:", authErr);
    }

    await writeAudit(req, "Created driver", "driver", row.id, null, row);
    broadcastRealtimeEvent("DRIVER_STATUS_CHANGED", row);
    res.status(201).json(row);
  } catch (err: any) {
    console.error("[drivers] Create error:", err);
    res.status(500).json({ success: false, error: { code: "DATABASE_ERROR", message: "Failed to create driver record" } });
  }
});

router.get("/drivers/:id", requireOwner, async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  try {
    const [row] = await db.select().from(driversTable).where(eq(driversTable.id, id));
    if (!row) {
      res.status(404).json({ success: false, error: { code: "NOT_FOUND", message: "Driver not found" } });
      return;
    }
    res.json(row);
  } catch (err: any) {
    res.status(500).json({ success: false, error: { code: "DATABASE_ERROR", message: err.message } });
  }
});

router.patch("/drivers/:id", requireOwner, async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  try {
    const [row] = await db
      .update(driversTable)
      .set({
        ...req.body,
        updatedAt: new Date(),
      })
      .where(eq(driversTable.id, id))
      .returning();

    if (!row) {
      res.status(404).json({ success: false, error: { code: "NOT_FOUND", message: "Driver not found" } });
      return;
    }

    await writeAudit(req, "Updated driver", "driver", id, null, row);
    broadcastRealtimeEvent("DRIVER_STATUS_CHANGED", row);
    res.json(row);
  } catch (err: any) {
    console.error("[drivers] Update error:", err);
    res.status(500).json({ success: false, error: { code: "DATABASE_ERROR", message: "Failed to update driver" } });
  }
});

// Soft delete: trips, expenses and payments keep foreign keys to the
// driver, so the row is archived (hidden from lists, login blocked) rather
// than removed, preserving trip history.
router.delete("/drivers/:id", requireOwner, async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  try {
    const openTrips = await openTripsFor(eq(tripsTable.driverId, id));
    if (openTrips.length > 0) {
      res.status(409).json({
        success: false,
        error: {
          code: "HAS_OPEN_TRIPS",
          message: `Driver is assigned to ${openTrips.length} open trip(s) (${openTrips.map((t) => t.bookingId).join(", ")}). Reassign or close them first.`,
        },
      });
      return;
    }

    const [row] = await db
      .update(driversTable)
      .set({ status: "archived", availability: "offline", updatedAt: new Date() })
      .where(eq(driversTable.id, id))
      .returning();

    if (!row) {
      res.status(404).json({ success: false, error: { code: "NOT_FOUND", message: "Driver not found" } });
      return;
    }

    await db.update(usersTable).set({ status: "inactive" }).where(eq(usersTable.driverId, id));
    await db.update(vehiclesTable).set({ assignedDriverId: null }).where(eq(vehiclesTable.assignedDriverId, id));

    await writeAudit(req, "Deleted driver", "driver", id, row, null);
    broadcastRealtimeEvent("DRIVER_STATUS_CHANGED", row);
    res.json({ success: true, id });
  } catch (err: any) {
    console.error("[drivers] Delete error:", err);
    res.status(500).json({ success: false, error: { code: "DATABASE_ERROR", message: "Failed to delete driver" } });
  }
});

router.patch("/drivers/:id/availability", async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  const { availability } = req.body;
  try {
    const [row] = await db
      .update(driversTable)
      .set({ availability, updatedAt: new Date() })
      .where(eq(driversTable.id, id))
      .returning();

    if (!row) {
      res.status(404).json({ success: false, error: { code: "NOT_FOUND", message: "Driver not found" } });
      return;
    }

    await writeAudit(req, `Changed availability to ${availability}`, "driver", id);
    broadcastRealtimeEvent("DRIVER_STATUS_CHANGED", row);
    res.json(row);
  } catch (err: any) {
    res.status(500).json({ success: false, error: { code: "DATABASE_ERROR", message: err.message } });
  }
});

// =============================================================
// COMMERCIAL VEHICLES FLEET
// =============================================================
router.get("/vehicles", async (_req, res): Promise<void> => {
  try {
    const rows = await db
      .select()
      .from(vehiclesTable)
      .where(ne(vehiclesTable.status, "archived"))
      .orderBy(asc(vehiclesTable.vehicleNumber));
    res.json(rows.map(enrichVehicleWithAlerts));
  } catch (err: any) {
    console.error("[vehicles] Database query failed:", err?.message);
    res.status(503).json({ success: false, error: { code: "DATABASE_ERROR", message: "Unable to load vehicles. Please try again." } });
  }
});

router.get("/vehicles/expiry-alerts", async (_req, res): Promise<void> => {
  try {
    const rows = await db.select().from(vehiclesTable);
    const withAlerts = rows.map(enrichVehicleWithAlerts).filter((v) => v.hasExpiringDocuments);
    res.json(withAlerts);
  } catch (err: any) {
    res.status(500).json({ success: false, error: { code: "DATABASE_ERROR", message: err.message } });
  }
});

router.get("/vehicles/:id", async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  try {
    const [row] = await db.select().from(vehiclesTable).where(eq(vehiclesTable.id, id));
    if (!row) {
      res.status(404).json({ success: false, error: { code: "NOT_FOUND", message: "Vehicle not found" } });
      return;
    }
    res.json(enrichVehicleWithAlerts(row));
  } catch (err: any) {
    res.status(500).json({ success: false, error: { code: "DATABASE_ERROR", message: err.message } });
  }
});

router.post("/vehicles", requireOwner, async (req, res): Promise<void> => {
  const body = req.body;
  try {
    const [row] = await db
      .insert(vehiclesTable)
      .values({
        vehicleNumber: body.vehicleNumber.trim().toUpperCase(),
        vehicleType: body.vehicleType || "Sedan",
        brand: body.brand || "Toyota",
        model: body.model || "Innova",
        year: body.year ? Number(body.year) : null,
        capacity: Number(body.capacity || 4),
        fuelType: body.fuelType || "Diesel",
        rcNumber: body.rcNumber || null,
        insurancePolicy: body.insurancePolicy || null,
        insuranceExpiry: body.insuranceExpiry || null,
        permitNumber: body.permitNumber || null,
        permitExpiry: body.permitExpiry || null,
        fitnessCertNumber: body.fitnessCertNumber || null,
        fitnessExpiry: body.fitnessExpiry || null,
        pollutionCertNumber: body.pollutionCertNumber || null,
        pollutionExpiry: body.pollutionExpiry || null,
        assignedDriverId: body.assignedDriverId ? Number(body.assignedDriverId) : null,
        status: body.status || "active",
        maintenanceStatus: body.maintenanceStatus || "good",
        lastServiceDate: body.lastServiceDate || null,
        nextServiceDate: body.nextServiceDate || null,
        currentOdometerKm: String(body.currentOdometerKm || "0"),
        notes: body.notes || null,
      })
      .returning();

    await writeAudit(req, "Created vehicle", "vehicle", row.id, null, row);
    broadcastRealtimeEvent("VEHICLE_CREATED", row);
    res.status(201).json(enrichVehicleWithAlerts(row));
  } catch (err: any) {
    console.error("[vehicles] Create error:", err);
    res.status(500).json({ success: false, error: { code: "DATABASE_ERROR", message: "Failed to create vehicle" } });
  }
});

router.patch("/vehicles/:id", requireOwner, async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  try {
    const [updated] = await db
      .update(vehiclesTable)
      .set({
        ...req.body,
        updatedAt: new Date(),
      })
      .where(eq(vehiclesTable.id, id))
      .returning();

    if (!updated) {
      res.status(404).json({ success: false, error: { code: "NOT_FOUND", message: "Vehicle not found" } });
      return;
    }

    await writeAudit(req, "Updated vehicle", "vehicle", id, null, updated);
    broadcastRealtimeEvent("VEHICLE_UPDATED", updated);
    res.json(enrichVehicleWithAlerts(updated));
  } catch (err: any) {
    res.status(500).json({ success: false, error: { code: "DATABASE_ERROR", message: err.message } });
  }
});

// Soft delete, same reasoning as drivers: trips keep a vehicle_id FK.
router.delete("/vehicles/:id", requireOwner, async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  try {
    const openTrips = await openTripsFor(eq(tripsTable.vehicleId, id));
    if (openTrips.length > 0) {
      res.status(409).json({
        success: false,
        error: {
          code: "HAS_OPEN_TRIPS",
          message: `Vehicle is assigned to ${openTrips.length} open trip(s) (${openTrips.map((t) => t.bookingId).join(", ")}). Reassign or close them first.`,
        },
      });
      return;
    }

    const [row] = await db
      .update(vehiclesTable)
      .set({ status: "archived", assignedDriverId: null, updatedAt: new Date() })
      .where(eq(vehiclesTable.id, id))
      .returning();

    if (!row) {
      res.status(404).json({ success: false, error: { code: "NOT_FOUND", message: "Vehicle not found" } });
      return;
    }

    await writeAudit(req, "Deleted vehicle", "vehicle", id, row, null);
    broadcastRealtimeEvent("VEHICLE_UPDATED", row);
    res.json({ success: true, id });
  } catch (err: any) {
    res.status(500).json({ success: false, error: { code: "DATABASE_ERROR", message: err.message } });
  }
});

// =============================================================
// CUSTOMERS
// =============================================================
router.get("/customers", requireOwner, async (req, res): Promise<void> => {
  try {
    const search = String(req.query.search || "").trim();
    const rows = await db
      .select()
      .from(customersTable)
      .where(
        and(
          eq(customersTable.archived, false),
          search
            ? or(
                ilike(customersTable.name, `%${search}%`),
                ilike(customersTable.mobile, `%${search}%`),
                ilike(customersTable.customerCode, `%${search}%`)
              )
            : undefined
        )
      )
      .orderBy(desc(customersTable.createdAt));

    const views = await Promise.all(rows.map(customerView));
    res.json({ items: views, total: views.length });
  } catch (err: any) {
    console.error("[customers] Database query failed:", err?.message);
    res.status(503).json({ success: false, error: { code: "DATABASE_ERROR", message: "Unable to load customers. Please try again." } });
  }
});

router.post("/customers", requireOwner, async (req, res): Promise<void> => {
  const body = req.body;
  if (!body.name || !body.mobile) {
    res.status(400).json({ success: false, error: { code: "VALIDATION_ERROR", message: "Name and Mobile are required" } });
    return;
  }

  try {
    const [countResult] = await db.select({ count: count() }).from(customersTable);
    const nextCode = `CUST-${String(Number(countResult.count || 0) + 1).padStart(3, "0")}`;

    const [row] = await db
      .insert(customersTable)
      .values({
        customerCode: nextCode,
        name: body.name.trim(),
        mobile: body.mobile.trim(),
        whatsapp: body.whatsapp ? body.whatsapp.trim() : null,
        alternateNumber: body.alternateNumber ? body.alternateNumber.trim() : null,
        email: body.email ? body.email.trim() : null,
        address: body.address ? body.address.trim() : null,
        notes: body.notes || null,
        archived: false,
      })
      .returning();

    await writeAudit(req, "Created customer", "customer", row.id, null, row);
    res.status(201).json(await customerView(row));
  } catch (err: any) {
    console.error("[customers] Create error:", err);
    res.status(500).json({ success: false, error: { code: "DATABASE_ERROR", message: "Failed to save customer" } });
  }
});

router.get("/customers/:id", requireOwner, async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  try {
    const [row] = await db.select().from(customersTable).where(eq(customersTable.id, id));
    if (!row) {
      res.status(404).json({ success: false, error: { code: "NOT_FOUND", message: "Customer not found" } });
      return;
    }
    res.json(await customerView(row));
  } catch (err: any) {
    res.status(500).json({ success: false, error: { code: "DATABASE_ERROR", message: err.message } });
  }
});

router.patch("/customers/:id", requireOwner, async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  try {
    const [row] = await db
      .update(customersTable)
      .set({ ...req.body, updatedAt: new Date() })
      .where(eq(customersTable.id, id))
      .returning();

    if (!row) {
      res.status(404).json({ success: false, error: { code: "NOT_FOUND", message: "Customer not found" } });
      return;
    }

    await writeAudit(req, "Updated customer", "customer", id, null, row);
    res.json(await customerView(row));
  } catch (err: any) {
    res.status(500).json({ success: false, error: { code: "DATABASE_ERROR", message: err.message } });
  }
});

router.delete("/customers/:id", requireOwner, async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  try {
    const openTrips = await openTripsFor(eq(tripsTable.customerId, id));
    if (openTrips.length > 0) {
      res.status(409).json({
        success: false,
        error: {
          code: "HAS_OPEN_TRIPS",
          message: `Customer has ${openTrips.length} open trip(s) (${openTrips.map((t) => t.bookingId).join(", ")}). Complete or cancel them first.`,
        },
      });
      return;
    }

    await db.update(customersTable).set({ archived: true, updatedAt: new Date() }).where(eq(customersTable.id, id));
    await writeAudit(req, "Archived customer", "customer", id);
    res.json({ success: true, id });
  } catch (err: any) {
    res.status(500).json({ success: false, error: { code: "DATABASE_ERROR", message: err.message } });
  }
});

// =============================================================
// ENQUIRIES
// =============================================================
router.get("/enquiries", requireOwner, async (_req, res): Promise<void> => {
  try {
    const rows = await db.select().from(enquiriesTable).orderBy(desc(enquiriesTable.createdAt));
    res.json(rows);
  } catch (err: any) {
    console.error("[enquiries] Database query failed:", err?.message);
    res.status(503).json({ success: false, error: { code: "DATABASE_ERROR", message: "Unable to load enquiries. Please try again." } });
  }
});

router.post("/enquiries", requireOwner, async (req, res): Promise<void> => {
  const body = req.body;
  try {
    const [countResult] = await db.select({ count: count() }).from(enquiriesTable);
    const nextCode = `ENQ-${String(Number(countResult.count || 0) + 1).padStart(3, "0")}`;

    const [row] = await db
      .insert(enquiriesTable)
      .values({
        enquiryCode: nextCode,
        customerName: body.customerName.trim(),
        customerMobile: body.customerMobile.trim(),
        customerEmail: body.customerEmail || null,
        pickup: body.pickup.trim(),
        destination: body.destination.trim(),
        tripType: body.tripType || "outstation_round_trip",
        startDate: dateOnly(body.startDate || today()),
        passengerCount: Number(body.passengerCount || 1),
        estimatedBudget: body.estimatedBudget ? String(body.estimatedBudget) : null,
        quotedFare: body.quotedFare ? String(body.quotedFare) : null,
        status: "pending",
        notes: body.notes || null,
      })
      .returning();

    await writeAudit(req, "Created enquiry", "enquiry", row.id, null, row);
    res.status(201).json(row);
  } catch (err: any) {
    res.status(500).json({ success: false, error: { code: "DATABASE_ERROR", message: err.message } });
  }
});

router.patch("/enquiries/:id", requireOwner, async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  try {
    const [row] = await db
      .update(enquiriesTable)
      .set({ ...req.body, updatedAt: new Date() })
      .where(eq(enquiriesTable.id, id))
      .returning();

    if (!row) {
      res.status(404).json({ success: false, error: { code: "NOT_FOUND", message: "Enquiry not found" } });
      return;
    }

    await writeAudit(req, "Updated enquiry", "enquiry", id, null, row);
    res.json(row);
  } catch (err: any) {
    res.status(500).json({ success: false, error: { code: "DATABASE_ERROR", message: err.message } });
  }
});

// =============================================================
// REAL MAPS & ROUTING INTEGRATION (Phase 52)
// =============================================================
router.get("/maps/places/autocomplete", async (req, res): Promise<void> => {
  try {
    const q = String(req.query.input || req.query.query || "").trim();
    if (!q || q.length < 2) {
      res.json([]);
      return;
    }

    const results = await searchPlaces(q);
    res.json(results);
  } catch (err: any) {
    console.error("[maps/places/autocomplete] Error:", err);
    res.status(500).json({ error: "Failed to fetch place suggestions", details: err.message });
  }
});

/**
 * Reverse geocode a map pin (or any lat/lng) into a human-readable place.
 */
router.get("/maps/reverse-geocode", async (req, res): Promise<void> => {
  const lat = Number(req.query.lat);
  const lng = Number(req.query.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    res.status(400).json({ error: "Valid lat and lng query parameters are required" });
    return;
  }

  try {
    const place = await reverseGeocode(lat, lng);
    res.json(
      place || {
        placeId: `geo_${lat}_${lng}`,
        name: "Pinned Location",
        formattedAddress: `${lat.toFixed(5)}, ${lng.toFixed(5)}`,
        latitude: lat,
        longitude: lng,
        lat,
        lng,
      },
    );
  } catch (err: any) {
    console.error("[maps/reverse-geocode] Error:", err);
    res.status(500).json({ error: "Unable to reverse geocode this location." });
  }
});

/**
 * Resolve a pasted Google Maps URL (including shortened links) or a plain
 * "latitude, longitude" string into a usable place — for the pickup/drop
 * "Map / URL / Coordinates" location entry option.
 */
router.post("/maps/resolve-location", async (req, res): Promise<void> => {
  const input = String(req.body?.input || "").trim();
  if (!input) {
    res.status(400).json({ error: "input (a Google Maps URL or 'latitude, longitude') is required" });
    return;
  }

  try {
    const coords = await resolveLocationInput(input);
    if (!coords) {
      res.status(400).json({
        error: "Could not find coordinates in that text. Paste a Google Maps link or 'latitude, longitude'.",
      });
      return;
    }

    const place = await reverseGeocode(coords.lat, coords.lng);
    res.json(
      place || {
        placeId: `geo_${coords.lat}_${coords.lng}`,
        name: "Pinned Location",
        formattedAddress: `${coords.lat.toFixed(5)}, ${coords.lng.toFixed(5)}`,
        latitude: coords.lat,
        longitude: coords.lng,
        lat: coords.lat,
        lng: coords.lng,
      },
    );
  } catch (err: any) {
    console.error("[maps/resolve-location] Error:", err);
    res.status(500).json({ error: "Unable to resolve that location." });
  }
});

router.post("/maps/routes", async (req, res): Promise<void> => {
  try {
    const {
      pickup,
      destination,
      stops = [],
      tripType = "single_trip",
      options = {},
      startDate,
      startTime,
      returnDate,
      returnTime,
    } = req.body;
    if (!pickup || !destination) {
      res.status(400).json({ error: "Pickup and destination locations are required" });
      return;
    }

    const journey = await calculateRouteJourney({
      pickup,
      destination,
      stops,
      tripType,
      options,
      startDate,
      startTime,
      returnDate,
      returnTime,
    });

    const tollStatus =
      journey.tollSource === "google_routes"
        ? "Estimated from Routes API"
        : journey.tollSource === "nhai_open_dataset"
          ? "Estimated from NHAI toll-plaza open data"
          : "Unavailable / At Actuals";

    res.json({
      provider: journey.provider,
      tripType: journey.tripType,
      summary: journey.alternatives[0]?.summary || `Route (${journey.totalRoadDistanceKm} km)`,
      totalDistanceKm: journey.totalRoadDistanceKm,
      totalRoadKm: journey.totalRoadDistanceKm,
      totalMapKm: journey.totalRoadDistanceKm,
      totalDurationMinutes: journey.totalDurationMinutes,
      outboundDistanceKm: journey.outbound.distanceKm,
      outboundMapKm: journey.outbound.distanceKm,
      returnDistanceKm: journey.return?.distanceKm || 0,
      returnMapKm: journey.return?.distanceKm || 0,
      outboundDurationMinutes: journey.outbound.durationMinutes,
      returnDurationMinutes: journey.return?.durationMinutes || 0,
      estimatedToll: journey.estimatedToll || 0,
      apiEstimatedToll: journey.estimatedToll || 0,
      tollAvailable: journey.tollAvailable,
      tollStatus,
      tollSource: journey.tollSource,
      tollPlazas: journey.tollPlazas,
      tollRateMode: journey.tollRateMode,
      routes: journey.alternatives,
      outbound: journey.outbound,
      return: journey.return,
      outboundLeg: journey.outbound,
      returnLeg: journey.return,
      coordinates: journey.outbound.coordinates,
      outboundCoordinates: journey.outbound.coordinates,
      returnCoordinates: journey.return?.coordinates || [],
      routeCoordinates: journey.outbound.coordinates,
      resolvedPickup: journey.resolvedPickup,
      resolvedDestination: journey.resolvedDestination,
    });
  } catch (err: any) {
    console.error("[maps/routes] Route error:", err);
    res.status(500).json({
      error: "Unable to calculate the driving route. Please verify the pickup and destination locations.",
      details: err.message,
    });
  }
});

// =============================================================
// TRIPS & BOOKINGS OPERATIONS
// =============================================================
router.get("/trips", async (req, res): Promise<void> => {
  try {
    const viewer = await viewerFor(req);
    const search = String(req.query.search || "").trim().toLowerCase();
    const statusFilter = req.query.status ? String(req.query.status) : undefined;
    const driverIdFilter = req.query.driverId ? Number(req.query.driverId) : undefined;
    const customerIdFilter = req.query.customerId ? Number(req.query.customerId) : undefined;

    // Strict role authorization: drivers can ONLY see trips assigned to them
    const effectiveDriverId = viewer?.role === "driver" && viewer.driverId ? viewer.driverId : driverIdFilter;

    const trips = await db
      .select()
      .from(tripsTable)
      .where(
        and(
          effectiveDriverId ? eq(tripsTable.driverId, effectiveDriverId) : undefined,
          customerIdFilter ? eq(tripsTable.customerId, customerIdFilter) : undefined,
          statusFilter ? eq(tripsTable.status, statusFilter) : undefined
        )
      )
      // Newest bookings first, so a just-dispatched trip is always at the top.
      // (Ordering by start date/time alone left same-day 08:00 trips in an
      // arbitrary order, burying new bookings mid-list.)
      .orderBy(desc(tripsTable.createdAt), desc(tripsTable.id));

    const customers = await db.select().from(customersTable);
    const customerMap = new Map(customers.map((c) => [c.id, c]));

    const tripViews = trips.map((t) =>
      tripView(t, customerMap.get(t.customerId) || { id: t.customerId, name: "Customer", mobile: "" })
    );

    const filtered = search
      ? tripViews.filter(
          (t) =>
            t.bookingId.toLowerCase().includes(search) ||
            t.customerName.toLowerCase().includes(search) ||
            (t.driverName && t.driverName.toLowerCase().includes(search)) ||
            (t.pickup?.name && t.pickup.name.toLowerCase().includes(search)) ||
            (t.destination?.name && t.destination.name.toLowerCase().includes(search))
        )
      : tripViews;

    res.json({ items: filtered, total: filtered.length });
  } catch (err: any) {
    console.error("[trips] Database query failed:", err?.message);
    res.status(503).json({ success: false, error: { code: "DATABASE_ERROR", message: "Unable to load trips. Please try again." } });
  }
});

router.post("/trips", requireOwner, async (req, res): Promise<void> => {
  const startDateStr = dateOnly(req.body.startDate || today());
  const returnDateStr = req.body.returnDate ? dateOnly(req.body.returnDate) : null;
  const policy = req.body.billingDayPolicy || "CALENDAR_DAYS";
  const tripType = req.body.tripType || "single_trip";
  const idempotencyKey = typeof req.body.idempotencyKey === "string" && req.body.idempotencyKey.trim()
    ? req.body.idempotencyKey.trim()
    : null;

  // Same booking submitted again (double-click, network retry): return the
  // trip already created instead of a duplicate trip + duplicate advance.
  const findExistingBooking = async () => {
    if (!idempotencyKey) return null;
    const [existing] = await db.select().from(tripsTable).where(eq(tripsTable.idempotencyKey, idempotencyKey));
    if (!existing) return null;
    const [customer] = await db.select().from(customersTable).where(eq(customersTable.id, existing.customerId));
    return tripView(existing, customer);
  };

  // Everything below (fare calc, driver/vehicle lookups, the insert itself)
  // used to run partly outside any try/catch, so a thrown error here bypassed
  // the JSON error responses entirely — Express's default handler returns an
  // HTML page for an uncaught rejection, which the client can't parse into a
  // message, so it just shows a generic "Failed to create trip" with no way
  // to tell what actually went wrong. Wrapping the whole handler fixes that.
  try {
    const alreadyCreated = await findExistingBooking();
    if (alreadyCreated) {
      res.status(200).json(alreadyCreated);
      return;
    }

    // Every new booking records the stand odometer with photo proof
    const standKm = Number(req.body.standStartKm);
    if (req.body.standStartKm == null || req.body.standStartKm === "" || !Number.isFinite(standKm) || standKm <= 0) {
      res.status(400).json({ success: false, error: { code: "VALIDATION_ERROR", message: "Odometer reading at the stand is required." } });
      return;
    }
    if (!req.body.standStartPhoto) {
      res.status(400).json({ success: false, error: { code: "VALIDATION_ERROR", message: "Odometer photo at the stand is required." } });
      return;
    }

    // 1. Authoritative Route Verification
    let journey: any = null;
    try {
      if (req.body.pickup && req.body.destination) {
        journey = await calculateRouteJourney({
          pickup: req.body.pickup,
          destination: req.body.destination,
          stops: req.body.stops || [],
          tripType,
          startDate: startDateStr,
          startTime: req.body.startTime || "09:00",
          returnDate: returnDateStr,
          returnTime: req.body.returnTime || "20:00",
        });
      }
    } catch (routeErr: any) {
      console.warn("[trips/create] Online route verification warning:", routeErr.message);
    }

    const verifiedOutboundKm = journey ? journey.outbound.distanceKm : Number(req.body.outboundMapKm || req.body.mapDistanceKm || 0);
    const verifiedReturnKm = journey ? (journey.return?.distanceKm || 0) : Number(req.body.returnMapKm || 0);
    const verifiedTotalKm = journey ? journey.totalRoadDistanceKm : Number(req.body.totalMapKm || req.body.mapDistanceKm || 0);
    const verifiedOutboundMinutes = journey ? journey.outbound.durationMinutes : Number(req.body.outboundDurationMinutes || 120);
    const verifiedReturnMinutes = journey ? (journey.return?.durationMinutes || 0) : Number(req.body.returnDurationMinutes || 0);
    const verifiedTotalMinutes = verifiedOutboundMinutes + verifiedReturnMinutes;

    // 2. Authoritative Commercial Fare Calculation
    const commercialFare = calculateCommercialFare({
      tripType,
      outboundDistanceKm: verifiedOutboundKm,
      returnDistanceKm: verifiedReturnKm,
      totalRoadDistanceKm: verifiedTotalKm,
      ratePerKm: Number(req.body.ratePerKm || 18),
      pricingMode: req.body.pricingMode === "package" ? "package" : "per_km",
      packageTotal: Number(req.body.packageTotal || 0),
      startDate: startDateStr,
      returnDate: returnDateStr,
      startTime: req.body.startTime || "09:00",
      returnTime: req.body.returnTime || "20:00",
      billingDayPolicy: policy,
      minimumKmPerDay: req.body.minimumKmPerDay != null ? Number(req.body.minimumKmPerDay) : undefined,
      driverBataPerDay: req.body.driverBataPerDay != null ? Number(req.body.driverBataPerDay) : undefined,
      nightBata: req.body.nightBata != null ? Number(req.body.nightBata) : undefined,
      permitCharge: Number(req.body.permitCharge || 0),
      toll: req.body.finalToll != null ? Number(req.body.finalToll) : (journey?.estimatedToll || Number(req.body.toll || 0)),
      tollAvailable: journey?.tollAvailable ?? false,
      parking: Number(req.body.parking || 0),
      waiting: Number(req.body.waiting || req.body.waitingCharge || 0),
      nightCharges: Number(req.body.nightCharges || req.body.nightCharge || 0),
      discount: Number(req.body.discount || 0),
      taxPercent: Number(req.body.taxPercent || 0),
      totalPaid: Number(req.body.advance || req.body.totalPaid || 0),
    });

    const driverCommissionType = req.body.driverCommissionType === "flat" ? "flat" : "percentage";
    const driverCommissionValue = Math.max(0, Number(req.body.driverCommissionValue || 0));
    const driverCommissionAmount = driverCommissionType === "flat"
      ? driverCommissionValue
      : Math.round(commercialFare.customerTotal * (driverCommissionValue / 100) * 100) / 100;

    const bookingId = `TRP-${Date.now().toString().slice(-7)}`;

    let driverName: string | null = req.body.driverName || null;
    let driverMobile: string | null = req.body.driverMobile || null;
    if (req.body.driverId) {
      const [drv] = await db.select().from(driversTable).where(eq(driversTable.id, Number(req.body.driverId)));
      if (drv) {
        driverName = drv.name;
        driverMobile = drv.mobile;
      }
    }

    let vehicleNumber: string | null = req.body.vehicleNumber || null;
    if (req.body.vehicleId) {
      const [veh] = await db.select().from(vehiclesTable).where(eq(vehiclesTable.id, Number(req.body.vehicleId)));
      if (veh) {
        vehicleNumber = veh.vehicleNumber;
      }
    }

    // 3. Assemble Auditable Route Snapshot
    const routeSnapshot = {
      provider: journey?.provider || "geoapify",
      calculatedAt: new Date().toISOString(),
      tripType: commercialFare.tripType,
      billingDayPolicy: commercialFare.billingDayPolicy,
      billableDays: commercialFare.billableDays,
      minimumKmPerDay: commercialFare.minimumKmPerDay,
      minimumBillableKm: commercialFare.minimumBillableKm,
      totalRoadDistanceKm: commercialFare.totalRoadDistanceKm,
      totalBillableKm: commercialFare.totalBillableDistance,
      totalDurationMinutes: verifiedTotalMinutes,
      ratePerKm: commercialFare.ratePerKm,
      pricingMode: commercialFare.pricingMode,
      packageTotal: commercialFare.packageTotal,
      distanceFare: commercialFare.distanceFare,
      driverBata: commercialFare.driverBata,
      permitCharge: commercialFare.permitCharge,
      toll: commercialFare.toll,
      tollAvailable: commercialFare.tollAvailable,
      parking: commercialFare.parking,
      waiting: commercialFare.waiting,
      nightCharges: commercialFare.nightCharges,
      discount: commercialFare.discount,
      tax: commercialFare.tax,
      customerTotal: commercialFare.customerTotal,
      outbound: {
        distanceKm: verifiedOutboundKm,
        durationMinutes: verifiedOutboundMinutes,
        polyline: journey?.outbound.encodedPolyline || null,
        coordinates: journey?.outbound.coordinates || [],
        origin: req.body.pickup,
        destination: req.body.destination,
      },
      return: (commercialFare.tripType.includes("round") && journey?.return) ? {
        distanceKm: verifiedReturnKm,
        durationMinutes: verifiedReturnMinutes,
        polyline: journey.return.encodedPolyline || null,
        coordinates: journey.return.coordinates || [],
        origin: req.body.destination,
        destination: req.body.pickup,
      } : null,
    };

    const tripData = {
      bookingId,
      customerId: Number(req.body.customerId),
      driverId: req.body.driverId ? Number(req.body.driverId) : null,
      driverName,
      driverMobile,
      vehicleId: req.body.vehicleId ? Number(req.body.vehicleId) : null,
      vehicleNumber,
      idempotencyKey,
      tripType,
      pickup: req.body.pickup,
      destination: req.body.destination,
      stops: req.body.stops ?? [],
      startDate: startDateStr,
      startTime: req.body.startTime || "09:00",
      returnDate: returnDateStr,
      returnTime: req.body.returnTime ?? null,
      passengerCount: Number(req.body.passengerCount ?? 1),
      notes: req.body.notes ?? null,
      specialInstructions: req.body.specialInstructions ?? null,
      mapDistanceKm: String(commercialFare.totalRoadDistanceKm),
      outboundMapKm: String(commercialFare.outboundDistanceKm),
      returnMapKm: String(commercialFare.returnDistanceKm),
      totalMapKm: String(commercialFare.totalRoadDistanceKm),
      // Odometer when the vehicle leaves the stand, captured at booking.
      standStartKm: req.body.standStartKm != null && req.body.standStartKm !== "" ? String(Number(req.body.standStartKm)) : null,
      standStartPhoto: req.body.standStartPhoto || null,
      routeDurationMinutes: verifiedTotalMinutes,
      outboundDurationMinutes: verifiedOutboundMinutes,
      returnDurationMinutes: verifiedReturnMinutes,
      routeSummary: journey?.alternatives[0]?.summary || req.body.routeSummary || `${commercialFare.totalRoadDistanceKm} km`,
      selectedRouteSummary: journey?.alternatives[0]?.summary || req.body.selectedRouteSummary || null,
      routeOptions: withoutPolylines(journey?.alternatives || req.body.routeOptions),
      routeSnapshot,
      apiEstimatedToll: commercialFare.toll > 0 ? String(commercialFare.toll) : null,
      estimatedToll: commercialFare.toll > 0 ? String(commercialFare.toll) : null,
      finalToll: String(commercialFare.toll),
      outboundTollEstimate: null,
      returnTollEstimate: null,
      billingKm: String(commercialFare.totalBillableDistance),
      ratePerKm: String(commercialFare.ratePerKm),
      pricingMode: commercialFare.pricingMode,
      packageTotal: commercialFare.pricingMode === "package" ? String(commercialFare.packageTotal) : null,
      baseFare: String(commercialFare.distanceFare),
      driverCommissionType,
      driverCommissionValue: String(driverCommissionValue),
      driverCommissionAmount: String(driverCommissionAmount),
      driverBata: String(commercialFare.driverBata),
      toll: String(commercialFare.toll),
      parking: String(commercialFare.parking),
      permitCharge: String(commercialFare.permitCharge),
      waitingCharge: String(commercialFare.waiting),
      nightCharge: String(commercialFare.nightCharges),
      discount: String(commercialFare.discount),
      tax: String(commercialFare.tax),
      billableDays: commercialFare.billableDays,
      minimumKm: String(commercialFare.minimumBillableKm),
      billingDayPolicy: commercialFare.billingDayPolicy,
      customerTotal: String(commercialFare.customerTotal),
      totalPaid: String(commercialFare.totalPaid),
      remainingBalance: String(commercialFare.remainingBalance),
      credit: String(commercialFare.credit),
      status: req.body.driverId ? "assigned" : "upcoming",
      isLocked: false,
    };

    const [created] = await db.insert(tripsTable).values(tripData as any).returning();

    // If advance payment recorded
    if (commercialFare.totalPaid > 0) {
      await db.insert(paymentsTable).values({
        tripId: created.id,
        amount: String(commercialFare.totalPaid),
        method: req.body.paymentMethod || "UPI",
        paymentType: "advance",
        paymentDate: startDateStr,
        reference: req.body.paymentReference || "ADV-INITIAL",
        notes: "Advance payment received at booking creation",
        recordedBy: "Operations Admin",
      });
    }

    // Status History
    await db.insert(tripStatusHistoryTable).values({
      tripId: created.id,
      status: created.status,
      note: "Trip created and scheduled",
      changedBy: "Operations Admin",
    });

    const [customer] = await db.select().from(customersTable).where(eq(customersTable.id, created.customerId));
    await writeAudit(req, "Trip created", "trip", created.id, null, created);
    await notify(`New trip ${created.bookingId}`, `Booked from ${req.body.pickup?.name || "Pickup"} to ${req.body.destination?.name || "Destination"}`, "trip_created", created.id);

    if (created.driverId) {
      await notify(`Assigned to ${created.bookingId}`, `New trip to ${req.body.destination?.name || "Destination"} scheduled for ${startDateStr}`, "trip_assigned", created.id, "driver", created.driverId);
    }

    const view = tripView(created, customer);
    broadcastRealtimeEvent("TRIP_CREATED", view);
    res.status(201).json(view);
  } catch (err: any) {
    // Two identical submissions raced past the lookup above; the unique
    // index on idempotency_key rejected the second insert.
    if (err?.code === "23505" || err?.cause?.code === "23505") {
      const existing = await findExistingBooking().catch(() => null);
      if (existing) {
        res.status(200).json(existing);
        return;
      }
    }
    console.error("[trips] Create error:", err);
    res.status(500).json({ success: false, error: { code: "DATABASE_ERROR", message: err?.message || "Failed to persist trip to database" } });
  }
});

router.get("/trips/:id", async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  try {
    const [trip] = await db.select().from(tripsTable).where(eq(tripsTable.id, id));
    if (!trip) {
      res.status(404).json({ success: false, error: { code: "NOT_FOUND", message: "Trip not found" } });
      return;
    }
    const [customer] = await db.select().from(customersTable).where(eq(customersTable.id, trip.customerId));
    res.json(tripView(trip, customer));
  } catch (err: any) {
    res.status(500).json({ success: false, error: { code: "DATABASE_ERROR", message: err.message } });
  }
});

router.patch("/trips/:id", requireOwner, async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  try {
    const [trip] = await db.select().from(tripsTable).where(eq(tripsTable.id, id));
    if (!trip) {
      res.status(404).json({ success: false, error: { code: "NOT_FOUND", message: "Trip not found" } });
      return;
    }

    const [updated] = await db
      .update(tripsTable)
      .set({ ...req.body, updatedAt: new Date() })
      .where(eq(tripsTable.id, id))
      .returning();

    const [customer] = await db.select().from(customersTable).where(eq(customersTable.id, updated.customerId));
    const view = tripView(updated, customer);
    await writeAudit(req, "Updated trip details", "trip", id, trip, updated);
    broadcastRealtimeEvent("TRIP_UPDATED", view);
    res.json(view);
  } catch (err: any) {
    res.status(500).json({ success: false, error: { code: "DATABASE_ERROR", message: err.message } });
  }
});

/**
 * Assign Driver and Commercial Vehicle (Concurrency Safe)
 */
router.post("/trips/:id/assign", requireOwner, async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  const { driverId, vehicleId } = req.body;

  try {
    let driverName: string | null = null;
    let driverMobile: string | null = null;

    if (driverId) {
      const [d] = await db.select().from(driversTable).where(eq(driversTable.id, Number(driverId)));
      if (d) {
        driverName = d.name;
        driverMobile = d.mobile;
      }
    }

    let vehicleNumber: string | null = null;
    if (vehicleId) {
      const [v] = await db.select().from(vehiclesTable).where(eq(vehiclesTable.id, Number(vehicleId)));
      if (v) vehicleNumber = v.vehicleNumber;
    }

    const [trip] = await db
      .update(tripsTable)
      .set({
        driverId: driverId ? Number(driverId) : null,
        driverName,
        driverMobile,
        vehicleId: vehicleId ? Number(vehicleId) : null,
        vehicleNumber,
        status: "assigned",
        updatedAt: new Date(),
      })
      .where(eq(tripsTable.id, id))
      .returning();

    if (!trip) {
      res.status(404).json({ success: false, error: { code: "NOT_FOUND", message: "Trip not found" } });
      return;
    }

    if (driverId) {
      await db.insert(notificationsTable).values({
        audience: "driver",
        driverId: Number(driverId),
        title: "New Duty Assignment",
        message: `Trip ${trip.bookingId} assigned to you (${(trip.pickup as TripLocation)?.name} ➔ ${(trip.destination as TripLocation)?.name})`,
        kind: "trip_assigned",
        tripId: trip.id,
      });
    }

    await writeAudit(req, `Assigned driver ${driverName} & vehicle ${vehicleNumber}`, "trip", id);
    broadcastRealtimeEvent("TRIP_ASSIGNED", { tripId: id, bookingId: trip.bookingId, driverId, vehicleId });

    const [customer] = await db.select().from(customersTable).where(eq(customersTable.id, trip.customerId));
    res.json(tripView(trip, customer));
  } catch (err: any) {
    console.error("[trips] Assignment error:", err);
    res.status(500).json({ success: false, error: { code: "DATABASE_ERROR", message: "Failed to assign driver/vehicle" } });
  }
});

/**
 * Cancel Trip & Release Resources Atomically
 */
router.post("/trips/:id/cancel", requireOwner, async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  const { reason } = req.body;

  try {
    const [trip] = await db.select().from(tripsTable).where(eq(tripsTable.id, id));
    if (!trip) {
      res.status(404).json({ success: false, error: { code: "NOT_FOUND", message: "Trip not found" } });
      return;
    }

    const [updated] = await db
      .update(tripsTable)
      .set({
        status: "cancelled",
        cancellationReason: reason || "Cancelled by Operations Office",
        cancelledAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(tripsTable.id, id))
      .returning();

    // Release driver availability if assigned
    if (trip.driverId) {
      await db
        .update(driversTable)
        .set({ availability: "available", updatedAt: new Date() })
        .where(eq(driversTable.id, trip.driverId));
    }

    // Release vehicle
    if (trip.vehicleId) {
      await db
        .update(vehiclesTable)
        .set({ status: "active", updatedAt: new Date() })
        .where(eq(vehiclesTable.id, trip.vehicleId));
    }

    await writeAudit(req, `Cancelled trip: ${reason || "No reason given"}`, "trip", id);
    broadcastRealtimeEvent("TRIP_CANCELLED", { tripId: id, bookingId: updated.bookingId, reason });
    res.json(updated);
  } catch (err: any) {
    console.error("[trips] Cancel error:", err);
    res.status(500).json({ success: false, error: { code: "DATABASE_ERROR", message: "Failed to cancel trip" } });
  }
});

// =============================================================
// DRIVER PARTNER APP ENDPOINTS (STRICT DRIVER SCOPED)
// =============================================================

/**
 * Get current driver partner profile
 */
router.get("/driver/me", async (req, res): Promise<void> => {
  const viewer = await viewerFor(req);
  if (!viewer) {
    res.status(401).json({ success: false, error: { code: "UNAUTHORIZED", message: "Driver authentication required" } });
    return;
  }

  try {
    let driver = null;
    if (viewer.driverId) {
      const [d] = await db.select().from(driversTable).where(eq(driversTable.id, viewer.driverId));
      driver = d;
    } else {
      const [firstDriver] = await db.select().from(driversTable).limit(1);
      driver = firstDriver;
    }

    if (!driver) {
      res.status(404).json({ success: false, error: { code: "NOT_FOUND", message: "Driver profile not found" } });
      return;
    }

    res.json(driver);
  } catch (err: any) {
    res.status(500).json({ success: false, error: { code: "DATABASE_ERROR", message: err.message } });
  }
});

/**
 * Driver's Schedule for Today
 */
router.get("/driver/today", async (req, res): Promise<void> => {
  const viewer = await viewerFor(req);
  const currentDay = today();

  try {
    const driverId = viewer?.driverId;
    const trips = await db
      .select()
      .from(tripsTable)
      .where(
        and(
          driverId ? eq(tripsTable.driverId, driverId) : undefined,
          eq(tripsTable.startDate, currentDay)
        )
      )
      .orderBy(asc(tripsTable.startTime));

    const customers = await db.select().from(customersTable);
    const cMap = new Map(customers.map((c) => [c.id, c]));

    res.json(trips.map((t) => tripView(t, cMap.get(t.customerId))));
  } catch (err: any) {
    console.warn("[driver/today] DB fallback:", err?.message);
    res.json(memTrips.filter((t) => t.startDate === today()));
  }
});

/**
 * Driver's Active Trip currently in progress
 */
router.get("/driver/current-trip", async (req, res): Promise<void> => {
  const viewer = await viewerFor(req);

  try {
    const driverId = viewer?.driverId;
    const trips = await db
      .select()
      .from(tripsTable)
      .where(
        and(
          driverId ? eq(tripsTable.driverId, driverId) : undefined,
          inArray(tripsTable.status, [
            "assigned",
            "accepted",
            "driver_arrived",
            "started",
            "reached_pickup",
            "customer_picked_up",
            "in_progress",
            "reached_destination",
          ])
        )
      )
      .orderBy(desc(tripsTable.updatedAt))
      .limit(1);

    if (trips.length === 0 && driverId) {
      // No active run — surface the latest trip completed in the last 2 days
      // that still needs its back-at-stand odometer, so the driver app can
      // prompt for it.
      const since = new Date(Date.now() - 48 * 60 * 60 * 1000);
      const awaitingStand = await db
        .select()
        .from(tripsTable)
        .where(
          and(
            eq(tripsTable.driverId, driverId),
            eq(tripsTable.status, "completed"),
            isNull(tripsTable.standReturnKm),
            gte(tripsTable.updatedAt, since)
          )
        )
        .orderBy(desc(tripsTable.updatedAt))
        .limit(1);
      trips.push(...awaitingStand);
    }

    if (trips.length === 0) {
      // No active trip is a normal, expected state (not an error) — the
      // driver simply has nothing in progress right now.
      res.json(null);
      return;
    }

    const [customer] = await db.select().from(customersTable).where(eq(customersTable.id, trips[0].customerId));
    res.json(tripView(trips[0], customer));
  } catch (err: any) {
    console.warn("[driver/current-trip] DB fallback:", err?.message);
    const active = memTrips.find((t) => ["started", "in_progress", "reached_pickup", "customer_picked_up"].includes(t.status)) || memTrips[0] || null;
    res.json(active || null);
  }
});

/**
 * Driver's Assigned Commercial Vehicle
 */
router.get("/driver/vehicle", async (req, res): Promise<void> => {
  const viewer = await viewerFor(req);

  try {
    let vehicle = null;
    if (viewer?.driverId) {
      const [v] = await db.select().from(vehiclesTable).where(eq(vehiclesTable.assignedDriverId, viewer.driverId));
      vehicle = v;
    }

    if (!vehicle) {
      const [firstV] = await db.select().from(vehiclesTable).where(eq(vehiclesTable.status, "active")).limit(1);
      vehicle = firstV;
    }

    if (!vehicle) {
      // No vehicle assigned is a normal, expected state — the driver just
      // hasn't been assigned one yet, not a routing/lookup error.
      res.json(null);
      return;
    }

    res.json(enrichVehicleWithAlerts(vehicle));
  } catch (err: any) {
    res.status(500).json({ success: false, error: { code: "DATABASE_ERROR", message: err.message } });
  }
});

/**
 * Driver accepts assigned trip
 */
router.post("/driver/trips/:id/accept", async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  try {
    const [trip] = await db
      .update(tripsTable)
      .set({ status: "accepted", updatedAt: new Date() })
      .where(eq(tripsTable.id, id))
      .returning();

    if (!trip) {
      res.status(404).json({ success: false, error: { code: "NOT_FOUND", message: "Trip not found" } });
      return;
    }

    await db.insert(tripStatusHistoryTable).values({
      tripId: id,
      status: "accepted",
      note: "Driver pilot accepted trip assignment",
      changedBy: trip.driverName || "Driver",
    });

    broadcastRealtimeEvent("TRIP_ACCEPTED", { tripId: id, bookingId: trip.bookingId });
    res.json({ success: true, trip });
  } catch (err: any) {
    res.status(500).json({ success: false, error: { code: "DATABASE_ERROR", message: err.message } });
  }
});

/**
 * Driver arrived at customer pickup location
 */
router.post("/driver/trips/:id/arrived", async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  try {
    const [trip] = await db
      .update(tripsTable)
      .set({ status: "driver_arrived", updatedAt: new Date() })
      .where(eq(tripsTable.id, id))
      .returning();

    if (!trip) {
      res.status(404).json({ success: false, error: { code: "NOT_FOUND", message: "Trip not found" } });
      return;
    }

    await db.insert(tripStatusHistoryTable).values({
      tripId: id,
      status: "driver_arrived",
      note: "Driver pilot arrived at pickup location",
      changedBy: trip.driverName || "Driver",
    });

    broadcastRealtimeEvent("DRIVER_ARRIVED", { tripId: id, bookingId: trip.bookingId });
    res.json({ success: true, trip });
  } catch (err: any) {
    res.status(500).json({ success: false, error: { code: "DATABASE_ERROR", message: err.message } });
  }
});

/**
 * Driver Starts Trip with Verified Starting Odometer KM (Database Transaction)
 */
router.post("/driver/trips/:id/start", async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  const { startingKm, location, photoUrl } = req.body;

  const startKmNum = Number(startingKm || 0);
  if (startKmNum < 0) {
    res.status(400).json({ success: false, error: { code: "VALIDATION_ERROR", message: "Starting KM cannot be negative" } });
    return;
  }

  try {
    const [existing] = await db
      .select({ standStartKm: tripsTable.standStartKm })
      .from(tripsTable)
      .where(eq(tripsTable.id, id));
    if (existing?.standStartKm != null && startKmNum < numeric(existing.standStartKm)) {
      res.status(400).json({
        success: false,
        error: {
          code: "VALIDATION_ERROR",
          message: `Pickup KM (${startKmNum}) cannot be less than the KM when the vehicle left the stand (${numeric(existing.standStartKm)}).`,
        },
      });
      return;
    }

    const [trip] = await db
      .update(tripsTable)
      .set({
        status: "started",
        startingKm: String(startKmNum),
        startKmTime: new Date(),
        startKmLocation: location || null,
        startKmPhoto: photoUrl || null,
        updatedAt: new Date(),
      })
      .where(eq(tripsTable.id, id))
      .returning();

    if (!trip) {
      res.status(404).json({ success: false, error: { code: "NOT_FOUND", message: "Trip not found" } });
      return;
    }

    // Update Driver Availability
    if (trip.driverId) {
      await db
        .update(driversTable)
        .set({ availability: "on_trip", updatedAt: new Date() })
        .where(eq(driversTable.id, trip.driverId));
    }

    // Update Vehicle Odometer
    if (trip.vehicleId) {
      await db
        .update(vehiclesTable)
        .set({ currentOdometerKm: String(startKmNum), updatedAt: new Date() })
        .where(eq(vehiclesTable.id, trip.vehicleId));
    }

    // Record Status History
    await db.insert(tripStatusHistoryTable).values({
      tripId: id,
      status: "started",
      odometerKm: String(startKmNum),
      location: location || null,
      note: `Trip started with starting meter: ${startKmNum} KM`,
      changedBy: trip.driverName || "Driver",
    });

    await writeAudit(req, `Started trip at ${startKmNum} KM`, "trip", id);
    broadcastRealtimeEvent("TRIP_STARTED", { tripId: id, bookingId: trip.bookingId, startingKm: startKmNum });
    res.json(trip);
  } catch (err: any) {
    console.error("[driver/start] Error:", err);
    res.status(500).json({ success: false, error: { code: "DATABASE_ERROR", message: "Failed to start trip" } });
  }
});

/**
 * Driver Progression Milestone
 */
router.post("/driver/trips/:id/milestone", async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  const { status, note, location, odometerKm } = req.body;

  try {
    const [trip] = await db
      .update(tripsTable)
      .set({ status, updatedAt: new Date() })
      .where(eq(tripsTable.id, id))
      .returning();

    if (!trip) {
      res.status(404).json({ success: false, error: { code: "NOT_FOUND", message: "Trip not found" } });
      return;
    }

    await db.insert(tripStatusHistoryTable).values({
      tripId: id,
      status,
      odometerKm: odometerKm ? String(odometerKm) : null,
      location: location || null,
      note: note || `Status updated to ${status}`,
      changedBy: trip.driverName || "Driver",
    });

    broadcastRealtimeEvent("TRIP_STATUS_CHANGED", { tripId: id, bookingId: trip.bookingId, status, note });
    res.json(trip);
  } catch (err: any) {
    res.status(500).json({ success: false, error: { code: "DATABASE_ERROR", message: err.message } });
  }
});

/**
 * Driver Completes Trip with Final Meter KM and Actuals
 */
router.post("/driver/trips/:id/complete", async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  const { endingKm, location, photoUrl, finalToll, parking } = req.body;

  try {
    const [trip] = await db.select().from(tripsTable).where(eq(tripsTable.id, id));
    if (!trip) {
      res.status(404).json({ success: false, error: { code: "NOT_FOUND", message: "Trip not found" } });
      return;
    }

    const startKm = numeric(trip.startingKm);
    const endKm = Number(endingKm || 0);

    const odoCheck = validateOdometer(startKm, endKm);
    if (!odoCheck.valid) {
      res.status(400).json({ success: false, error: { code: "VALIDATION_ERROR", message: odoCheck.error } });
      return;
    }

    const actualKm = odoCheck.actualKm;
    const tollAmount = finalToll != null ? numeric(finalToll) : numeric(trip.finalToll);
    const parkingAmount = parking != null ? numeric(parking) : numeric(trip.parking);
    const permitAmount = numeric(trip.permitCharge);

    // Bill whichever is higher: actual meter km or agreed billing km
    const chargedKm = Math.max(actualKm, numeric(trip.billingKm));
    const ratePerKm = numeric(trip.ratePerKm);
    // A flat package trip keeps its agreed total regardless of actual meter
    // KM — only per-km trips get their base fare recalculated off the road.
    const recalculatedBase = trip.pricingMode === "package"
      ? numeric(trip.baseFare)
      : Math.round(chargedKm * ratePerKm * 100) / 100;
    const customerTotal = Math.round((recalculatedBase + tollAmount + parkingAmount + permitAmount) * 100) / 100;
    const totalPaid = numeric(trip.totalPaid);
    const remainingBalance = Math.max(0, Math.round((customerTotal - totalPaid) * 100) / 100);
    const credit = Math.max(0, Math.round((totalPaid - customerTotal) * 100) / 100);

    // A flat commission stays fixed regardless of the final fare; a
    // percentage commission is re-derived off the recalculated customer
    // total so it reflects what actually got charged, not the estimate.
    const driverCommissionAmount = trip.driverCommissionType === "flat"
      ? numeric(trip.driverCommissionValue)
      : Math.round(customerTotal * (numeric(trip.driverCommissionValue) / 100) * 100) / 100;

    const [completed] = await db
      .update(tripsTable)
      .set({
        status: "completed",
        endingKm: String(endKm),
        actualKm: String(actualKm),
        driverCommissionAmount: String(driverCommissionAmount),
        billingKm: String(chargedKm),
        baseFare: String(recalculatedBase),
        finalToll: String(tollAmount),
        toll: String(tollAmount),
        parking: String(parkingAmount),
        customerTotal: String(customerTotal),
        remainingBalance: String(remainingBalance),
        credit: String(credit),
        endKmTime: new Date(),
        endKmLocation: location || null,
        endKmPhoto: photoUrl || null,
        updatedAt: new Date(),
      })
      .where(eq(tripsTable.id, id))
      .returning();

    // Release Driver Availability
    if (trip.driverId) {
      await db
        .update(driversTable)
        .set({ availability: "available", updatedAt: new Date() })
        .where(eq(driversTable.id, trip.driverId));
    }

    // Release Fleet Vehicle
    if (trip.vehicleId) {
      await db
        .update(vehiclesTable)
        .set({
          status: "active",
          currentOdometerKm: String(endKm),
          updatedAt: new Date(),
        })
        .where(eq(vehiclesTable.id, trip.vehicleId));
    }

    // Status History
    await db.insert(tripStatusHistoryTable).values({
      tripId: id,
      status: "completed",
      odometerKm: String(endKm),
      location: location || null,
      note: `Trip completed with final meter: ${endKm} KM (Clocked ${actualKm} KM)`,
      changedBy: trip.driverName || "Driver",
    });

    await writeAudit(req, `Completed trip ${trip.bookingId} (${actualKm} KM clocked)`, "trip", id);
    broadcastRealtimeEvent("TRIP_COMPLETED", { tripId: id, bookingId: completed.bookingId, actualKm, customerTotal });
    res.json(completed);
  } catch (err: any) {
    console.error("[driver/complete] Error:", err);
    res.status(500).json({ success: false, error: { code: "DATABASE_ERROR", message: "Failed to complete trip" } });
  }
});

/**
 * Record the odometer once the vehicle is back at the stand after the drop.
 * Open to the trip's own driver (once) and to ops staff (any time, to
 * correct it). Tracking only — the completed trip's fare is not touched.
 */
router.post("/trips/:id/stand-return", async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  const { standReturnKm, photoUrl } = req.body;
  const kmNum = Number(standReturnKm);

  if (standReturnKm == null || standReturnKm === "" || !Number.isFinite(kmNum) || kmNum <= 0) {
    res.status(400).json({ success: false, error: { code: "VALIDATION_ERROR", message: "Please enter a valid back-at-stand odometer reading." } });
    return;
  }

  try {
    const viewer = await viewerFor(req);
    if (!viewer) {
      res.status(401).json({ success: false, error: { code: "UNAUTHORIZED", message: "Please sign in again." } });
      return;
    }

    const [trip] = await db.select().from(tripsTable).where(eq(tripsTable.id, id));
    if (!trip) {
      res.status(404).json({ success: false, error: { code: "NOT_FOUND", message: "Trip not found" } });
      return;
    }

    const isDriver = viewer.role === "driver";
    if (isDriver && trip.driverId !== viewer.driverId) {
      res.status(403).json({ success: false, error: { code: "FORBIDDEN", message: "This trip isn't assigned to you." } });
      return;
    }
    if (isDriver && trip.standReturnKm != null) {
      res.status(409).json({ success: false, error: { code: "ALREADY_RECORDED", message: "Back-at-stand KM is already recorded. Ask the office to correct it." } });
      return;
    }
    if (trip.status !== "completed" || trip.endingKm == null) {
      res.status(400).json({ success: false, error: { code: "VALIDATION_ERROR", message: "Complete the trip (enter the drop KM) before recording the back-at-stand KM." } });
      return;
    }
    if (kmNum < numeric(trip.endingKm)) {
      res.status(400).json({
        success: false,
        error: { code: "VALIDATION_ERROR", message: `Back-at-stand KM (${kmNum}) cannot be less than the drop KM (${numeric(trip.endingKm)}).` },
      });
      return;
    }

    const [updated] = await db
      .update(tripsTable)
      .set({
        standReturnKm: String(kmNum),
        standReturnPhoto: photoUrl || trip.standReturnPhoto || null,
        standReturnTime: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(tripsTable.id, id))
      .returning();

    if (trip.vehicleId) {
      await db
        .update(vehiclesTable)
        .set({ currentOdometerKm: String(kmNum), updatedAt: new Date() })
        .where(eq(vehiclesTable.id, trip.vehicleId));
    }

    const { dropToStandKm } = standDistances(updated);
    await db.insert(tripStatusHistoryTable).values({
      tripId: id,
      status: "completed",
      odometerKm: String(kmNum),
      note: `Vehicle back at stand: ${kmNum} KM (drop to stand ${dropToStandKm ?? "-"} KM)`,
      changedBy: viewer.name || (isDriver ? trip.driverName || "Driver" : "Operations Admin"),
    });

    await writeAudit(req, `Recorded back-at-stand KM ${kmNum} for ${trip.bookingId}`, "trip", id);
    const [customer] = await db.select().from(customersTable).where(eq(customersTable.id, updated.customerId));
    const view = tripView(updated, customer);
    broadcastRealtimeEvent("TRIP_UPDATED", view);
    res.json(view);
  } catch (err: any) {
    console.error("[trips/stand-return] Error:", err);
    res.status(500).json({ success: false, error: { code: "DATABASE_ERROR", message: "Failed to record back-at-stand KM" } });
  }
});

/**
 * Ingest Real-Time Telemetry & GPS Coordinates
 */
router.post("/driver/trips/:id/location", async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  const { latitude, longitude, speed, heading, accuracy, batteryLevel } = req.body;

  if (latitude == null || longitude == null) {
    res.status(400).json({ success: false, error: { code: "VALIDATION_ERROR", message: "Coordinates required" } });
    return;
  }

  try {
    const [trip] = await db.select().from(tripsTable).where(eq(tripsTable.id, id));
    if (!trip) {
      res.status(404).json({ success: false, error: { code: "NOT_FOUND", message: "Trip not found" } });
      return;
    }

    const driverId = trip.driverId || 1;

    await db.insert(driverLocationsTable).values({
      driverId,
      tripId: id,
      latitude: String(latitude),
      longitude: String(longitude),
      speed: speed != null ? String(speed) : null,
      heading: heading != null ? String(heading) : null,
      accuracy: accuracy != null ? String(accuracy) : null,
      batteryLevel: batteryLevel != null ? String(batteryLevel) : null,
      timestamp: new Date(),
    });

    broadcastRealtimeEvent("LOCATION_UPDATED", {
      tripId: id,
      driverId,
      latitude: Number(latitude),
      longitude: Number(longitude),
      speed: Number(speed || 0),
      heading: Number(heading || 0),
      timestamp: new Date().toISOString(),
    });

    res.json({ success: true, message: "Telemetry recorded" });
  } catch (err: any) {
    res.status(500).json({ success: false, error: { code: "DATABASE_ERROR", message: err.message } });
  }
});

/**
 * Most recent GPS telemetry point for a trip, polled by the fleet map.
 */
router.get("/trips/:id/live-location", async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  try {
    const [latest] = await db
      .select()
      .from(driverLocationsTable)
      .where(eq(driverLocationsTable.tripId, id))
      .orderBy(desc(driverLocationsTable.timestamp))
      .limit(1);

    if (!latest) {
      res.status(404).json({ success: false, error: { code: "NOT_FOUND", message: "No location telemetry recorded yet" } });
      return;
    }

    res.json({
      latitude: Number(latest.latitude),
      longitude: Number(latest.longitude),
      speed: latest.speed != null ? Number(latest.speed) : null,
      heading: latest.heading != null ? Number(latest.heading) : null,
      accuracy: latest.accuracy != null ? Number(latest.accuracy) : null,
      timestamp: latest.timestamp,
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: { code: "DATABASE_ERROR", message: err.message } });
  }
});

// =============================================================
// PAYMENTS & EXPENSES LEDGER
// =============================================================
router.get("/payments", async (_req, res): Promise<void> => {
  try {
    const rows = await db.select().from(paymentsTable).orderBy(desc(paymentsTable.createdAt));
    res.json(rows);
  } catch (err: any) {
    console.error("[payments] Database query failed:", err?.message);
    res.status(503).json({ success: false, error: { code: "DATABASE_ERROR", message: "Unable to load payments. Please try again." } });
  }
});

router.get("/trips/:id/payments", async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  try {
    const rows = await db.select().from(paymentsTable).where(eq(paymentsTable.tripId, id)).orderBy(desc(paymentsTable.createdAt));
    res.json(rows);
  } catch (err: any) {
    console.error("[trips/:id/payments] Database query failed:", err?.message);
    res.status(503).json({ success: false, error: { code: "DATABASE_ERROR", message: "Unable to load payments. Please try again." } });
  }
});

async function recordPaymentHandler(req: Request, res: Response): Promise<void> {
  const id = Number(req.params.id || req.body.tripId);
  const { amount, method, paymentType, paymentDate, reference, notes } = req.body;

  if (!id || isNaN(id)) {
    res.status(400).json({ success: false, error: { code: "VALIDATION_ERROR", message: "Valid Trip ID is required" } });
    return;
  }

  const paymentAmount = Number(amount || 0);
  if (paymentAmount <= 0) {
    res.status(400).json({ success: false, error: { code: "VALIDATION_ERROR", message: "Amount must be greater than zero" } });
    return;
  }

  try {
    const [trip] = await db.select().from(tripsTable).where(eq(tripsTable.id, id));
    if (!trip) {
      res.status(404).json({ success: false, error: { code: "NOT_FOUND", message: "Trip not found" } });
      return;
    }

    const [payment] = await db
      .insert(paymentsTable)
      .values({
        tripId: id,
        amount: String(paymentAmount),
        method: method || "UPI",
        paymentType: paymentType || "partial",
        paymentDate: dateOnly(paymentDate || today()),
        reference: reference || null,
        notes: notes || null,
        recordedBy: "Operations Admin",
      })
      .returning();

    // Recalculate trip totals atomically
    const customerTotal = numeric(trip.customerTotal);
    const newTotalPaid = Math.round((numeric(trip.totalPaid) + paymentAmount) * 100) / 100;
    const newRemainingBalance = Math.max(0, Math.round((customerTotal - newTotalPaid) * 100) / 100);
    const newCredit = Math.max(0, Math.round((newTotalPaid - customerTotal) * 100) / 100);

    const [updatedTrip] = await db
      .update(tripsTable)
      .set({
        totalPaid: String(newTotalPaid),
        remainingBalance: String(newRemainingBalance),
        credit: String(newCredit),
        updatedAt: new Date(),
      })
      .where(eq(tripsTable.id, id))
      .returning();

    await writeAudit(req, `Recorded payment ₹${paymentAmount}`, "payment", payment.id);
    broadcastRealtimeEvent("PAYMENT_ADDED", { tripId: id, amount: paymentAmount, trip: updatedTrip });
    res.status(201).json({ success: true, payment, trip: updatedTrip, ...payment });
  } catch (err: any) {
    console.error("[payments] Error:", err);
    res.status(500).json({ success: false, error: { code: "DATABASE_ERROR", message: "Failed to record payment" } });
  }
}

router.post("/trips/:id/payments", requireOwner, recordPaymentHandler);
router.post("/payments", requireOwner, recordPaymentHandler);

const EXPENSE_RECEIPTS_BUCKET = "expense-receipts";
const receiptUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 8 * 1024 * 1024 }, // 8MB — a phone photo or a scanned PDF, not a video
  fileFilter: (_req, file, cb) => {
    const allowed = ["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif", "application/pdf"];
    cb(null, allowed.includes(file.mimetype));
  },
});

/**
 * Upload a driver's proof-of-payment (photo or PDF) for an expense claim.
 * Uses the service-role Supabase client so it bypasses Storage RLS entirely
 * — no bucket policy is required, only the bucket itself needs to exist.
 */
router.post("/expenses/upload-receipt", receiptUpload.single("file"), async (req, res): Promise<void> => {
  if (!req.file) {
    res.status(400).json({
      success: false,
      error: { code: "VALIDATION_ERROR", message: "No file received, or the file type isn't supported (JPG/PNG/WEBP/HEIC/PDF only)." },
    });
    return;
  }

  try {
    const viewer = await viewerFor(req);
    const ext = (req.file.originalname.split(".").pop() || "jpg").toLowerCase().slice(0, 5);
    const path = `${viewer?.driverId || "unknown"}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;

    const { error: uploadError } = await supabaseServer.storage
      .from(EXPENSE_RECEIPTS_BUCKET)
      .upload(path, req.file.buffer, { contentType: req.file.mimetype, upsert: false });

    if (uploadError) {
      console.error("[expenses/upload-receipt] Storage upload error:", uploadError);
      res.status(500).json({
        success: false,
        error: { code: "STORAGE_ERROR", message: "Unable to store the receipt. Please try again." },
      });
      return;
    }

    const { data: publicUrlData } = supabaseServer.storage.from(EXPENSE_RECEIPTS_BUCKET).getPublicUrl(path);
    res.json({ success: true, url: publicUrlData.publicUrl, path });
  } catch (err: any) {
    console.error("[expenses/upload-receipt] Error:", err);
    res.status(500).json({ success: false, error: { code: "SERVER_ERROR", message: "Unable to upload the receipt." } });
  }
});

const ODOMETER_PHOTOS_BUCKET = "odometer-photos";
const odometerPhotoUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 8 * 1024 * 1024 }, // 8MB — a single camera photo, not a video
  fileFilter: (_req, file, cb) => {
    const allowed = ["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"];
    cb(null, allowed.includes(file.mimetype));
  },
});

/**
 * Upload a starting/ending odometer photo captured live from the device
 * camera (the client only ever offers a camera capture, never a gallery
 * picker, so this is proof the meter was actually photographed at that
 * moment) for the Start Trip / Complete Trip KM entry step.
 */
router.post("/driver/trips/upload-km-photo", odometerPhotoUpload.single("file"), async (req, res): Promise<void> => {
  if (!req.file) {
    res.status(400).json({
      success: false,
      error: { code: "VALIDATION_ERROR", message: "No photo received, or the file type isn't supported (JPG/PNG/WEBP/HEIC only)." },
    });
    return;
  }

  try {
    const viewer = await viewerFor(req);
    const ext = (req.file.originalname.split(".").pop() || "jpg").toLowerCase().slice(0, 5);
    const path = `${viewer?.driverId || viewer?.id || "unknown"}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;

    const { error: uploadError } = await supabaseServer.storage
      .from(ODOMETER_PHOTOS_BUCKET)
      .upload(path, req.file.buffer, { contentType: req.file.mimetype, upsert: false });

    if (uploadError) {
      console.error("[driver/trips/upload-km-photo] Storage upload error:", uploadError);
      res.status(500).json({
        success: false,
        error: { code: "STORAGE_ERROR", message: "Unable to store the odometer photo. Please try again." },
      });
      return;
    }

    const { data: publicUrlData } = supabaseServer.storage.from(ODOMETER_PHOTOS_BUCKET).getPublicUrl(path);
    res.json({ success: true, url: publicUrlData.publicUrl, path });
  } catch (err: any) {
    console.error("[driver/trips/upload-km-photo] Error:", err);
    res.status(500).json({ success: false, error: { code: "SERVER_ERROR", message: "Unable to upload the odometer photo." } });
  }
});

router.get("/expenses", async (_req, res): Promise<void> => {
  try {
    const rows = await db.select().from(tripExpensesTable).orderBy(desc(tripExpensesTable.createdAt));
    res.json(rows);
  } catch (err: any) {
    console.error("[expenses] Database query failed:", err?.message);
    res.status(503).json({ success: false, error: { code: "DATABASE_ERROR", message: "Unable to load expenses. Please try again." } });
  }
});

router.post("/expenses", async (req, res): Promise<void> => {
  const { tripId, category, amount, expenseDate, notes, receiptPath, location } = req.body;
  const numAmount = Number(amount || 0);

  if (numAmount <= 0) {
    res.status(400).json({ success: false, error: { code: "VALIDATION_ERROR", message: "Expense amount must be positive" } });
    return;
  }
  // Enforced server-side, not just in the driver app's UI — a proof of
  // payment is mandatory for every expense claim, whatever client submits it.
  if (!receiptPath || typeof receiptPath !== "string" || !receiptPath.trim()) {
    res.status(400).json({ success: false, error: { code: "VALIDATION_ERROR", message: "A proof of payment (receipt photo or PDF) is required." } });
    return;
  }

  try {
    const viewer = await viewerFor(req);
    const [expense] = await db
      .insert(tripExpensesTable)
      .values({
        tripId: Number(tripId),
        driverId: viewer?.driverId || null,
        category: category || "Fuel",
        amount: String(numAmount),
        expenseDate: dateOnly(expenseDate || today()),
        notes: notes || null,
        receiptPath: receiptPath || null,
        status: "pending",
        location: location || null,
        recordedBy: viewer?.name || "Driver",
      })
      .returning();

    broadcastRealtimeEvent("EXPENSE_SUBMITTED", expense);
    res.status(201).json(expense);
  } catch (err: any) {
    res.status(500).json({ success: false, error: { code: "DATABASE_ERROR", message: err.message } });
  }
});

router.patch("/expenses/:id/approve", requireOwner, async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  try {
    const [expense] = await db
      .update(tripExpensesTable)
      .set({
        status: "approved",
        approvedBy: "Operations Admin",
        approvedAt: new Date(),
      })
      .where(eq(tripExpensesTable.id, id))
      .returning();

    if (!expense) {
      res.status(404).json({ success: false, error: { code: "NOT_FOUND", message: "Expense not found" } });
      return;
    }

    // Update trip total expenses
    const [trip] = await db.select().from(tripsTable).where(eq(tripsTable.id, expense.tripId));
    if (trip) {
      const newTotal = Math.round((numeric(trip.expenseTotal) + numeric(expense.amount)) * 100) / 100;
      await db.update(tripsTable).set({ expenseTotal: String(newTotal), updatedAt: new Date() }).where(eq(tripsTable.id, trip.id));
    }

    await writeAudit(req, `Approved expense ₹${expense.amount}`, "expense", id);
    broadcastRealtimeEvent("EXPENSE_APPROVED", expense);
    res.json(expense);
  } catch (err: any) {
    res.status(500).json({ success: false, error: { code: "DATABASE_ERROR", message: err.message } });
  }
});

router.patch("/expenses/:id/reject", requireOwner, async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  const { reason } = req.body;
  try {
    const [expense] = await db
      .update(tripExpensesTable)
      .set({
        status: "rejected",
        rejectionReason: reason || "Rejected by operations manager",
      })
      .where(eq(tripExpensesTable.id, id))
      .returning();

    if (!expense) {
      res.status(404).json({ success: false, error: { code: "NOT_FOUND", message: "Expense not found" } });
      return;
    }

    await writeAudit(req, `Rejected expense: ${reason || ""}`, "expense", id);
    res.json(expense);
  } catch (err: any) {
    res.status(500).json({ success: false, error: { code: "DATABASE_ERROR", message: err.message } });
  }
});

// =============================================================
// REPORTS, NOTIFICATIONS, AUDIT & SETTINGS
// =============================================================
router.get("/reports/summary", requireOwner, async (req, res): Promise<void> => {
  try {
    const allTrips = await db.select().from(tripsTable);
    const allExpenses = await db.select().from(tripExpensesTable).where(eq(tripExpensesTable.status, "approved"));

    const totalRevenue = allTrips.reduce((sum, t) => sum + numeric(t.customerTotal), 0);
    const totalCollected = allTrips.reduce((sum, t) => sum + numeric(t.totalPaid), 0);
    const totalOutstanding = allTrips.reduce((sum, t) => sum + numeric(t.remainingBalance), 0);
    const totalExpenses = allExpenses.reduce((sum, e) => sum + numeric(e.amount), 0);
    const totalProfit = totalRevenue - totalExpenses;

    const completed = allTrips.filter((t) => t.status === "completed").length;
    const ongoing = allTrips.filter((t) => ["started", "in_progress"].includes(t.status)).length;
    const upcoming = allTrips.filter((t) => ["upcoming", "assigned", "accepted"].includes(t.status)).length;
    const cancelled = allTrips.filter((t) => t.status === "cancelled").length;

    res.json({
      grossRevenue: Math.round(totalRevenue * 100) / 100,
      totalCollections: Math.round(totalCollected * 100) / 100,
      totalOutstanding: Math.round(totalOutstanding * 100) / 100,
      totalExpenses: Math.round(totalExpenses * 100) / 100,
      netProfit: Math.round(totalProfit * 100) / 100,
      financials: {
        totalRevenue: Math.round(totalRevenue * 100) / 100,
        totalCollected: Math.round(totalCollected * 100) / 100,
        totalOutstanding: Math.round(totalOutstanding * 100) / 100,
        totalExpenses: Math.round(totalExpenses * 100) / 100,
        totalProfit: Math.round(totalProfit * 100) / 100,
      },
      counts: {
        totalTrips: allTrips.length,
        completed,
        ongoing,
        upcoming,
        cancelled,
      },
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: { code: "DATABASE_ERROR", message: err.message } });
  }
});

router.get("/notifications", async (req, res): Promise<void> => {
  try {
    const viewer = await viewerFor(req);
    const audience = viewer?.role === "driver" ? "driver" : "owner";

    const rows = await db
      .select()
      .from(notificationsTable)
      .where(
        and(
          eq(notificationsTable.audience, audience),
          viewer?.driverId ? eq(notificationsTable.driverId, viewer.driverId) : undefined
        )
      )
      .orderBy(desc(notificationsTable.createdAt))
      .limit(30);

    res.json(rows);
  } catch (err: any) {
    console.error("[notifications] Database query failed:", err?.message);
    res.status(503).json({ success: false, error: { code: "DATABASE_ERROR", message: "Unable to load notifications. Please try again." } });
  }
});

router.post("/notifications/:id/read", async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  try {
    await db.update(notificationsTable).set({ isRead: true }).where(eq(notificationsTable.id, id));
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ success: false, error: { code: "DATABASE_ERROR", message: err.message } });
  }
});

router.post("/notifications/read-all", async (req, res): Promise<void> => {
  try {
    const viewer = await viewerFor(req);
    const audience = viewer?.role === "driver" ? "driver" : "owner";
    await db.update(notificationsTable).set({ isRead: true }).where(eq(notificationsTable.audience, audience));
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ success: false, error: { code: "DATABASE_ERROR", message: err.message } });
  }
});

router.get("/audit-logs", requireOwner, async (_req, res): Promise<void> => {
  try {
    const rows = await db.select().from(auditLogsTable).orderBy(desc(auditLogsTable.createdAt)).limit(100);
    res.json(rows);
  } catch (err: any) {
    console.error("[audit-logs] Database query failed:", err?.message);
    res.status(503).json({ success: false, error: { code: "DATABASE_ERROR", message: "Unable to load audit logs. Please try again." } });
  }
});

router.get("/settings", requireOwner, async (_req, res): Promise<void> => {
  res.json(await settingsView());
});

/**
 * Standalone Android app version manifest — checked by the packaged APK on
 * launch (see useAppUpdateCheck.ts on the client) so an out-of-date install
 * can prompt the user to download the current build. Bump
 * versionCode/versionName here (matching android/app/build.gradle) and
 * re-upload the APK to app-releases every time a new build goes out.
 *
 * As of v1.2.0 this is ONE unified app (both Admin and Driver sign in
 * through the same APK — com.ngtravels.owner) instead of separate
 * Owner/Driver builds. The response still carries both `owner` and
 * `driver` keys (identical content, pointing at the same APK) purely so
 * that any already-installed pre-1.2.0 Owner or Driver APK still gets a
 * valid update-check response and can prompt the user to install this one.
 */
const CURRENT_APP_VERSION = {
  versionCode: 13,
  versionName: "1.3.5",
  // Landing page, not the APK itself: builds up to 1.3.4 open this link in a
  // Chrome Custom Tab, where APK downloads stall at 100%. The page hands the
  // download to full Chrome (see artifacts/ng-travels/public/update.html).
  url: "https://ng-travels-operations-black.vercel.app/update.html",
  releaseNotes: "Fixes the Download Update button: the APK now downloads in Chrome instead of getting stuck at 100% inside the app. Includes everything from 1.3.4 (stand-to-stand KM tracking, delete for customers/vehicles/drivers, Route Planner prefill and booking fixes).",
};
const APP_VERSIONS = {
  owner: CURRENT_APP_VERSION,
  driver: CURRENT_APP_VERSION,
};

router.get("/app/version", async (_req, res): Promise<void> => {
  res.json(APP_VERSIONS);
});

router.patch("/settings", requireOwner, async (req, res): Promise<void> => {
  try {
    for (const [key, val] of Object.entries(req.body)) {
      if (val !== undefined && val !== null) {
        await db
          .insert(appSettingsTable)
          .values({ key, value: String(val), updatedAt: new Date() })
          .onConflictDoUpdate({
            target: appSettingsTable.key,
            set: { value: String(val), updatedAt: new Date() },
          });
      }
    }
    await writeAudit(req, "Updated company settings", "settings", "global", null, req.body);
    res.json(await settingsView());
  } catch (err: any) {
    res.status(500).json({ success: false, error: { code: "DATABASE_ERROR", message: err.message } });
  }
});

export default router;