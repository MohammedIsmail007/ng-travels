import { apiFetch } from "@/lib/apiFetch";
import React, { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { LocationPicker } from "@/components/trips/LocationPicker";
import { RealtimeFleetMap } from "@/components/maps/RealtimeFleetMap";
import {
  calculateCommercialFare,
  calculateBillableDays,
  formatINR,
  formatKM,
} from "@/lib/fareEngine";
import {
  User, Calendar, Navigation, IndianRupee, ShieldCheck, CheckCircle2,
  Plus, Trash2, ArrowRight, ArrowLeft, Sparkles, AlertTriangle,
  Clock, Car, Search, Calculator, Receipt, CreditCard, MapPin, Gauge, Camera, X
} from "lucide-react";
import { TripActionLoader, ButtonLoader } from "@/components/loading";

export interface CreateTripModalProps {
  isOpen: boolean;
  onClose: () => void;
  onTripCreated: (newTrip: any) => void | Promise<void>;
  customers: any[];
  drivers: any[];
  defaultRate?: number;
  defaultBillingDayPolicy?: "CALENDAR_DAYS" | "24_HOUR_PERIODS";
  initialEnquiry?: any;
  // Present -> the wizard edits this existing trip (PATCH) instead of
  // creating a new one (POST). Only meant to be passed for a trip that
  // hasn't started yet — the caller is responsible for that check.
  editingTrip?: any;
}

// Normalises a stored/handed-over location (trip row, route planner, or a
// plain enquiry string) into the shape the pickers and map expect.
const toPickerLocation = (loc: any) => {
  if (!loc) return null;
  if (typeof loc === "string") return { name: loc, address: loc };
  const lat = loc.latitude ?? loc.lat;
  const lng = loc.longitude ?? loc.lng;
  return {
    name: loc.name,
    address: loc.address,
    formattedAddress: loc.formattedAddress || loc.address,
    latitude: lat,
    longitude: lng,
    lat,
    lng,
    placeId: loc.placeId,
  };
};

const locationText = (loc: any) =>
  typeof loc === "string" ? loc : loc?.address || loc?.name || "";

// Same limits the /driver/trips/upload-km-photo endpoint enforces
const MAX_ODOMETER_PHOTO_BYTES = 8 * 1024 * 1024;
const ACCEPTED_ODOMETER_PHOTO_TYPES = ["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"];

const WIZARD_STEPS = [
  "Customer",
  "Trip Schedule",
  "Route & Distance",
  "Fare Calculation",
  "Driver & Dispatch",
];

export const CreateTripModal: React.FC<CreateTripModalProps> = ({
  isOpen,
  onClose,
  onTripCreated,
  customers,
  drivers,
  defaultRate = 18,
  defaultBillingDayPolicy = "CALENDAR_DAYS",
  initialEnquiry,
  editingTrip,
}) => {
  const isEditing = Boolean(editingTrip);
  const [step, setStep] = useState(1);
  const [loading, setLoading] = useState(false);
  // Blocks a second submit before the `loading` state re-render lands
  const submittingRef = React.useRef(false);
  // One key per booking attempt: the server returns the already-created
  // trip for a repeated key instead of creating a duplicate.
  const idempotencyKeyRef = React.useRef("");

  // Step 1: Customer (Clean initial state - zero autofill)
  const [selectedCustomerId, setSelectedCustomerId] = useState<number | null>(null);
  const [newCustomerName, setNewCustomerName] = useState("");
  const [newCustomerMobile, setNewCustomerMobile] = useState("");
  const [newCustomerWhatsapp, setNewCustomerWhatsapp] = useState("");
  const [newCustomerAddress, setNewCustomerAddress] = useState("");
  const [isCreatingNewCustomer, setIsCreatingNewCustomer] = useState(false);
  const [customerSearch, setCustomerSearch] = useState("");

  // Step 2: Trip Type & Schedule (Clean initial state)
  const [tripType, setTripType] = useState<"single_trip" | "round_trip" | "outstation_round_trip" | "outstation_one_way" | "local_rental" | "airport_transfer">("single_trip");
  const [startDate, setStartDate] = useState(new Date().toISOString().slice(0, 10));
  const [startTime, setStartTime] = useState("08:00");
  const [returnDate, setReturnDate] = useState(new Date().toISOString().slice(0, 10));
  const [returnTime, setReturnTime] = useState("20:00");
  const [passengerCount, setPassengerCount] = useState(1);
  const [notes, setNotes] = useState("");
  const [specialInstructions, setSpecialInstructions] = useState("");

  // Step 3: Route & Direct Distance (Zero autofill)
  const [pickupInput, setPickupInput] = useState("");
  const [pickupLocation, setPickupLocation] = useState<any>(null);
  const [destInput, setDestInput] = useState("");
  const [destLocation, setDestLocation] = useState<any>(null);

  const [stops, setStops] = useState<any[]>([]);
  const [stopInput, setStopInput] = useState("");
  const [stopSuggestions, setStopSuggestions] = useState<any[]>([]);
  const [stopSearching, setStopSearching] = useState(false);
  const stopSearchBoxRef = React.useRef<HTMLDivElement>(null);

  // Real-time Road Distance in KM (Directly editable & optional auto-estimate)
  const [distanceKm, setDistanceKm] = useState<number>(0);
  const [outboundKm, setOutboundKm] = useState<number>(0);
  const [returnKm, setReturnKm] = useState<number>(0);
  const [calculatingDistance, setCalculatingDistance] = useState(false);

  // Route preview: driving polyline, duration & toll status returned by /api/maps/routes
  const [routeCoordinates, setRouteCoordinates] = useState<[number, number][]>([]);
  const [outboundCoordinates, setOutboundCoordinates] = useState<[number, number][]>([]);
  const [returnCoordinates, setReturnCoordinates] = useState<[number, number][]>([]);
  const [outboundDurationMinutes, setOutboundDurationMinutes] = useState(0);
  const [returnDurationMinutes, setReturnDurationMinutes] = useState(0);
  const [estimatedToll, setEstimatedToll] = useState(0);
  const [tollStatus, setTollStatus] = useState("");
  const [tollRateMode, setTollRateMode] = useState<"single" | "round_trip_same_day" | "round_trip_multi_day" | null>(null);
  const [routeOptions, setRouteOptions] = useState<any[]>([]);
  const [selectedRouteIdx, setSelectedRouteIdx] = useState(0);
  // Toll plazas matched along the primary (with-toll) route only — the
  // toll-free alternative has none, so this isn't re-fetched per option,
  // just hidden when that option is selected (see `displayedTollPlazas`).
  const [primaryTollPlazas, setPrimaryTollPlazas] = useState<any[]>([]);

  // Vehicle odometer when it leaves the stand (+ photo proof). Kept apart
  // from the driver's pickup reading so stand -> pickup KM can be tracked.
  const [odometerKm, setOdometerKm] = useState("");
  const [odometerPhotoFile, setOdometerPhotoFile] = useState<File | null>(null);
  const [odometerPhotoPreview, setOdometerPhotoPreview] = useState<string | null>(null);
  const [odometerPhotoUrl, setOdometerPhotoUrl] = useState<string | null>(null);
  const odometerFileInputRef = React.useRef<HTMLInputElement>(null);

  const clearOdometerPhotoFile = () => {
    setOdometerPhotoFile(null);
    setOdometerPhotoPreview((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return null;
    });
  };

  const handlePickOdometerPhoto = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ""; // allow re-picking the same photo after removing it
    if (!file) return;
    if (!ACCEPTED_ODOMETER_PHOTO_TYPES.includes(file.type)) {
      alert("Unsupported photo format — please use a JPG, PNG, WEBP or HEIC image.");
      return;
    }
    if (file.size > MAX_ODOMETER_PHOTO_BYTES) {
      alert("That photo is too large — it must be under 8MB.");
      return;
    }
    clearOdometerPhotoFile();
    setOdometerPhotoFile(file);
    setOdometerPhotoPreview(URL.createObjectURL(file));
  };

  const handleRemoveOdometerPhoto = () => {
    clearOdometerPhotoFile();
    setOdometerPhotoUrl(null);
  };

  // Step 4: Commercial Pricing Parameters
  const [pricingMode, setPricingMode] = useState<"per_km" | "package">("per_km");
  const [packageTotal, setPackageTotal] = useState(0);
  const [ratePerKm, setRatePerKm] = useState(defaultRate);
  const [driverCommissionType, setDriverCommissionType] = useState<"percentage" | "flat">("percentage");
  const [driverCommissionValue, setDriverCommissionValue] = useState(0);
  const [finalToll, setFinalToll] = useState(0);
  const [parking, setParking] = useState(0);
  const [permitCharge, setPermitCharge] = useState(0);
  const [waitingCharge, setWaitingCharge] = useState(0);
  const [nightCharge, setNightCharge] = useState(0);
  const [discount, setDiscount] = useState(0);
  const [taxPercent, setTaxPercent] = useState(0);
  const [billingDayPolicy, setBillingDayPolicy] = useState<"CALENDAR_DAYS" | "24_HOUR_PERIODS">(defaultBillingDayPolicy);

  // Step 5: Driver & Vehicle Assignment & Advance Collection
  const [selectedDriverId, setSelectedDriverId] = useState<number | null>(null);
  const [selectedVehicleId, setSelectedVehicleId] = useState<number | null>(null);
  const [advanceAmount, setAdvanceAmount] = useState(0);
  const [paymentMethod, setPaymentMethod] = useState("UPI");
  const [paymentReference, setPaymentReference] = useState("");

  const { data: rawVehicles = [] } = useQuery<any>({
    queryKey: ["/api/vehicles"],
    queryFn: async () => {
      try {
        const res = await apiFetch("/api/vehicles");
        if (!res.ok) return [];
        const json = await res.json();
        return Array.isArray(json) ? json : (Array.isArray(json?.items) ? json.items : []);
      } catch {
        return [];
      }
    },
  });

  const vehicles: any[] = Array.isArray(rawVehicles)
    ? rawVehicles
    : Array.isArray((rawVehicles as any)?.items)
    ? (rawVehicles as any).items
    : [];

  // Core route (re)calculation — silent, no alerts, safe to call automatically
  // whenever the pins on the map change (pickup/destination picked, or a
  // stop added/removed). handleAutoEstimateDistance below is the explicit
  // button click, which validates first and shows an alert if incomplete.
  const recalcRoute = async () => {
    if (!pickupInput.trim() || !destInput.trim()) return;
    setCalculatingDistance(true);
    try {
      const pLoc = pickupLocation || { name: pickupInput, address: pickupInput };
      const dLoc = destLocation || { name: destInput, address: destInput };
      const res = await apiFetch("/api/maps/routes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          pickup: pLoc,
          destination: dLoc,
          stops,
          tripType,
          startDate,
          startTime,
          returnDate: tripType.toLowerCase().includes("round") ? returnDate : null,
          returnTime: tripType.toLowerCase().includes("round") ? returnTime : null,
        }),
      });
      if (res.ok) {
        const data = await res.json();
        const totKm = Math.round(Number(data.totalDistanceKm || data.totalRoadKm || 0));
        const outKm = Math.round(Number(data.outboundDistanceKm || 0));
        const retKm = Math.round(Number(data.returnDistanceKm || 0));
        if (totKm > 0) {
          setDistanceKm(totKm);
          setOutboundKm(outKm || totKm);
          setReturnKm(retKm || 0);
        }
        // A fresh estimate always replaces the toll figure from whatever
        // pickup/drop combination was estimated before — otherwise changing
        // the locations and re-estimating silently keeps stale toll from
        // the previous route.
        setFinalToll(Number(data.estimatedToll || 0));
        setRouteCoordinates(data.routeCoordinates || []);
        setOutboundCoordinates(data.outboundCoordinates || []);
        setReturnCoordinates(data.returnCoordinates || []);
        setOutboundDurationMinutes(Number(data.outboundDurationMinutes || 0));
        setReturnDurationMinutes(Number(data.returnDurationMinutes || 0));
        setEstimatedToll(Number(data.estimatedToll || 0));
        setTollStatus(data.tollStatus || "");
        setTollRateMode(data.tollRateMode || null);
        setRouteOptions(Array.isArray(data.routes) ? data.routes : []);
        setSelectedRouteIdx(0);
        setPrimaryTollPlazas(Array.isArray(data.tollPlazas) ? data.tollPlazas : []);

        // The map preview needs real coordinates to place pins correctly.
        // If the user typed a place without picking a specific autocomplete
        // suggestion, pickupLocation/destLocation stay null — but the server
        // still geocodes the typed text to compute the route, so pick up
        // those resolved coordinates here rather than let the map guess.
        if (!pickupLocation && data.resolvedPickup?.lat && data.resolvedPickup?.lng) {
          setPickupLocation({
            name: data.resolvedPickup.name || pickupInput,
            formattedAddress: data.resolvedPickup.formattedAddress || pickupInput,
            lat: data.resolvedPickup.lat,
            lng: data.resolvedPickup.lng,
            latitude: data.resolvedPickup.lat,
            longitude: data.resolvedPickup.lng,
          });
        }
        if (!destLocation && data.resolvedDestination?.lat && data.resolvedDestination?.lng) {
          setDestLocation({
            name: data.resolvedDestination.name || destInput,
            formattedAddress: data.resolvedDestination.formattedAddress || destInput,
            lat: data.resolvedDestination.lat,
            lng: data.resolvedDestination.lng,
            latitude: data.resolvedDestination.lat,
            longitude: data.resolvedDestination.lng,
          });
        }
      }
    } catch (err) {
      console.warn("Background distance calculation unavailable, enter KM manually:", err);
    } finally {
      setCalculatingDistance(false);
    }
  };

  const handleAutoEstimateDistance = async () => {
    if (!pickupInput.trim() || !destInput.trim()) {
      alert("Please enter both pickup and destination places to estimate distance.");
      return;
    }
    await recalcRoute();
  };

  // Re-run route calculation automatically whenever the stops actually
  // pinned on the map change — adding/removing a waypoint should redraw the
  // route through it immediately, not wait for a manual re-estimate click.
  // A stop typed free-text with no coordinates can't be routed through, so
  // it doesn't trigger this (recalcRoute would just retrace the same road).
  const stopsRouteKey = stops
    .filter((s) => s.lat || s.latitude)
    .map((s) => `${s.lat ?? s.latitude},${s.lng ?? s.longitude}`)
    .join("|");
  useEffect(() => {
    recalcRoute();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stopsRouteKey]);

  // Switch between the fastest (toll) route and the toll-free alternative,
  // updating billed distance, toll charge and the map preview to match.
  const handleSelectRouteOption = (idx: number) => {
    const opt = routeOptions[idx];
    if (!opt) return;
    setSelectedRouteIdx(idx);
    setDistanceKm(Math.round(opt.distanceKm));
    setOutboundKm(0);
    setReturnKm(0);
    setFinalToll(opt.estimatedToll || 0);
    setEstimatedToll(opt.estimatedToll || 0);
    setOutboundCoordinates(opt.polylineCoordinates || []);
    setReturnCoordinates([]);
    setOutboundDurationMinutes(opt.durationMinutes || 0);
    setReturnDurationMinutes(0);
  };

  // Pre-fill a new booking from an enquiry being converted, or from a route
  // calculated in the Route Planner (which also hands over its distances,
  // toll, durations, polylines and route options so the wizard shows exactly
  // what the planner showed instead of starting from zero).
  const applyPrefill = (p: any) => {
    if (p.customerName || p.customerMobile) {
      setNewCustomerName(p.customerName || "");
      setNewCustomerMobile(p.customerMobile || "");
      setIsCreatingNewCustomer(true);
    }
    if (p.pickup) {
      setPickupInput(locationText(p.pickup));
      setPickupLocation(toPickerLocation(p.pickup));
    }
    if (p.destination) {
      setDestInput(locationText(p.destination));
      setDestLocation(toPickerLocation(p.destination));
    }
    if (Array.isArray(p.stops)) {
      setStops(p.stops.map(toPickerLocation).filter(Boolean));
    }
    if (p.tripType) setTripType(p.tripType);
    if (p.startDate) setStartDate(p.startDate);
    if (p.passengerCount) setPassengerCount(Number(p.passengerCount));

    const totalKm = Math.round(Number(p.totalMapKm || p.billingKm || 0));
    if (totalKm > 0) {
      setDistanceKm(totalKm);
      setOutboundKm(Math.round(Number(p.outboundMapKm || 0)));
      setReturnKm(Math.round(Number(p.returnMapKm || 0)));
    }
    if (p.estimatedToll != null) {
      setFinalToll(Number(p.estimatedToll || 0));
      setEstimatedToll(Number(p.estimatedToll || 0));
    }
    if (p.outboundDurationMinutes != null) setOutboundDurationMinutes(Number(p.outboundDurationMinutes || 0));
    if (p.returnDurationMinutes != null) setReturnDurationMinutes(Number(p.returnDurationMinutes || 0));
    if (Array.isArray(p.routeCoordinates)) setRouteCoordinates(p.routeCoordinates);
    if (Array.isArray(p.outboundCoordinates)) setOutboundCoordinates(p.outboundCoordinates);
    if (Array.isArray(p.returnCoordinates)) setReturnCoordinates(p.returnCoordinates);
    if (p.tollStatus) setTollStatus(p.tollStatus);
    if (p.tollRateMode) setTollRateMode(p.tollRateMode);
    if (Array.isArray(p.tollPlazas)) setPrimaryTollPlazas(p.tollPlazas);
    if (Array.isArray(p.routes)) {
      setRouteOptions(p.routes);
      setSelectedRouteIdx(Math.min(Math.max(Number(p.selectedRouteIdx || 0), 0), Math.max(p.routes.length - 1, 0)));
    }
  };

  // Populate the wizard from an existing trip when editing, or reset it to a
  // blank slate for a brand-new booking — the modal stays mounted between
  // opens (its `isOpen` prop just toggles visibility), so without this,
  // whatever was last typed (or the trip last edited) would still be sitting
  // in state the next time it opens.
  useEffect(() => {
    if (!isOpen) return;
    setStep(1);
    idempotencyKeyRef.current = `trip-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

    if (editingTrip) {
      const toDateStr = (d: any) => (d ? new Date(d).toISOString().slice(0, 10) : "");
      const toLocation = toPickerLocation;

      setSelectedCustomerId(editingTrip.customerId ?? null);
      setIsCreatingNewCustomer(false);

      setTripType(editingTrip.tripType || "single_trip");
      setStartDate(toDateStr(editingTrip.startDate) || new Date().toISOString().slice(0, 10));
      setStartTime(editingTrip.startTime || "08:00");
      setReturnDate(toDateStr(editingTrip.returnDate) || new Date().toISOString().slice(0, 10));
      setReturnTime(editingTrip.returnTime || "20:00");
      setPassengerCount(editingTrip.passengerCount || 1);
      setNotes(editingTrip.notes || "");
      setSpecialInstructions(editingTrip.specialInstructions || "");

      setPickupInput(editingTrip.pickup?.address || editingTrip.pickup?.name || "");
      setPickupLocation(toLocation(editingTrip.pickup));
      setDestInput(editingTrip.destination?.address || editingTrip.destination?.name || "");
      setDestLocation(toLocation(editingTrip.destination));
      setStops(
        Array.isArray(editingTrip.stops)
          ? editingTrip.stops.map((s: any) => toLocation(s) || { name: s.name, address: s.address })
          : [],
      );

      setDistanceKm(Number(editingTrip.totalMapKm || editingTrip.mapDistanceKm || 0));
      setOutboundKm(Number(editingTrip.outboundMapKm || 0));
      setReturnKm(Number(editingTrip.returnMapKm || 0));
      setOutboundDurationMinutes(Number(editingTrip.outboundDurationMinutes || 0));
      setReturnDurationMinutes(Number(editingTrip.returnDurationMinutes || 0));

      setPricingMode(editingTrip.pricingMode === "package" ? "package" : "per_km");
      setPackageTotal(Number(editingTrip.packageTotal || 0));
      setRatePerKm(Number(editingTrip.ratePerKm || defaultRate));
      setDriverCommissionType(editingTrip.driverCommissionType === "flat" ? "flat" : "percentage");
      setDriverCommissionValue(Number(editingTrip.driverCommissionValue || 0));
      setFinalToll(Number(editingTrip.finalToll || editingTrip.toll || 0));
      setParking(Number(editingTrip.parking || 0));
      setPermitCharge(Number(editingTrip.permitCharge || 0));
      setWaitingCharge(Number(editingTrip.waitingCharge || 0));
      setNightCharge(Number(editingTrip.nightCharge || 0));
      setDiscount(Number(editingTrip.discount || 0));
      setTaxPercent(Number(editingTrip.taxPercent || 0));
      setBillingDayPolicy(editingTrip.billingDayPolicy || defaultBillingDayPolicy);

      setSelectedDriverId(editingTrip.driverId ?? null);
      setSelectedVehicleId(editingTrip.vehicleId ?? null);
      setOdometerKm(editingTrip.standStartKm != null ? String(editingTrip.standStartKm) : "");
      setOdometerPhotoUrl(editingTrip.standStartPhoto || null);
      clearOdometerPhotoFile();
      // Advance/payment collection is handled by the dedicated Record Payment
      // flow, not re-run here — editing a trip must never silently log a
      // second advance payment.
      setAdvanceAmount(0);
    } else {
      setSelectedCustomerId(null);
      setNewCustomerName("");
      setNewCustomerMobile("");
      setNewCustomerWhatsapp("");
      setNewCustomerAddress("");
      setIsCreatingNewCustomer(false);
      setCustomerSearch("");

      setTripType("single_trip");
      setStartDate(new Date().toISOString().slice(0, 10));
      setStartTime("08:00");
      setReturnDate(new Date().toISOString().slice(0, 10));
      setReturnTime("20:00");
      setPassengerCount(1);
      setNotes("");
      setSpecialInstructions("");

      setPickupInput("");
      setPickupLocation(null);
      setDestInput("");
      setDestLocation(null);
      setStops([]);

      setDistanceKm(0);
      setOutboundKm(0);
      setReturnKm(0);
      setRouteCoordinates([]);
      setOutboundCoordinates([]);
      setReturnCoordinates([]);
      setOutboundDurationMinutes(0);
      setReturnDurationMinutes(0);
      setEstimatedToll(0);
      setTollStatus("");
      setTollRateMode(null);
      setRouteOptions([]);
      setSelectedRouteIdx(0);
      setPrimaryTollPlazas([]);

      setPricingMode("per_km");
      setPackageTotal(0);
      setRatePerKm(defaultRate);
      setDriverCommissionType("percentage");
      setDriverCommissionValue(0);
      setFinalToll(0);
      setParking(0);
      setPermitCharge(0);
      setWaitingCharge(0);
      setNightCharge(0);
      setDiscount(0);
      setTaxPercent(0);
      setBillingDayPolicy(defaultBillingDayPolicy);

      setSelectedDriverId(null);
      setSelectedVehicleId(null);
      setAdvanceAmount(0);
      setPaymentMethod("UPI");
      setPaymentReference("");

      setOdometerKm("");
      setOdometerPhotoUrl(null);
      clearOdometerPhotoFile();

      // Applied after the reset above so it isn't wiped by it.
      if (initialEnquiry) applyPrefill(initialEnquiry);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, editingTrip, initialEnquiry]);

  // Waypoint search: live autocomplete for the "Add Stop" field, same
  // endpoint the Pickup/Destination pickers use — previously this field
  // took whatever text was typed with no geocoding, so a stop had no real
  // coordinates and could never be routed through correctly or placed
  // accurately on the map.
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

  // The toll-free alternative (routeOptions[1]) has no toll plazas by definition
  const displayedTollPlazas = selectedRouteIdx === 0 ? primaryTollPlazas : [];

  // 100% Dynamic, Authoritative Commercial Fare Calculation
  const isRound = tripType.toLowerCase().includes("round");
  const effectiveOutboundKm = outboundKm > 0 ? outboundKm : (isRound ? Math.round(distanceKm / 2) : distanceKm);
  const effectiveReturnKm = returnKm > 0 ? returnKm : (isRound ? Math.round(distanceKm / 2) : 0);
  // Editing never collects a new advance here (that's the separate Record
  // Payment flow) — the running balance instead has to reflect whatever was
  // already actually paid on this trip so it doesn't look like a fresh,
  // fully-unpaid booking.
  const totalPaidForCalc = isEditing ? Number(editingTrip?.totalPaid || 0) : advanceAmount;

  const commercialFare = calculateCommercialFare({
    tripType,
    outboundDistanceKm: effectiveOutboundKm,
    returnDistanceKm: effectiveReturnKm,
    totalRoadDistanceKm: distanceKm,
    ratePerKm,
    pricingMode,
    packageTotal,
    startDate,
    returnDate: isRound ? returnDate : null,
    startTime,
    returnTime,
    billingDayPolicy,
    minimumKmPerDay: 0,
    driverBataPerDay: 0,
    permitCharge,
    toll: finalToll,
    tollAvailable: finalToll > 0,
    parking,
    waiting: waitingCharge,
    nightCharges: nightCharge,
    discount,
    taxPercent,
    totalPaid: totalPaidForCalc,
  });

  const baseFare = commercialFare.distanceFare;
  const customerTotal = commercialFare.customerTotal;
  const remainingBalance = commercialFare.remainingBalance;
  const billableDays = commercialFare.billableDays;
  // Internal ops figure only — never affects the customer-facing fare above.
  const driverCommissionAmount = driverCommissionType === "flat"
    ? driverCommissionValue
    : Math.round(customerTotal * (driverCommissionValue / 100) * 100) / 100;

  const handleNext = () => {
    if (step === 1) {
      if (!isCreatingNewCustomer && !selectedCustomerId) {
        alert("Please select an existing customer or click '+ Add New Customer'");
        return;
      }
      if (isCreatingNewCustomer && (!newCustomerName.trim() || !newCustomerMobile.trim())) {
        alert("Please enter customer name and 10-digit mobile number");
        return;
      }
    }
    if (step === 3) {
      if (!pickupInput.trim() || !destInput.trim()) {
        alert("Please specify both pickup and destination locations");
        return;
      }
      // Stand odometer + photo are mandatory for new bookings. Edits of
      // trips booked before this was required stay optional, so they can
      // still be changed without one.
      const hasOdometerPhoto = Boolean(odometerPhotoFile || odometerPhotoUrl);
      if (!isEditing && odometerKm.trim() === "") {
        alert("Please enter the odometer reading at the stand");
        return;
      }
      if (odometerKm.trim() !== "" && (!Number.isFinite(Number(odometerKm)) || Number(odometerKm) <= 0)) {
        alert("Odometer reading must be a valid positive number");
        return;
      }
      if (!isEditing && !hasOdometerPhoto) {
        alert("Please upload a photo of the odometer reading");
        return;
      }
      if (hasOdometerPhoto && odometerKm.trim() === "") {
        alert("Please enter the odometer reading shown in the photo");
        return;
      }
      if (odometerKm.trim() !== "" && !hasOdometerPhoto) {
        alert("Please upload a photo of the odometer reading");
        return;
      }
      if (distanceKm <= 0) {
        const proceed = confirm("Road Distance is currently 0 KM. Would you like to enter a distance in KM now?");
        if (proceed) return;
      }
    }
    if (step === 4) {
      if (pricingMode === "package" && packageTotal <= 0) {
        alert("Please enter the total package amount");
        return;
      }
      if (pricingMode === "per_km" && ratePerKm <= 0) {
        alert("Please enter a rate per KM");
        return;
      }
    }
    setStep((prev) => Math.min(prev + 1, 5));
  };

  const handleBack = () => {
    setStep((prev) => Math.max(prev - 1, 1));
  };

  // Adds whatever the user typed as a plain-text waypoint (no coordinates) —
  // used only as a fallback when they type-and-Enter without picking a
  // suggestion. Picking a suggestion instead goes through
  // handleSelectStopSuggestion, which carries real lat/lng so the stop can
  // actually be routed through and pinned on the map.
  const handleAddStop = () => {
    if (stopInput.trim()) {
      setStops([...stops, { name: stopInput.trim(), address: stopInput.trim() }]);
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
      },
    ]);
    setStopInput("");
    setStopSuggestions([]);
  };

  const handleRemoveStop = (idx: number) => {
    setStops(stops.filter((_, i) => i !== idx));
  };

  const handleSubmitBooking = async () => {
    if (submittingRef.current) return;
    submittingRef.current = true;
    setLoading(true);
    try {
      let customerId = selectedCustomerId;

      if (isCreatingNewCustomer) {
        const custRes = await apiFetch("/api/customers", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: newCustomerName.trim(),
            mobile: newCustomerMobile.trim(),
            whatsapp: newCustomerWhatsapp.trim() || newCustomerMobile.trim(),
            address: newCustomerAddress.trim() || (pickupLocation?.address || pickupInput),
          }),
        });
        const newCust = await custRes.json();
        if (!custRes.ok || !newCust?.id) {
          throw new Error(newCust?.error?.message || "Failed to create customer");
        }
        customerId = newCust.id;
        // If the trip save below fails, a retry reuses this customer
        // instead of registering them a second time.
        setSelectedCustomerId(newCust.id);
        setIsCreatingNewCustomer(false);
      }

      if (!customerId) {
        alert("Please select or create a customer");
        setLoading(false);
        return;
      }

      let standStartPhoto = odometerPhotoUrl;
      if (odometerPhotoFile) {
        const formData = new FormData();
        formData.append("file", odometerPhotoFile);
        const uploadRes = await apiFetch("/api/driver/trips/upload-km-photo", {
          method: "POST",
          body: formData,
        });
        if (!uploadRes.ok) {
          const errData = await uploadRes.json().catch(() => null);
          throw new Error(errData?.error?.message || "Failed to upload the odometer photo.");
        }
        standStartPhoto = (await uploadRes.json()).url;
        // Keep the uploaded URL so a retry after a failed save doesn't re-upload
        setOdometerPhotoUrl(standStartPhoto);
        clearOdometerPhotoFile();
      }
      const standStartKm = odometerKm.trim() !== "" ? Number(odometerKm) : null;

      // Route choices without their map polylines: nothing reads the
      // polylines back from a saved trip, and two long routes' worth of
      // coordinates pushed the request past the server's body-size limit.
      const routeOptionsSummary = routeOptions.map(({ polylineCoordinates, ...opt }: any) => opt);

      let res: Response;

      if (isEditing) {
        // PATCH /trips/:id just merges whatever fields it's given onto the
        // row — unlike POST it does NOT recompute the fare, so the full,
        // already-computed commercialFare breakdown has to be sent
        // explicitly here rather than the raw inputs the create flow sends.
        const selectedDriver = drivers.find((d: any) => d.id === selectedDriverId);
        const selectedVehicle = vehicles.find((v: any) => v.id === selectedVehicleId);

        const patchPayload = {
          customerId,
          tripType,
          pickup: pickupLocation || { name: pickupInput, address: pickupInput },
          destination: destLocation || { name: destInput, address: destInput },
          stops,
          startDate,
          startTime,
          returnDate: isRound ? returnDate : null,
          returnTime: isRound ? returnTime : null,
          passengerCount,
          notes,
          specialInstructions,
          mapDistanceKm: String(commercialFare.totalRoadDistanceKm),
          outboundMapKm: String(commercialFare.outboundDistanceKm),
          returnMapKm: String(commercialFare.returnDistanceKm),
          totalMapKm: String(commercialFare.totalRoadDistanceKm),
          routeDurationMinutes: outboundDurationMinutes + returnDurationMinutes,
          outboundDurationMinutes,
          returnDurationMinutes,
          routeSummary: `${pickupInput} ➔ ${destInput}`,
          selectedRouteSummary: routeOptions[selectedRouteIdx]?.summary || `${pickupInput} ➔ ${destInput}`,
          routeOptions: routeOptionsSummary,
          apiEstimatedToll: commercialFare.toll > 0 ? String(commercialFare.toll) : null,
          estimatedToll: commercialFare.toll > 0 ? String(commercialFare.toll) : null,
          billingKm: String(commercialFare.totalBillableDistance),
          ratePerKm: String(commercialFare.ratePerKm),
          pricingMode: commercialFare.pricingMode,
          packageTotal: commercialFare.pricingMode === "package" ? String(commercialFare.packageTotal) : null,
          driverCommissionType,
          driverCommissionValue: String(driverCommissionValue),
          driverCommissionAmount: String(driverCommissionAmount),
          baseFare: String(commercialFare.distanceFare),
          finalToll: String(commercialFare.toll),
          toll: String(commercialFare.toll),
          parking: String(commercialFare.parking),
          permitCharge: String(commercialFare.permitCharge),
          waitingCharge: String(commercialFare.waiting),
          nightCharge: String(commercialFare.nightCharges),
          discount: String(commercialFare.discount),
          tax: String(commercialFare.tax),
          billingDayPolicy,
          customerTotal: String(commercialFare.customerTotal),
          remainingBalance: String(commercialFare.remainingBalance),
          credit: String(commercialFare.credit),
          driverId: selectedDriverId,
          driverName: selectedDriver?.name || null,
          driverMobile: selectedDriver?.mobile || null,
          vehicleId: selectedVehicleId,
          vehicleNumber: selectedVehicle?.vehicleNumber || null,
          standStartKm: standStartKm != null ? String(standStartKm) : null,
          standStartPhoto: standStartPhoto || null,
          status: selectedDriverId ? "assigned" : "upcoming",
        };

        res = await apiFetch(`/api/trips/${editingTrip.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(patchPayload),
        });
      } else {
        const payload = {
          customerId,
          tripType,
          pickup: pickupLocation || { name: pickupInput, address: pickupInput },
          destination: destLocation || { name: destInput, address: destInput },
          stops,
          startDate,
          startTime,
          returnDate: isRound ? returnDate : null,
          returnTime: isRound ? returnTime : null,
          passengerCount,
          notes,
          specialInstructions,
          outboundMapKm: effectiveOutboundKm,
          returnMapKm: effectiveReturnKm,
          totalMapKm: distanceKm,
          routeDurationMinutes: outboundDurationMinutes + returnDurationMinutes,
          outboundDurationMinutes,
          returnDurationMinutes,
          routeSummary: `${pickupInput} ➔ ${destInput}`,
          selectedRouteSummary: routeOptions[selectedRouteIdx]?.summary || `${pickupInput} ➔ ${destInput}`,
          routeOptions: routeOptionsSummary,
          estimatedToll: finalToll,
          billingKm: commercialFare.totalBillableDistance,
          ratePerKm,
          pricingMode,
          packageTotal,
          driverCommissionType,
          driverCommissionValue,
          minimumKmPerDay: 0,
          driverBataPerDay: 0,
          billingDayPolicy,
          finalToll,
          parking,
          permitCharge,
          waitingCharge,
          nightCharge,
          discount,
          taxPercent,
          driverId: selectedDriverId,
          vehicleId: selectedVehicleId,
          standStartKm,
          standStartPhoto,
          advance: advanceAmount,
          paymentMethod,
          paymentReference,
          idempotencyKey: idempotencyKeyRef.current,
        };

        res = await apiFetch("/api/trips", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
      }

      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        const message =
          errJson.error?.message ||
          (typeof errJson.error === "string" ? errJson.error : null) ||
          errJson.message;
        // Non-JSON failures (body too large, proxy/server down) still say
        // which HTTP status came back instead of a bare generic message.
        throw new Error(message || `Failed to ${isEditing ? "update" : "create"} trip (HTTP ${res.status})`);
      }

      const savedTrip = await res.json();
      // Awaited so the "Dispatch Trip"/"Save Changes" spinner (and the modal
      // itself) stays up until the trips list has actually refetched, not
      // just until the create/update request itself finishes.
      await onTripCreated(savedTrip);
      onClose();
    } catch (err: any) {
      alert(err.message || `Failed to ${isEditing ? "update" : "create"} trip`);
    } finally {
      submittingRef.current = false;
      setLoading(false);
    }
  };

  const customerList = Array.isArray(customers)
    ? customers
    : Array.isArray((customers as any)?.items)
    ? (customers as any).items
    : [];

  const filteredCustomers = customerList.filter(
    (c: any) =>
      c &&
      ((c.name || "").toLowerCase().includes(customerSearch.toLowerCase()) ||
       (c.mobile || "").includes(customerSearch))
  );

  return (
    <>
      {loading && <TripActionLoader action="create" />}

      <Dialog open={isOpen} onOpenChange={onClose}>
        <DialogContent className="w-[96vw] max-w-5xl bg-background border-border text-foreground max-h-[92vh] overflow-y-auto p-4 sm:p-6 rounded-2xl shadow-2xl">
          <DialogHeader className="border-b border-border/80 pb-3 sm:pb-4">
            <div className="flex items-center justify-between">
              <DialogTitle className="text-base sm:text-xl font-black text-amber-700 dark:text-amber-400 flex items-center gap-1.5 sm:gap-2">
                <Navigation className="w-4 h-4 sm:w-5 sm:h-5 text-amber-700 dark:text-amber-400" />
                {isEditing ? `EDIT TRIP — ${editingTrip.bookingId || ""}` : "CREATE TRIP & DISPATCH"}
              </DialogTitle>
              <span className="text-[10px] sm:text-xs font-mono font-bold px-2 py-0.5 sm:py-1 rounded bg-card border border-border text-muted-foreground">
                STEP {step}/5
              </span>
            </div>

            {/* 5-Step Process Indicator */}
            <div className="flex items-center gap-1 sm:gap-1.5 mt-2 sm:mt-3">
              {WIZARD_STEPS.map((label, idx) => (
                <div key={idx} className="flex-1">
                  <div
                    className={`h-1 sm:h-1.5 rounded-full transition-all ${
                      step > idx + 1
                        ? "bg-emerald-400"
                        : step === idx + 1
                        ? "bg-amber-400 animate-pulse"
                        : "bg-muted"
                    }`}
                  />
                  <div className={`text-[9px] sm:text-[10px] font-medium truncate mt-0.5 sm:mt-1 hidden xs:block ${
                    step === idx + 1 ? "text-amber-700 dark:text-amber-400 font-bold" : "text-muted-foreground"
                  }`}>{label}</div>
                </div>
              ))}
            </div>
          </DialogHeader>

          <div className="py-4 space-y-6">
            {/* STEP 1: CUSTOMER SELECTION */}
            {step === 1 && (
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="text-sm font-bold text-foreground">Customer Identification</h3>
                    <p className="text-xs text-muted-foreground mt-0.5">Select an existing corporate profile or quickly register a new client.</p>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setIsCreatingNewCustomer(!isCreatingNewCustomer)}
                    className="border-amber-300 dark:border-amber-500/40 text-amber-700 dark:text-amber-300 text-xs h-8 cursor-pointer"
                  >
                    {isCreatingNewCustomer ? "Select Existing Customer" : "+ Add New Customer"}
                  </Button>
                </div>

                {!isCreatingNewCustomer ? (
                  <div className="space-y-3">
                    <div className="relative">
                      <Search className="w-4 h-4 text-muted-foreground absolute left-3 top-3" />
                      <Input
                        placeholder="Search customer by name, mobile, or company (e.g. Rajesh, 98450)..."
                        value={customerSearch}
                        onChange={(e) => setCustomerSearch(e.target.value)}
                        className="pl-9 bg-card border-border text-xs h-10 placeholder:text-muted-foreground"
                      />
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 max-h-56 overflow-y-auto pr-1">
                      {filteredCustomers.length === 0 ? (
                        <div className="col-span-2 text-center py-8 text-muted-foreground text-xs bg-card/40 rounded-xl border border-border">
                          No matching customer accounts. Click "+ Add New Customer" above to register.
                        </div>
                      ) : (
                        filteredCustomers.map((cust: any) => {
                          const isSelected = selectedCustomerId === cust.id;
                          return (
                            <div
                              key={cust.id}
                              onClick={() => setSelectedCustomerId(cust.id)}
                              className={`p-3 rounded-xl border transition-all cursor-pointer text-left ${
                                isSelected
                                  ? "bg-amber-950/40 border-amber-400 text-foreground shadow-md shadow-amber-400/10"
                                  : "bg-card/60 border-border hover:border-border text-foreground"
                              }`}
                            >
                              <div className="font-bold text-xs flex items-center justify-between">
                                <span>{cust.name}</span>
                                {isSelected && <CheckCircle2 className="w-4 h-4 text-amber-700 dark:text-amber-400" />}
                              </div>
                              <div className="text-[11px] text-muted-foreground mt-0.5">{cust.mobile}</div>
                              <div className="text-[10px] text-muted-foreground truncate mt-1">{cust.address || "No address on file"}</div>
                            </div>
                          );
                        })
                      )}
                    </div>
                  </div>
                ) : (
                  <div className="space-y-3 bg-card/40 p-4 rounded-xl border border-border">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div>
                        <label className="text-[11px] text-muted-foreground block mb-1">Customer Full Name *</label>
                        <Input
                          placeholder="e.g. Rajesh Sharma / Infosys Corporate"
                          value={newCustomerName}
                          onChange={(e) => setNewCustomerName(e.target.value)}
                          className="bg-card border-border text-xs h-9 placeholder:text-muted-foreground"
                        />
                      </div>
                      <div>
                        <label className="text-[11px] text-muted-foreground block mb-1">Mobile Number *</label>
                        <Input
                          placeholder="e.g. +91 98450 12345 (10 digits)"
                          value={newCustomerMobile}
                          onChange={(e) => setNewCustomerMobile(e.target.value)}
                          className="bg-card border-border text-xs h-9 font-mono placeholder:text-muted-foreground"
                        />
                      </div>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div>
                        <label className="text-[11px] text-muted-foreground block mb-1">WhatsApp Number</label>
                        <Input
                          placeholder="e.g. +91 98450 12345 (for booking updates)"
                          value={newCustomerWhatsapp}
                          onChange={(e) => setNewCustomerWhatsapp(e.target.value)}
                          className="bg-card border-border text-xs h-9 font-mono placeholder:text-muted-foreground"
                        />
                      </div>
                      <div>
                        <label className="text-[11px] text-muted-foreground block mb-1">Customer Address</label>
                        <Input
                          placeholder="e.g. #42, 100ft Road, Indiranagar, Bengaluru - 560038"
                          value={newCustomerAddress}
                          onChange={(e) => setNewCustomerAddress(e.target.value)}
                          className="bg-card border-border text-xs h-9 placeholder:text-muted-foreground"
                        />
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* STEP 2: TRIP TYPE & SCHEDULE */}
            {step === 2 && (
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-bold text-foreground">Trip Category & Schedule</h3>
                  {isRound && (
                    <span className="text-[11px] font-mono font-bold text-amber-700 dark:text-amber-400 bg-amber-100 dark:bg-amber-400/10 px-2.5 py-1 rounded border border-amber-300 dark:border-amber-400/30">
                      Calculated Billable Days: {billableDays} Day(s)
                    </span>
                  )}
                </div>

                {/* Trip Type Selector */}
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
                  {[
                    { id: "single_trip", label: "Single Trip", desc: "Point-to-point one way" },
                    { id: "round_trip", label: "Round Trip", desc: "Return to origin with toll breakdown" },
                    { id: "outstation_round_trip", label: "Outstation Round", desc: "Multi-day outstation" },
                    { id: "outstation_one_way", label: "Outstation Drop", desc: "One-way outstation transfer" },
                    { id: "local_rental", label: "Local Rental", desc: "8 Hr / 80 Km package" },
                    { id: "airport_transfer", label: "Airport Run", desc: "Pickup / drop transfer" },
                  ].map((t) => {
                    const isSelected = tripType === t.id;
                    return (
                      <div
                        key={t.id}
                        onClick={() => setTripType(t.id as any)}
                        className={`p-3 rounded-xl border cursor-pointer text-left transition-all ${
                          isSelected
                            ? "bg-amber-950/40 border-amber-400 text-foreground"
                            : "bg-card/60 border-border hover:border-border text-muted-foreground"
                        }`}
                      >
                        <div className="font-bold text-xs flex items-center justify-between">
                          <span>{t.label}</span>
                          {isSelected && <CheckCircle2 className="w-3.5 h-3.5 text-amber-700 dark:text-amber-400" />}
                        </div>
                        <div className="text-[10px] text-muted-foreground mt-1">{t.desc}</div>
                      </div>
                    );
                  })}
                </div>

                {/* Dates & Times */}
                <div className="bg-card/40 p-4 rounded-xl border border-border space-y-3">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div className="space-y-2">
                      <label className="text-xs font-semibold text-foreground flex items-center gap-1.5">
                        <Calendar className="w-3.5 h-3.5 text-amber-700 dark:text-amber-400" /> Start Date & Time *
                      </label>
                      <div className="grid grid-cols-2 gap-2">
                        <Input
                          type="date"
                          value={startDate}
                          onChange={(e) => setStartDate(e.target.value)}
                          className="bg-card border-border text-xs h-9"
                        />
                        <Input
                          type="time"
                          value={startTime}
                          onChange={(e) => setStartTime(e.target.value)}
                          className="bg-card border-border text-xs h-9"
                        />
                      </div>
                    </div>

                    {isRound && (
                      <div className="space-y-2">
                        <label className="text-xs font-semibold text-foreground flex items-center gap-1.5">
                          <Calendar className="w-3.5 h-3.5 text-purple-700 dark:text-purple-400" /> Return Date & Time *
                        </label>
                        <div className="grid grid-cols-2 gap-2">
                          <Input
                            type="date"
                            value={returnDate}
                            onChange={(e) => setReturnDate(e.target.value)}
                            className="bg-card border-border text-xs h-9"
                          />
                          <Input
                            type="time"
                            value={returnTime}
                            onChange={(e) => setReturnTime(e.target.value)}
                            className="bg-card border-border text-xs h-9"
                          />
                        </div>
                      </div>
                    )}
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
                    <div>
                      <label className="text-[11px] text-muted-foreground block mb-1">Passenger Count</label>
                      <Input
                        type="number"
                        min={1}
                        max={50}
                        value={passengerCount || ""}
                        onChange={(e) => setPassengerCount(Number(e.target.value))}
                        className="bg-card border-border text-xs h-9 font-mono"
                      />
                    </div>
                    <div>
                      <label className="text-[11px] text-muted-foreground block mb-1">Special Passenger Instructions</label>
                      <Input
                        placeholder="e.g. Keep AC turned on, 2 mineral water bottles, passenger luggage assistance"
                        value={specialInstructions}
                        onChange={(e) => setSpecialInstructions(e.target.value)}
                        className="bg-card border-border text-xs h-9 placeholder:text-muted-foreground"
                      />
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* STEP 3: ROUTE & DIRECT DISTANCE (Map preview + 100% Dynamic & Editable) */}
            {step === 3 && (
              <div className="space-y-4">
                <div>
                  <h3 className="text-sm font-bold text-foreground">Route & Driving Distance</h3>
                  <p className="text-xs text-muted-foreground mt-0.5">Enter pickup, destination, stops, and specify the road distance in KM.</p>
                </div>

                {/* Pickup & Destination Inputs (Zero autofill) */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 bg-card/40 p-4 rounded-xl border border-border">
                  <LocationPicker
                    label="Pickup Location *"
                    accent="emerald"
                    searchPlaceholder="Type pickup place (e.g. Kempegowda Airport, Indiranagar, MG Road)..."
                    value={pickupInput}
                    onInputChange={(text) => {
                      setPickupInput(text);
                      setPickupLocation(null);
                    }}
                    onSelect={(place) => {
                      setPickupLocation(place);
                    }}
                  />

                  <LocationPicker
                    label="Destination *"
                    accent="amber"
                    searchPlaceholder="Type destination (e.g. Mysore Palace, Ooty, Coorg, Chennai Central)..."
                    value={destInput}
                    onInputChange={(text) => {
                      setDestInput(text);
                      setDestLocation(null);
                    }}
                    onSelect={(place) => {
                      setDestLocation(place);
                    }}
                  />
                </div>

                {/* Intermediate Stops */}
                <div className="space-y-2 bg-card/40 p-4 rounded-xl border border-border">
                  <label className="text-xs font-semibold text-foreground block">Waypoints & Intermediate Stops (Optional)</label>
                  <div className="relative" ref={stopSearchBoxRef}>
                    <div className="flex gap-2">
                      <Input
                        placeholder="Search a place (e.g. Mandya, Maddur Tiffany's, Channapatna Toys)..."
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
                        className="bg-card border-border text-xs h-9 placeholder:text-muted-foreground"
                      />
                      <Button
                        size="sm"
                        type="button"
                        onClick={handleAddStop}
                        className="bg-muted hover:bg-muted text-foreground text-xs h-9 cursor-pointer"
                      >
                        <Plus className="w-3.5 h-3.5 mr-1" /> Add
                      </Button>
                    </div>
                    {stopSearching && (
                      <span className="text-[10px] text-muted-foreground absolute right-20 top-2.5">Searching...</span>
                    )}
                    {stopSuggestions.length > 0 && (
                      <div className="absolute z-20 left-0 right-18.5 top-10 bg-card border border-border rounded-xl overflow-hidden shadow-2xl max-h-48 overflow-y-auto">
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
                    Pick a search result to route through and pin it accurately on the map — typing free text with no result selected won't appear on the map.
                  </p>

                  {stops.length > 0 && (
                    <div className="flex flex-wrap gap-2 pt-2">
                      {stops.map((stop, idx) => (
                        <div key={idx} className="flex items-center gap-1.5 bg-muted/90 text-foreground px-2.5 py-1 rounded-lg text-xs border border-border">
                          <span className="text-[10px] text-amber-700 dark:text-amber-400 font-mono">#{idx + 1}</span>
                          {(stop.lat || stop.latitude) && (
                            <MapPin className="w-3 h-3 text-emerald-700 dark:text-emerald-400 shrink-0" />
                          )}
                          <span>{stop.name}</span>
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

                {/* Route & Toll Map Preview (Google Maps-style, driving polyline + live toll estimate) */}
                {pickupInput.trim() && destInput.trim() && (
                  <RealtimeFleetMap
                    pickup={pickupLocation || { name: pickupInput }}
                    destination={destLocation || { name: destInput }}
                    stops={stops}
                    tripType={tripType}
                    height="300px"
                    showLiveTelemetry
                    showRoutePolyline
                    interactive
                    billingKm={distanceKm}
                    totalMapKm={distanceKm}
                    outboundDistanceKm={outboundKm}
                    returnDistanceKm={returnKm}
                    outboundDurationMinutes={outboundDurationMinutes}
                    returnDurationMinutes={returnDurationMinutes}
                    routeCoordinates={routeCoordinates}
                    outboundCoordinates={outboundCoordinates}
                    returnCoordinates={returnCoordinates}
                    estimatedToll={estimatedToll || finalToll}
                    tollStatus={tollStatus}
                    tollPlazas={displayedTollPlazas}
                  />
                )}

                {/* Auto-Estimate Distance & Toll (recalculates from the map above) */}
                <Button
                  size="sm"
                  variant="outline"
                  onClick={handleAutoEstimateDistance}
                  disabled={calculatingDistance}
                  className="w-full border-amber-300 dark:border-amber-500/40 text-amber-700 dark:text-amber-300 text-xs h-9 flex items-center justify-center gap-1.5 cursor-pointer hover:bg-amber-100 hover:dark:bg-amber-400/10"
                >
                  {calculatingDistance ? (
                    <ButtonLoader label="Calculating..." />
                  ) : (
                    <>
                      <Calculator className="w-3.5 h-3.5" /> Auto-Estimate Distance & Toll
                    </>
                  )}
                </Button>

                {/* With-Toll vs Toll-Free Route Choice */}
                {routeOptions.length > 1 && (
                  <div className="space-y-2">
                    <label className="text-xs font-semibold text-foreground block">Route Options — Toll vs Toll-Free</label>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                      {routeOptions.map((opt, idx) => (
                        <div
                          key={idx}
                          onClick={() => handleSelectRouteOption(idx)}
                          className={`p-3 rounded-xl border cursor-pointer transition-all space-y-1.5 ${
                            selectedRouteIdx === idx
                              ? "bg-amber-950/20 border-amber-400 ring-1 ring-amber-400/50"
                              : "bg-card/40 border-border hover:border-amber-300 dark:hover:border-amber-500/40"
                          }`}
                        >
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-xs font-bold text-foreground">
                              {idx === 0 ? "Fastest Route (via Toll)" : "Toll-Free Route"}
                            </span>
                            {selectedRouteIdx === idx && (
                              <CheckCircle2 className="w-3.5 h-3.5 text-amber-700 dark:text-amber-400 shrink-0" />
                            )}
                          </div>
                          {idx === 1 && opt.extraKm != null && (
                            <div className="text-[10px] text-muted-foreground">
                              +{opt.extraKm} km local detour to bypass toll — mostly overlaps the main route on the map
                            </div>
                          )}
                          <div className="grid grid-cols-3 gap-2 text-[11px] font-mono">
                            <div>
                              <span className="text-[9px] text-muted-foreground block uppercase">Distance</span>
                              <span className="font-bold text-foreground">{opt.distanceKm} KM</span>
                            </div>
                            <div>
                              <span className="text-[9px] text-muted-foreground block uppercase">Time</span>
                              <span className="font-bold text-sky-700 dark:text-sky-300">
                                {Math.floor(opt.durationMinutes / 60)}h {opt.durationMinutes % 60}m
                              </span>
                            </div>
                            <div>
                              <span className="text-[9px] text-muted-foreground block uppercase">Toll</span>
                              <span className="font-bold text-emerald-700 dark:text-emerald-400">
                                {opt.estimatedToll > 0 ? formatINR(opt.estimatedToll) : "Toll Free"}
                              </span>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Toll Plaza Breakdown — plazas along the route in the order the vehicle reaches them */}
                {displayedTollPlazas.length > 0 && (
                  <div className="bg-card/60 p-3 rounded-xl border border-border space-y-2">
                    <label className="text-xs font-semibold text-foreground flex items-center gap-1.5">
                      <MapPin className="w-3.5 h-3.5 text-amber-700 dark:text-amber-400" />
                      Toll Plazas on Route ({displayedTollPlazas.length})
                    </label>
                    {selectedRouteIdx === 0 && tollRateMode && tollRateMode !== "single" && (
                      <div className="text-[10px] text-muted-foreground -mt-1">
                        {tollRateMode === "round_trip_same_day"
                          ? "Return within 24 hrs → NHAI same-day return rate applied (≈ 1.5× one-way, not 2×)."
                          : "Return after 24 hrs → 24-hr concession doesn't apply; both crossings billed at full one-way rate."}
                      </div>
                    )}
                    <div className="space-y-1.5 max-h-40 overflow-y-auto pr-1">
                      {displayedTollPlazas.map((plaza: any, idx: number) => (
                        <div
                          key={plaza.id ?? idx}
                          className="flex items-center justify-between gap-2 text-[11px] bg-background/60 border border-border rounded-lg px-2.5 py-1.5"
                        >
                          <div className="min-w-0">
                            <div className="font-semibold text-foreground truncate">{plaza.name}</div>
                            <div className="text-[10px] text-muted-foreground font-mono">
                              {plaza.distanceAlongRouteKm != null ? `${plaza.distanceAlongRouteKm} km into route` : plaza.state || ""}
                            </div>
                          </div>
                          <span className="font-mono font-bold text-emerald-700 dark:text-emerald-400 shrink-0">
                            {formatINR(plaza.rate)}
                          </span>
                        </div>
                      ))}
                    </div>
                    <div className="flex items-center justify-between text-xs pt-1.5 border-t border-border">
                      <span className="text-muted-foreground">Total Toll (NHAI estimate)</span>
                      <span className="font-mono font-bold text-foreground">
                        {formatINR(displayedTollPlazas.reduce((sum: number, p: any) => sum + (p.rate || 0), 0))}
                      </span>
                    </div>
                  </div>
                )}

                {/* Direct Editable Road Distance & Billing KM */}
                <div className="bg-card/60 p-4 rounded-xl border border-amber-300 dark:border-amber-500/40 bg-amber-950/10 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-amber-700 dark:text-amber-400 uppercase tracking-wider flex items-center gap-1.5">
                      <Calculator className="w-4 h-4" /> Road Distance & Billable Volume
                    </span>
                    <span className="text-[11px] font-mono text-muted-foreground">
                      Minimum Billable: {commercialFare.minimumBillableKm} KM
                    </span>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <div>
                      <label className="text-[11px] text-foreground block mb-1">
                        Total Road Distance (KM) *
                      </label>
                      <Input
                        type="number"
                        min={0}
                        value={distanceKm || ""}
                        onChange={(e) => {
                          // The billable-KM calc actually derives its total from
                          // outboundKm + returnKm, not from this field directly —
                          // so a manual edit here has to clear those stale
                          // auto-estimated halves too, or they silently override
                          // whatever the user just typed.
                          setDistanceKm(Math.max(0, Number(e.target.value)));
                          setOutboundKm(0);
                          setReturnKm(0);
                        }}
                        placeholder="e.g. 350"
                        className="bg-card border-border text-sm h-10 font-mono font-bold text-amber-700 dark:text-amber-400 placeholder:text-muted-foreground"
                      />
                    </div>
                    <div>
                      <label className="text-[11px] text-muted-foreground block mb-1">
                        Effective Billable KM
                      </label>
                      <div className="h-10 px-3 flex items-center font-mono font-bold text-sm bg-background border border-border rounded-md text-emerald-700 dark:text-emerald-400">
                        {commercialFare.totalBillableDistance} KM
                      </div>
                    </div>
                    <div>
                      <label className="text-[11px] text-muted-foreground block mb-1">
                        Toll Charge (₹)
                      </label>
                      <Input
                        type="number"
                        min={0}
                        value={finalToll || ""}
                        onChange={(e) => setFinalToll(Math.max(0, Number(e.target.value)))}
                        placeholder="e.g. 450"
                        className="bg-card border-border text-sm h-10 font-mono font-bold text-foreground placeholder:text-muted-foreground"
                      />
                    </div>
                  </div>

                  {/* Odometer when leaving the stand + Photo */}
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-3 border-t border-amber-300/60 dark:border-amber-500/20">
                    <div>
                      <label className="text-[11px] text-foreground mb-1 flex items-center gap-1">
                        <Gauge className="w-3.5 h-3.5 text-amber-700 dark:text-amber-400" /> Odometer at Stand (KM){!isEditing && " *"}
                      </label>
                      <Input
                        type="number"
                        min={0}
                        inputMode="decimal"
                        value={odometerKm}
                        onChange={(e) => setOdometerKm(e.target.value)}
                        placeholder="e.g. 45120"
                        className="bg-card border-border text-sm h-10 font-mono font-bold text-foreground placeholder:text-muted-foreground"
                      />
                      <p className="text-[10px] text-muted-foreground mt-1">
                        Meter when leaving the stand. Used to track stand → pickup KM (not billed).
                      </p>
                    </div>
                    <div className="sm:col-span-2">
                      <label className="text-[11px] text-foreground mb-1 flex items-center gap-1">
                        <Camera className="w-3.5 h-3.5 text-amber-700 dark:text-amber-400" /> Stand Odometer Photo{!isEditing && " *"}
                      </label>
                      <input
                        ref={odometerFileInputRef}
                        type="file"
                        accept={ACCEPTED_ODOMETER_PHOTO_TYPES.join(",")}
                        onChange={handlePickOdometerPhoto}
                        className="hidden"
                      />
                      {odometerPhotoPreview || odometerPhotoUrl ? (
                        <div className="flex items-center gap-3">
                          <a
                            href={odometerPhotoPreview || odometerPhotoUrl || undefined}
                            target="_blank"
                            rel="noreferrer"
                            className="block shrink-0"
                          >
                            <img
                              src={odometerPhotoPreview || odometerPhotoUrl || undefined}
                              alt="Odometer"
                              className="h-16 w-24 object-cover rounded-lg border border-border"
                            />
                          </a>
                          <div className="flex flex-col gap-1.5">
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              onClick={() => odometerFileInputRef.current?.click()}
                              className="h-7 text-[11px] border-border cursor-pointer"
                            >
                              <Camera className="w-3 h-3 mr-1" /> Replace
                            </Button>
                            <Button
                              type="button"
                              size="sm"
                              variant="ghost"
                              onClick={handleRemoveOdometerPhoto}
                              className="h-7 text-[11px] text-rose-700 dark:text-rose-400 cursor-pointer"
                            >
                              <X className="w-3 h-3 mr-1" /> Remove
                            </Button>
                          </div>
                        </div>
                      ) : (
                        <Button
                          type="button"
                          variant="outline"
                          onClick={() => odometerFileInputRef.current?.click()}
                          className="w-full h-10 border-dashed border-amber-300 dark:border-amber-500/40 text-amber-700 dark:text-amber-300 text-xs cursor-pointer hover:bg-amber-100 hover:dark:bg-amber-400/10"
                        >
                          <Camera className="w-3.5 h-3.5 mr-1.5" /> Capture / Upload Odometer Photo
                        </Button>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* STEP 4: COMMERCIAL FARE ENGINE & TRANSPARENT BREAKDOWN */}
            {step === 4 && (
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="text-sm font-bold text-foreground flex items-center gap-2">
                      <IndianRupee className="w-4 h-4 text-amber-700 dark:text-amber-400" />
                      Commercial Pricing Engine & Transparent Calculation
                    </h3>
                    <p className="text-[11px] text-muted-foreground">
                      100% dynamic distance-rate calculation with state permits and real tolls.
                    </p>
                  </div>
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                  {/* Left Column: Editable Rates & Surcharges */}
                  <div className="space-y-3 bg-card/50 p-4 rounded-xl border border-border text-xs">
                    <span className="text-xs font-bold text-amber-700 dark:text-amber-400 uppercase tracking-wider block">
                      Commercial Rate Parameters
                    </span>

                    {/* Pricing Mode Switch: Rate per KM vs flat Total Package Rate */}
                    <div className="flex items-center justify-between bg-background/70 border border-border rounded-lg px-3 py-2.5">
                      <div>
                        <span className={`text-[11px] font-bold ${pricingMode === "per_km" ? "text-amber-700 dark:text-amber-400" : "text-muted-foreground"}`}>
                          Rate per KM
                        </span>
                        <span className="text-[10px] text-muted-foreground mx-1.5">/</span>
                        <span className={`text-[11px] font-bold ${pricingMode === "package" ? "text-amber-700 dark:text-amber-400" : "text-muted-foreground"}`}>
                          Total Package Rate
                        </span>
                        <p className="text-[10px] text-muted-foreground mt-0.5">
                          {pricingMode === "package"
                            ? "Flat package amount — toll/parking/tax still apply on top."
                            : "Fare computed from billable KM × rate, with day-minimum enforcement."}
                        </p>
                      </div>
                      <Switch
                        checked={pricingMode === "package"}
                        onCheckedChange={(checked) => setPricingMode(checked ? "package" : "per_km")}
                      />
                    </div>

                    {pricingMode === "package" ? (
                      <div>
                        <label className="text-[11px] text-foreground block mb-1">Total Package Amount (₹) *</label>
                        <Input
                          type="number"
                          value={packageTotal || ""}
                          onChange={(e) => setPackageTotal(Number(e.target.value))}
                          placeholder="e.g. 12000"
                          className="bg-card border-border text-xs h-9 font-mono font-bold text-amber-700 dark:text-amber-400 placeholder:text-muted-foreground"
                        />
                      </div>
                    ) : (
                      <div>
                        <label className="text-[11px] text-foreground block mb-1">Rate Per KM (₹) *</label>
                        <Input
                          type="number"
                          value={ratePerKm || ""}
                          onChange={(e) => setRatePerKm(Number(e.target.value))}
                          className="bg-card border-border text-xs h-9 font-mono font-bold text-amber-700 dark:text-amber-400"
                        />
                      </div>
                    )}

                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="text-[11px] text-foreground block mb-1">State Permit (₹)</label>
                        <Input
                          type="number"
                          value={permitCharge || ""}
                          onChange={(e) => setPermitCharge(Number(e.target.value))}
                          className="bg-card border-border text-xs h-9 font-mono"
                        />
                      </div>
                      <div>
                        <label className="text-[11px] text-foreground block mb-1">Final Toll (₹)</label>
                        <Input
                          type="number"
                          value={finalToll || ""}
                          onChange={(e) => setFinalToll(Number(e.target.value))}
                          className="bg-card border-border text-xs h-9 font-mono"
                        />
                      </div>
                    </div>

                    <div className="grid grid-cols-3 gap-2">
                      <div>
                        <label className="text-[10px] text-muted-foreground block mb-1">Parking (₹)</label>
                        <Input
                          type="number"
                          value={parking || ""}
                          onChange={(e) => setParking(Number(e.target.value))}
                          className="bg-card border-border text-xs h-8 font-mono"
                        />
                      </div>
                      <div>
                        <label className="text-[10px] text-muted-foreground block mb-1">Waiting (₹)</label>
                        <Input
                          type="number"
                          value={waitingCharge || ""}
                          onChange={(e) => setWaitingCharge(Number(e.target.value))}
                          className="bg-card border-border text-xs h-8 font-mono"
                        />
                      </div>
                      <div>
                        <label className="text-[10px] text-muted-foreground block mb-1">Discount (₹)</label>
                        <Input
                          type="number"
                          value={discount || ""}
                          onChange={(e) => setDiscount(Number(e.target.value))}
                          className="bg-card border-border text-xs h-8 font-mono text-rose-700 dark:text-rose-400"
                        />
                      </div>
                    </div>

                    {/* Driver Commission — internal ops figure, never shown
                        to the customer and never affects Customer Total Fare. */}
                    <div className="pt-1 border-t border-border/80 space-y-3">
                      <div className="flex items-center justify-between bg-background/70 border border-border rounded-lg px-3 py-2.5">
                        <div>
                          <span className={`text-[11px] font-bold ${driverCommissionType === "percentage" ? "text-amber-700 dark:text-amber-400" : "text-muted-foreground"}`}>
                            Commission %
                          </span>
                          <span className="text-[10px] text-muted-foreground mx-1.5">/</span>
                          <span className={`text-[11px] font-bold ${driverCommissionType === "flat" ? "text-amber-700 dark:text-amber-400" : "text-muted-foreground"}`}>
                            Flat Value
                          </span>
                          <p className="text-[10px] text-muted-foreground mt-0.5">Driver Commission (internal — not billed to customer)</p>
                        </div>
                        <Switch
                          checked={driverCommissionType === "flat"}
                          onCheckedChange={(checked) => setDriverCommissionType(checked ? "flat" : "percentage")}
                        />
                      </div>

                      <div>
                        <label className="text-[11px] text-foreground block mb-1">
                          {driverCommissionType === "flat" ? "Commission Amount (₹)" : "Commission (% of Customer Total)"}
                        </label>
                        <Input
                          type="number"
                          value={driverCommissionValue || ""}
                          onChange={(e) => setDriverCommissionValue(Math.max(0, Number(e.target.value)))}
                          placeholder={driverCommissionType === "flat" ? "e.g. 500" : "e.g. 10"}
                          className="bg-card border-border text-xs h-9 font-mono font-bold text-foreground placeholder:text-muted-foreground"
                        />
                      </div>
                    </div>
                  </div>

                  {/* Right Column: Live Itemized Fare Ledger */}
                  <div className="bg-card/80 border border-border rounded-xl p-4 flex flex-col justify-between text-xs space-y-3">
                    <div className="space-y-2">
                      <div className="flex justify-between items-center border-b border-border pb-2">
                        <span className="font-bold text-foreground">
                          {pricingMode === "package" ? "Package Basis:" : "Billable Volume:"}
                        </span>
                        <span className="font-mono text-foreground">
                          {pricingMode === "package"
                            ? `Flat total (${commercialFare.totalBillableDistance} KM travelled)`
                            : `${commercialFare.totalBillableDistance} KM @ ₹${ratePerKm}/km`}
                        </span>
                      </div>
                      <div className="flex justify-between items-center text-muted-foreground">
                        <span>{pricingMode === "package" ? "Package Fare:" : "Base Distance Fare:"}</span>
                        <span className="font-mono text-foreground">{formatINR(baseFare)}</span>
                      </div>
                      {(finalToll > 0 || permitCharge > 0) && (
                        <div className="flex justify-between items-center text-muted-foreground">
                          <span>Toll & Permit:</span>
                          <span className="font-mono text-foreground">{formatINR(finalToll + permitCharge)}</span>
                        </div>
                      )}
                      {(parking > 0 || waitingCharge > 0) && (
                        <div className="flex justify-between items-center text-muted-foreground">
                          <span>Parking & Waiting:</span>
                          <span className="font-mono text-foreground">{formatINR(parking + waitingCharge)}</span>
                        </div>
                      )}
                      {discount > 0 && (
                        <div className="flex justify-between items-center text-rose-700 dark:text-rose-400">
                          <span>Discount Applied:</span>
                          <span className="font-mono">- {formatINR(discount)}</span>
                        </div>
                      )}
                    </div>

                    <div className="pt-3 border-t border-border space-y-2">
                      <div className="flex justify-between items-center text-muted-foreground">
                        <span>Subtotal:</span>
                        <span className="font-mono font-bold text-foreground">{formatINR(commercialFare.subtotal)}</span>
                      </div>
                      <div className="flex justify-between items-center bg-background p-3 rounded-lg border border-amber-300 dark:border-amber-500/30">
                        <span className="font-black text-xs text-amber-700 dark:text-amber-400 uppercase">Customer Total Fare:</span>
                        <span className="text-xl font-black font-mono text-emerald-700 dark:text-emerald-400">{formatINR(customerTotal)}</span>
                      </div>
                      {driverCommissionValue > 0 && (
                        <div className="flex justify-between items-center bg-purple-950/10 p-2.5 rounded-lg border border-purple-300 dark:border-purple-500/30">
                          <span className="text-[11px] font-bold text-purple-700 dark:text-purple-400 uppercase">
                            Driver Commission {driverCommissionType === "percentage" ? `(${driverCommissionValue}%)` : "(Flat)"}:
                          </span>
                          <span className="font-mono font-bold text-purple-700 dark:text-purple-300">{formatINR(driverCommissionAmount)}</span>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* STEP 5: DRIVER, FLEET ASSIGNMENT & DISPATCH */}
            {step === 5 && (
              <div className="space-y-4">
                <h3 className="text-sm font-bold text-foreground">Driver Roster & Advance Payment</h3>

                {/* Driver & Vehicle Selector */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="space-y-2">
                    <label className="text-xs font-bold text-foreground">Assign Operational Driver</label>
                    <Select
                      value={selectedDriverId ? String(selectedDriverId) : "unassigned"}
                      onValueChange={(val) => {
                        const dId = val === "unassigned" ? null : Number(val);
                        setSelectedDriverId(dId);
                        if (dId) {
                          const matchedV = vehicles.find((v: any) => v.assignedDriverId === dId);
                          if (matchedV) setSelectedVehicleId(matchedV.id);
                        }
                      }}
                    >
                      <SelectTrigger className="bg-card border-border text-xs h-10">
                        <SelectValue placeholder="Select driver..." />
                      </SelectTrigger>
                      <SelectContent className="bg-card border-border text-foreground">
                        <SelectItem value="unassigned">Unassigned (Assign Later)</SelectItem>
                        {drivers.map((d) => (
                          <SelectItem key={d.id} value={String(d.id)}>
                            {d.name} ({d.driverCode}) • Rating {d.rating} • Status: {d.availability}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-2">
                    <label className="text-xs font-bold text-foreground">Assign Commercial Vehicle</label>
                    <Select
                      value={selectedVehicleId ? String(selectedVehicleId) : "unassigned"}
                      onValueChange={(val) => setSelectedVehicleId(val === "unassigned" ? null : Number(val))}
                    >
                      <SelectTrigger className="bg-card border-border text-xs h-10">
                        <SelectValue placeholder="Select fleet vehicle..." />
                      </SelectTrigger>
                      <SelectContent className="bg-card border-border text-foreground">
                        <SelectItem value="unassigned">Unassigned (Assign Later)</SelectItem>
                        {vehicles.map((v: any) => (
                          <SelectItem key={v.id} value={String(v.id)}>
                            {v.vehicleNumber} ({v.brand} {v.model}) • {v.capacity} Seater
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                {/* Advance Collection — editing a trip never records a new advance here;
                    use the separate Record Payment action for that. */}
                {!isEditing && (
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 bg-card/40 p-4 rounded-xl border border-border">
                    <div>
                      <label className="text-[11px] text-muted-foreground block mb-1">Advance Amount (₹)</label>
                      <Input
                        type="number"
                        value={advanceAmount || ""}
                        onChange={(e) => setAdvanceAmount(Number(e.target.value))}
                        className="bg-card border-border text-xs h-9 font-mono"
                      />
                    </div>
                    <div>
                      <label className="text-[11px] text-muted-foreground block mb-1">Payment Method</label>
                      <Select value={paymentMethod} onValueChange={setPaymentMethod}>
                        <SelectTrigger className="bg-card border-border text-xs h-9">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent className="bg-card border-border text-foreground">
                          <SelectItem value="UPI">UPI / GPay / PhonePe</SelectItem>
                          <SelectItem value="Cash">Cash</SelectItem>
                          <SelectItem value="Card">Credit / Debit Card</SelectItem>
                          <SelectItem value="Bank Transfer">Bank Transfer (NEFT/IMPS)</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div>
                      <label className="text-[11px] text-muted-foreground block mb-1">Payment Reference / UTR</label>
                      <Input
                        placeholder="e.g. UPI Ref / UTR: 429188201992"
                        value={paymentReference}
                        onChange={(e) => setPaymentReference(e.target.value)}
                        className="bg-card border-border text-xs h-9 font-mono placeholder:text-muted-foreground"
                      />
                    </div>
                  </div>
                )}
                {isEditing && (
                  <p className="text-[11px] text-muted-foreground bg-card/40 p-3 rounded-xl border border-border">
                    Payments already recorded on this trip are unaffected by editing. Use "Record Payment" from the trip's page to log a new payment.
                  </p>
                )}

                <div className="flex justify-between items-center p-3.5 rounded-xl bg-card border border-border text-xs font-mono">
                  <div>
                    <span className="text-muted-foreground block">Total Fare: {formatINR(customerTotal)}</span>
                    <span className="text-emerald-700 dark:text-emerald-400 block">
                      {isEditing ? "Already Paid" : "Advance Paid"}: {formatINR(totalPaidForCalc)}
                    </span>
                  </div>
                  <div className="text-right">
                    <span className="text-muted-foreground text-[10px] block uppercase">Remaining Balance Due</span>
                    <span className="text-amber-700 dark:text-amber-300 font-bold text-base">{formatINR(remainingBalance)}</span>
                  </div>
                </div>

                {/* Final Route & Schedule Summary */}
                <div className="bg-card/60 p-3 rounded-xl border border-border/80 text-xs space-y-1">
                  <div className="text-foreground font-medium flex items-center gap-1.5">
                    <Navigation className="w-3.5 h-3.5 text-amber-700 dark:text-amber-400" />
                    <span>{pickupInput} ➔ {destInput}</span>
                  </div>
                  <div className="text-muted-foreground text-[11px]">
                    {startDate} at {startTime} • {tripType.replaceAll("_", " ")} • {commercialFare.totalBillableDistance} Billable KM
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Dialog Action Buttons */}
          <div className="flex justify-between items-center pt-3 border-t border-border">
            {step > 1 ? (
              <Button
                variant="outline"
                size="sm"
                onClick={handleBack}
                className="border-border hover:border-border text-foreground text-xs h-9 cursor-pointer"
              >
                <ArrowLeft className="w-3.5 h-3.5 mr-1" /> Back
              </Button>
            ) : (
              <Button
                variant="outline"
                size="sm"
                onClick={onClose}
                className="border-border text-muted-foreground text-xs h-9 cursor-pointer"
              >
                Cancel
              </Button>
            )}

            {step < 5 ? (
              <Button
                size="sm"
                onClick={handleNext}
                className="bg-amber-400 hover:bg-amber-300 text-zinc-950 font-bold text-xs h-9 px-4 cursor-pointer shadow-lg shadow-amber-400/20"
              >
                Next Step <ArrowRight className="w-3.5 h-3.5 ml-1" />
              </Button>
            ) : (
              <Button
                size="sm"
                onClick={handleSubmitBooking}
                disabled={loading}
                className="bg-emerald-400 hover:bg-emerald-300 text-zinc-950 font-black text-xs h-9 px-5 cursor-pointer shadow-lg shadow-emerald-400/20"
              >
                <CheckCircle2 className="w-4 h-4 mr-1.5" /> {isEditing ? "SAVE CHANGES" : "DISPATCH TRIP"}
              </Button>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
};
