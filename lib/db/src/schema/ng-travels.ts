import { createInsertSchema } from "drizzle-zod";
import {
  boolean,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  serial,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { z } from "zod/v4";

export type TripLocation = {
  name: string;
  address: string;
  latitude?: number | null;
  longitude?: number | null;
  placeId?: string | null;
  city?: string | null;
  district?: string | null;
  state?: string | null;
  country?: string | null;
  // Intermediate waypoints only: which leg of a round trip this stop
  // belongs on. Omitted/"both" keeps the default symmetric-loop behavior
  // (same stop routed on the way out and the way back); "outbound" or
  // "return" restricts it to just that leg, for an asymmetric route.
  leg?: "outbound" | "return" | "both" | null;
};

export type RouteAlternative = {
  routeIndex: number;
  summary: string;
  distanceKm: number;
  durationMinutes: number;
  estimatedToll: number;
  via: string;
  polyline?: string | null;
  polylineCoordinates?: [number, number][];
  // Extra road distance vs. the primary route — how much further a
  // toll-avoiding detour actually is, so the UI can say "+X km" instead of
  // implying a wholly different road when it's really a short local bypass.
  extraKm?: number;
  // Human-readable toll pricing source/caveat for this specific alternative
  // (e.g. "Estimated from NHAI toll-plaza open data") — lets the UI show an
  // accurate caveat per option instead of a generic fallback when the toll
  // amount is 0 but pricing data wasn't actually confirmed.
  tollStatus?: string;
};

export type RouteSnapshotLeg = {
  distanceKm: number;
  durationMinutes: number;
  polyline?: string | null;
  coordinates?: [number, number][];
  origin: TripLocation;
  destination: TripLocation;
};

export type RouteSnapshot = {
  provider: string;
  calculatedAt: string;
  tripType: string;
  billingDayPolicy?: string;
  billableDays?: number;
  minimumKmPerDay?: number;
  minimumBillableKm?: number;
  outbound: RouteSnapshotLeg;
  return?: RouteSnapshotLeg | null;
  totalRoadDistanceKm: number;
  totalBillableKm: number;
  totalDurationMinutes: number;
  estimatedToll?: number | null;
  tollAvailable?: boolean;
  ratePerKm?: number;
  distanceFare?: number;
  driverBata?: number;
  permitCharge?: number;
  customerTotal?: number;
};

export const driversTable = pgTable(
  "drivers",
  {
    id: serial("id").primaryKey(),
    driverCode: text("driver_code").notNull(),
    name: text("name").notNull(),
    mobile: text("mobile").notNull(),
    email: text("email"),
    licenseNumber: text("license_number"),
    licenseExpiry: date("license_expiry", { mode: "string" }),
    emergencyContact: text("emergency_contact"),
    status: text("status").notNull().default("active"), // active | inactive | on_leave
    availability: text("availability").notNull().default("available"), // available | on_trip | offline | on_leave
    rating: numeric("rating", { precision: 3, scale: 1 }).default("4.8"),
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    uniqueIndex("drivers_code_idx").on(table.driverCode),
    index("drivers_mobile_idx").on(table.mobile),
    index("drivers_availability_idx").on(table.availability),
  ],
);

export const usersTable = pgTable(
  "users",
  {
    id: serial("id").primaryKey(),
    authUserId: uuid("auth_user_id").unique(),
    name: text("name").notNull(),
    email: text("email"),
    phone: text("phone"),
    role: text("role").notNull().default("owner"), // owner | admin | driver | manager
    driverId: integer("driver_id").references(() => driversTable.id),
    status: text("status").notNull().default("active"), // active | inactive
    lastLogin: timestamp("last_login", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    uniqueIndex("users_email_idx").on(table.email),
    index("users_phone_idx").on(table.phone),
    index("users_driver_id_idx").on(table.driverId),
  ],
);

export const vehiclesTable = pgTable(
  "vehicles",
  {
    id: serial("id").primaryKey(),
    vehicleNumber: text("vehicle_number").notNull(),
    vehicleType: text("vehicle_type").notNull(), // Sedan | SUV | Innova | Tempo Traveller | Hatchback
    brand: text("brand").notNull(),
    model: text("model").notNull(),
    year: integer("year"),
    capacity: integer("capacity").notNull().default(4),
    fuelType: text("fuel_type").default("Diesel"),
    rcNumber: text("rc_number"),
    insurancePolicy: text("insurance_policy"),
    insuranceExpiry: date("insurance_expiry", { mode: "string" }),
    permitNumber: text("permit_number"),
    permitExpiry: date("permit_expiry", { mode: "string" }),
    fitnessCertNumber: text("fitness_cert_number"),
    fitnessExpiry: date("fitness_expiry", { mode: "string" }),
    pollutionCertNumber: text("pollution_cert_number"),
    pollutionExpiry: date("pollution_expiry", { mode: "string" }),
    assignedDriverId: integer("assigned_driver_id").references(() => driversTable.id),
    status: text("status").notNull().default("active"), // active | inactive | maintenance
    maintenanceStatus: text("maintenance_status").default("good"), // good | service_due | under_maintenance
    lastServiceDate: date("last_service_date", { mode: "string" }),
    nextServiceDate: date("next_service_date", { mode: "string" }),
    currentOdometerKm: numeric("current_odometer_km", { precision: 12, scale: 2 }).default("0"),
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    uniqueIndex("vehicles_number_idx").on(table.vehicleNumber),
    index("vehicles_status_idx").on(table.status),
    index("vehicles_driver_idx").on(table.assignedDriverId),
  ],
);

export const customersTable = pgTable(
  "customers",
  {
    id: serial("id").primaryKey(),
    customerCode: text("customer_code").notNull(),
    name: text("name").notNull(),
    mobile: text("mobile").notNull(),
    whatsapp: text("whatsapp"),
    alternateNumber: text("alternate_number"),
    email: text("email"),
    address: text("address"),
    notes: text("notes"),
    archived: boolean("archived").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    uniqueIndex("customers_code_idx").on(table.customerCode),
    index("customers_search_idx").on(table.name, table.mobile, table.whatsapp),
  ],
);

export const enquiriesTable = pgTable(
  "enquiries",
  {
    id: serial("id").primaryKey(),
    enquiryCode: text("enquiry_code").notNull(),
    customerName: text("customer_name").notNull(),
    customerMobile: text("customer_mobile").notNull(),
    customerEmail: text("customer_email"),
    pickup: text("pickup").notNull(),
    destination: text("destination").notNull(),
    tripType: text("trip_type").notNull().default("outstation_round_trip"),
    startDate: date("start_date", { mode: "string" }).notNull(),
    passengerCount: integer("passenger_count").notNull().default(1),
    estimatedBudget: numeric("estimated_budget", { precision: 12, scale: 2 }),
    quotedFare: numeric("quoted_fare", { precision: 12, scale: 2 }),
    status: text("status").notNull().default("pending"), // pending | quoted | converted | lost
    notes: text("notes"),
    convertedTripId: integer("converted_trip_id"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    uniqueIndex("enquiries_code_idx").on(table.enquiryCode),
    index("enquiries_status_idx").on(table.status),
    index("enquiries_mobile_idx").on(table.customerMobile),
  ],
);

export const tripsTable = pgTable(
  "trips",
  {
    id: serial("id").primaryKey(),
    bookingId: text("booking_id").notNull(),
    customerId: integer("customer_id")
      .notNull()
      .references(() => customersTable.id),
    driverId: integer("driver_id").references(() => driversTable.id),
    driverName: text("driver_name"),
    driverMobile: text("driver_mobile"),
    vehicleId: integer("vehicle_id").references(() => vehiclesTable.id),
    vehicleNumber: text("vehicle_number"),
    idempotencyKey: text("idempotency_key"),
    tripType: text("trip_type").notNull(),
    pickup: jsonb("pickup").$type<TripLocation>().notNull(),
    destination: jsonb("destination").$type<TripLocation>().notNull(),
    stops: jsonb("stops").$type<TripLocation[]>().notNull().default([]),
    startDate: date("start_date", { mode: "string" }).notNull(),
    startTime: text("start_time").notNull(),
    returnDate: date("return_date", { mode: "string" }),
    returnTime: text("return_time"),
    passengerCount: integer("passenger_count").notNull().default(1),
    notes: text("notes"),
    specialInstructions: text("special_instructions"),
    status: text("status").notNull().default("upcoming"),
    // Status progression: upcoming | ready | started | reached_pickup | customer_picked_up | in_progress | reached_destination | completed | cancelled
    mapDistanceKm: numeric("map_distance_km", {
      precision: 12,
      scale: 2,
    }).notNull().default("0"),
    outboundMapKm: numeric("outbound_map_km", { precision: 12, scale: 2 }),
    returnMapKm: numeric("return_map_km", { precision: 12, scale: 2 }),
    totalMapKm: numeric("total_map_km", { precision: 12, scale: 2 }),
    routeDurationMinutes: integer("route_duration_minutes"),
    outboundDurationMinutes: integer("outbound_duration_minutes"),
    returnDurationMinutes: integer("return_duration_minutes"),
    routeSummary: text("route_summary"),
    apiEstimatedToll: numeric("api_estimated_toll", {
      precision: 12,
      scale: 2,
    }),
    estimatedToll: numeric("estimated_toll", { precision: 12, scale: 2 }),
    finalToll: numeric("final_toll", { precision: 12, scale: 2 }).notNull().default("0"),
    outboundTollEstimate: numeric("outbound_toll_estimate", { precision: 12, scale: 2 }),
    returnTollEstimate: numeric("return_toll_estimate", { precision: 12, scale: 2 }),
    routeOptions: jsonb("route_options").$type<RouteAlternative[]>().default([]),
    selectedRouteSummary: text("selected_route_summary"),
    routeSnapshot: jsonb("route_snapshot").$type<RouteSnapshot>(),
    billingKm: numeric("billing_km", { precision: 12, scale: 2 })
      .notNull()
      .default("0"),
    ratePerKm: numeric("rate_per_km", { precision: 12, scale: 2 })
      .notNull()
      .default("0"),
    // per_km: baseFare = totalBillableDistance * ratePerKm (day-minimum enforced)
    // package: baseFare = packageTotal (flat), ratePerKm/day-minimum ignored
    pricingMode: text("pricing_mode").notNull().default("per_km"),
    packageTotal: numeric("package_total", { precision: 12, scale: 2 }),
    baseFare: numeric("base_fare", { precision: 12, scale: 2 })
      .notNull()
      .default("0"),
    driverBata: numeric("driver_bata", { precision: 12, scale: 2 })
      .notNull()
      .default("0"),
    // percentage: driverCommissionAmount = customerTotal * driverCommissionValue / 100
    // flat: driverCommissionAmount = driverCommissionValue (entered directly in ₹)
    driverCommissionType: text("driver_commission_type").notNull().default("percentage"),
    driverCommissionValue: numeric("driver_commission_value", { precision: 12, scale: 2 })
      .notNull()
      .default("0"),
    driverCommissionAmount: numeric("driver_commission_amount", { precision: 12, scale: 2 })
      .notNull()
      .default("0"),
    toll: numeric("toll", { precision: 12, scale: 2 })
      .notNull()
      .default("0"),
    parking: numeric("parking", { precision: 12, scale: 2 })
      .notNull()
      .default("0"),
    permitCharge: numeric("permit_charge", { precision: 12, scale: 2 })
      .notNull()
      .default("0"),
    waitingCharge: numeric("waiting_charge", { precision: 12, scale: 2 })
      .notNull()
      .default("0"),
    nightCharge: numeric("night_charge", { precision: 12, scale: 2 })
      .notNull()
      .default("0"),
    discount: numeric("discount", { precision: 12, scale: 2 })
      .notNull()
      .default("0"),
    tax: numeric("tax", { precision: 12, scale: 2 })
      .notNull()
      .default("0"),
    billableDays: integer("billable_days").notNull().default(1),
    minimumKm: numeric("minimum_km", { precision: 12, scale: 2 })
      .notNull()
      .default("0"),
    billingDayPolicy: text("billing_day_policy").notNull().default("CALENDAR_DAYS"),
    customerTotal: numeric("customer_total", { precision: 12, scale: 2 })
      .notNull()
      .default("0"),
    totalPaid: numeric("total_paid", { precision: 12, scale: 2 })
      .notNull()
      .default("0"),
    remainingBalance: numeric("remaining_balance", {
      precision: 12,
      scale: 2,
    })
      .notNull()
      .default("0"),
    credit: numeric("credit", { precision: 12, scale: 2 })
      .notNull()
      .default("0"),
    startingKm: numeric("starting_km", { precision: 12, scale: 2 }),
    startKmTime: timestamp("start_km_time", { withTimezone: true }),
    startKmLocation: text("start_km_location"),
    startKmPhoto: text("start_km_photo"),
    endingKm: numeric("ending_km", { precision: 12, scale: 2 }),
    endKmTime: timestamp("end_km_time", { withTimezone: true }),
    endKmLocation: text("end_km_location"),
    endKmPhoto: text("end_km_photo"),
    actualKm: numeric("actual_km", { precision: 12, scale: 2 }),
    // Stand (garage) odometer: leaving for pickup, and back after the drop.
    // Tracking only — billing uses startingKm/endingKm (pickup -> drop).
    standStartKm: numeric("stand_start_km", { precision: 12, scale: 2 }),
    standStartPhoto: text("stand_start_photo"),
    standReturnKm: numeric("stand_return_km", { precision: 12, scale: 2 }),
    standReturnPhoto: text("stand_return_photo"),
    standReturnTime: timestamp("stand_return_time", { withTimezone: true }),
    expenseTotal: numeric("expense_total", { precision: 12, scale: 2 })
      .notNull()
      .default("0"),
    cancellationReason: text("cancellation_reason"),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
    isLocked: boolean("is_locked").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    uniqueIndex("trips_booking_id_idx").on(table.bookingId),
    index("trips_customer_id_idx").on(table.customerId),
    index("trips_driver_id_idx").on(table.driverId),
    index("trips_schedule_idx").on(table.startDate, table.startTime),
    index("trips_status_idx").on(table.status),
  ],
);

export const paymentsTable = pgTable(
  "payments",
  {
    id: serial("id").primaryKey(),
    tripId: integer("trip_id")
      .notNull()
      .references(() => tripsTable.id),
    amount: numeric("amount", { precision: 12, scale: 2 }).notNull(),
    method: text("method").notNull(), // UPI | Cash | Card | Bank Transfer | Cheque
    paymentType: text("payment_type").notNull().default("advance"), // advance | partial | final
    paymentDate: date("payment_date", { mode: "string" }).notNull(),
    reference: text("reference"),
    notes: text("notes"),
    recordedBy: text("recorded_by").default("Operations Admin"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [index("payments_trip_id_idx").on(table.tripId)],
);

export const refundsTable = pgTable(
  "refunds",
  {
    id: serial("id").primaryKey(),
    tripId: integer("trip_id")
      .notNull()
      .references(() => tripsTable.id),
    paymentId: integer("payment_id").references(() => paymentsTable.id),
    amount: numeric("amount", { precision: 12, scale: 2 }).notNull(),
    reason: text("reason").notNull(),
    method: text("method").notNull().default("UPI"),
    reference: text("reference"),
    refundDate: date("refund_date", { mode: "string" }).notNull(),
    recordedBy: text("recorded_by").default("Operations Admin"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [index("refunds_trip_id_idx").on(table.tripId)],
);

export const tripExpensesTable = pgTable(
  "trip_expenses",
  {
    id: serial("id").primaryKey(),
    tripId: integer("trip_id")
      .notNull()
      .references(() => tripsTable.id),
    driverId: integer("driver_id").references(() => driversTable.id),
    category: text("category").notNull(), // Fuel | Toll | Parking | Food | Accommodation | Permit | Maintenance | Other
    amount: numeric("amount", { precision: 12, scale: 2 }).notNull(),
    expenseDate: date("expense_date", { mode: "string" }).notNull(),
    notes: text("notes"),
    receiptPath: text("receipt_path"),
    status: text("status").notNull().default("pending"), // pending | approved | rejected
    approvedBy: text("approved_by"),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    rejectionReason: text("rejection_reason"),
    location: text("location"),
    recordedBy: text("recorded_by").default("Driver"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("trip_expenses_trip_id_idx").on(table.tripId),
    index("trip_expenses_status_idx").on(table.status),
  ],
);

export const tripStatusHistoryTable = pgTable(
  "trip_status_history",
  {
    id: serial("id").primaryKey(),
    tripId: integer("trip_id")
      .notNull()
      .references(() => tripsTable.id),
    status: text("status").notNull(),
    note: text("note"),
    changedBy: text("changed_by"),
    location: text("location"),
    odometerKm: numeric("odometer_km", { precision: 12, scale: 2 }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [index("trip_status_history_trip_id_idx").on(table.tripId)],
);

export const driverLocationsTable = pgTable(
  "driver_locations",
  {
    id: serial("id").primaryKey(),
    driverId: integer("driver_id")
      .notNull()
      .references(() => driversTable.id),
    tripId: integer("trip_id").references(() => tripsTable.id),
    latitude: numeric("latitude", { precision: 10, scale: 6 }).notNull(),
    longitude: numeric("longitude", { precision: 10, scale: 6 }).notNull(),
    accuracy: numeric("accuracy", { precision: 8, scale: 2 }),
    speed: numeric("speed", { precision: 8, scale: 2 }),
    heading: numeric("heading", { precision: 8, scale: 2 }),
    batteryLevel: numeric("battery_level", { precision: 5, scale: 2 }),
    timestamp: timestamp("timestamp", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("driver_locations_driver_idx").on(table.driverId, table.timestamp),
    index("driver_locations_trip_idx").on(table.tripId),
  ],
);

export const notificationsTable = pgTable(
  "notifications",
  {
    id: serial("id").primaryKey(),
    audience: text("audience").notNull().default("owner"), // owner | driver
    driverId: integer("driver_id").references(() => driversTable.id),
    title: text("title").notNull(),
    message: text("message").notNull(),
    kind: text("kind").notNull(),
    isRead: boolean("is_read").notNull().default(false),
    tripId: integer("trip_id").references(() => tripsTable.id),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("notifications_audience_idx").on(table.audience, table.isRead),
    index("notifications_driver_id_idx").on(table.driverId),
  ],
);

export const auditLogsTable = pgTable(
  "audit_logs",
  {
    id: serial("id").primaryKey(),
    action: text("action").notNull(),
    entity: text("entity").notNull(),
    entityId: text("entity_id").notNull(),
    actorName: text("actor_name"),
    oldValue: text("old_value"),
    newValue: text("new_value"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [index("audit_logs_created_at_idx").on(table.createdAt)],
);

export const appSettingsTable = pgTable(
  "app_settings",
  {
    id: serial("id").primaryKey(),
    key: text("key").notNull(),
    value: text("value").notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [uniqueIndex("app_settings_key_idx").on(table.key)],
);

export const insertCustomerSchema = createInsertSchema(customersTable).omit({
  id: true,
  customerCode: true,
  archived: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertCustomer = z.infer<typeof insertCustomerSchema>;
export type Customer = typeof customersTable.$inferSelect;
export type Trip = typeof tripsTable.$inferSelect;
export type Driver = typeof driversTable.$inferSelect;
export type Enquiry = typeof enquiriesTable.$inferSelect;
export type Payment = typeof paymentsTable.$inferSelect;
export type Refund = typeof refundsTable.$inferSelect;
export type TripExpense = typeof tripExpensesTable.$inferSelect;
export type Notification = typeof notificationsTable.$inferSelect;
export type AuditLog = typeof auditLogsTable.$inferSelect;
export type Vehicle = typeof vehiclesTable.$inferSelect;
export type DriverLocation = typeof driverLocationsTable.$inferSelect;
export type User = typeof usersTable.$inferSelect;