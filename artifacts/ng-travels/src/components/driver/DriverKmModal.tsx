import { apiFetch } from "@/lib/apiFetch";
import React, { useRef, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Gauge, CheckCircle2, AlertCircle, Camera, X } from "lucide-react";
import { formatINR } from "@/lib/fareEngine";
import { Switch } from "@/components/ui/switch";
import { TripActionLoader, ButtonLoader } from "@/components/loading";

export interface DriverKmModalProps {
  isOpen: boolean;
  onClose: () => void;
  trip: any;
  // start: pickup reading · end: drop reading · stand: back at the stand
  mode: "start" | "end" | "stand";
  // Ops completing a trip: also captures the commercial figures after Ending KM
  ops?: boolean;
  onSuccess: (updatedTrip: any) => void | Promise<void>;
}

const MAX_PHOTO_BYTES = 8 * 1024 * 1024;
const ACCEPTED_PHOTO_TYPES = ["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"];

const MODE_TEXT = {
  start: {
    title: "Enter Starting Odometer KM",
    label: "Pickup Odometer Reading (KM)",
    submit: "Confirm & Start Trip",
    loading: "Starting your journey...",
  },
  end: {
    title: "Enter Ending Odometer KM",
    label: "Ending Odometer Reading (KM)",
    submit: "Validate & Complete Trip",
    loading: "Completing trip...",
  },
  stand: {
    title: "Back at Stand — Odometer KM",
    label: "Odometer Reading at Stand (KM)",
    submit: "Save Back-at-Stand KM",
    loading: "Saving reading...",
  },
} as const;

export const DriverKmModal: React.FC<DriverKmModalProps> = ({
  isOpen,
  onClose,
  trip,
  mode,
  ops = false,
  onSuccess,
}) => {
  // Pre-fill with the previous reading in the chain (pickup for the drop,
  // drop for back-at-stand); the pickup reading starts blank on purpose so
  // the stand-out reading isn't submitted unchanged by mistake.
  const [kmValue, setKmValue] = useState<string>(() => {
    if (mode === "end" && trip?.status === "completed" && trip?.endingKm != null) return String(trip.endingKm);
    if (mode === "end" && trip?.startingKm != null) return String(trip.startingKm);
    if (mode === "stand") {
      if (trip?.standReturnKm != null) return String(trip.standReturnKm);
      if (trip?.endingKm != null) return String(trip.endingKm);
    }
    return "";
  });
  const showBilling = ops && mode === "end";
  // Driver completing: only trip extras (no rates, fares or totals)
  const driverExtras = !ops && mode === "end";
  const [toll, setToll] = useState<string>(() => String(Number(trip?.finalToll ?? trip?.toll ?? 0) || ""));
  // Trip already ended: only the commercial figures are editable
  const editBilling = showBilling && trip?.status === "completed";
  const [returnDate, setReturnDate] = useState<string>(
    () => String(trip?.returnDate || "").slice(0, 10) || new Date().toISOString().slice(0, 10),
  );
  const [pricingMode, setPricingMode] = useState<"per_km" | "package">(trip?.pricingMode === "package" ? "package" : "per_km");
  const [packageTotal, setPackageTotal] = useState<string>(() => String(Number(trip?.packageTotal || 0) || ""));
  const [ratePerKm, setRatePerKm] = useState<string>(() => String(Number(trip?.ratePerKm || 0) || ""));
  const [commissionType, setCommissionType] = useState<"percentage" | "flat">(
    trip?.driverCommissionType === "flat" ? "flat" : "percentage",
  );
  const [commissionValue, setCommissionValue] = useState<string>(() => String(Number(trip?.driverCommissionValue || 0) || ""));
  const [parking, setParking] = useState<string>(() => String(Number(trip?.parking || 0) || ""));
  const [waiting, setWaiting] = useState<string>(() => String(Number(trip?.waitingCharge || 0) || ""));
  const [discount, setDiscount] = useState<string>(() => String(Number(trip?.discount || 0) || ""));
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [photoPreviewUrl, setPhotoPreviewUrl] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  if (!trip) return null;

  const text = MODE_TEXT[mode];
  const enteredKm = Number(kmValue || 0);
  const standStartKm = trip.standStartKm != null ? Number(trip.standStartKm) : null;
  const startKm = Number(trip.startingKm || 0);
  const dropKm = Number(trip.endingKm || 0);
  // The reading this one can't go below, and the leg it closes
  const previous =
    mode === "start"
      ? standStartKm != null ? { label: "Left Stand At", km: standStartKm, leg: "Stand → Pickup KM" } : null
      : mode === "end"
      ? { label: "Recorded Starting KM", km: startKm, leg: "Calculated Actual KM" }
      : { label: "Drop KM", km: dropKm, leg: "Drop → Stand KM" };
  const isRoundTrip = String(trip.tripType || "").toLowerCase().includes("round");
  // Billable distance = odometer ending - starting
  const odometerKm = mode === "end" && enteredKm >= startKm ? Math.round((enteredKm - startKm) * 100) / 100 : 0;
  // Live fare, same arithmetic the complete endpoint applies
  const baseFare = pricingMode === "package"
    ? Number(packageTotal || 0)
    : Math.round(odometerKm * Number(ratePerKm || 0) * 100) / 100;
  const tollAmount = Number(trip.finalToll || 0);
  const permitAmount = Number(trip.permitCharge || 0);
  const extrasAmount = Number(parking || 0) + Number(waiting || 0);
  const discountAmount = Number(discount || 0);
  const subtotal = baseFare + tollAmount + permitAmount + extrasAmount;
  const customerTotal = Math.round((subtotal - discountAmount) * 100) / 100;
  const commissionAmount = commissionType === "flat"
    ? Number(commissionValue || 0)
    : Math.round(customerTotal * (Number(commissionValue || 0) / 100) * 100) / 100;
  const legKm = previous && enteredKm >= previous.km ? Math.round((enteredKm - previous.km) * 100) / 100 : 0;

  const handlePickPhoto = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ""; // allow re-capturing the same shot after removing it
    if (!file) return;

    if (!ACCEPTED_PHOTO_TYPES.includes(file.type)) {
      setError("Unsupported photo format — please retake with the camera.");
      return;
    }
    if (file.size > MAX_PHOTO_BYTES) {
      setError("That photo is too large — please retake it (must be under 8MB).");
      return;
    }

    setError(null);
    setPhotoFile(file);
    setPhotoPreviewUrl(URL.createObjectURL(file));
  };

  const handleRemovePhoto = () => {
    if (photoPreviewUrl) URL.revokeObjectURL(photoPreviewUrl);
    setPhotoFile(null);
    setPhotoPreviewUrl(null);
  };

  const handleSubmit = async () => {
    setError(null);
    if (editBilling) {
      if (pricingMode === "per_km" && !(Number(ratePerKm) > 0)) {
        setError("Please enter the rate per KM.");
        return;
      }
      if (pricingMode === "package" && !(Number(packageTotal) > 0)) {
        setError("Please enter the total package amount.");
        return;
      }
      setLoading(true);
      try {
        const res = await apiFetch(`/api/trips/${trip.id}/billing`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            pricingMode,
            packageTotal: Number(packageTotal || 0),
            ratePerKm: Number(ratePerKm || 0),
            parking: Number(parking || 0),
            waitingCharge: Number(waiting || 0),
            discount: Number(discount || 0),
            driverCommissionType: commissionType,
            driverCommissionValue: Number(commissionValue || 0),
            ...(isRoundTrip && { returnDate }),
          }),
        });
        if (!res.ok) {
          const errData = await res.json().catch(() => null);
          setError(errData?.error?.message || "Failed to update billing.");
          return;
        }
        await onSuccess(await res.json());
        onClose();
      } catch (err: any) {
        setError(err?.message || "Network error while saving billing.");
      } finally {
        setLoading(false);
      }
      return;
    }
    if (!kmValue || isNaN(Number(kmValue)) || Number(kmValue) <= 0) {
      setError("Please enter a valid positive odometer reading.");
      return;
    }

    if (previous && enteredKm < previous.km) {
      setError(`${text.label.replace(" (KM)", "")} (${enteredKm}) cannot be less than ${previous.label} (${previous.km}).`);
      return;
    }

    if (showBilling && pricingMode === "per_km" && !(Number(ratePerKm) > 0)) {
      setError("Please enter the rate per KM.");
      return;
    }
    if (showBilling && pricingMode === "package" && !(Number(packageTotal) > 0)) {
      setError("Please enter the total package amount.");
      return;
    }

    if (!photoFile) {
      setError("Please take a photo of the odometer reading before submitting.");
      return;
    }

    setLoading(true);
    try {
      // Upload the odometer photo first — the KM entry is only recorded
      // once we have a real photo URL to attach to it, same as the driver
      // expense flow requiring a receipt before the claim is submitted.
      const formData = new FormData();
      formData.append("file", photoFile);
      const uploadRes = await apiFetch(`/api/driver/trips/upload-km-photo`, {
        method: "POST",
        body: formData,
      });
      if (!uploadRes.ok) {
        const errData = await uploadRes.json().catch(() => null);
        throw new Error(errData?.error?.message || "Failed to upload the odometer photo.");
      }
      const { url: photoUrl } = await uploadRes.json();

      const endpoint = mode === "start"
        ? `/api/driver/trips/${trip.id}/start`
        : mode === "end"
        ? `/api/driver/trips/${trip.id}/complete`
        : `/api/trips/${trip.id}/stand-return`;

      const payload = mode === "start"
        ? { startingKm: Number(kmValue), photoUrl }
        : mode === "end"
        ? {
            endingKm: Number(kmValue),
            photoUrl,
            ...(driverExtras && {
              finalToll: Number(toll || 0),
              parking: Number(parking || 0),
              waitingCharge: Number(waiting || 0),
              ...(isRoundTrip && { returnDate }),
            }),
            ...(showBilling && {
              pricingMode,
              ...(pricingMode === "package"
                ? { packageTotal: Number(packageTotal || 0), ratePerKm: Number(ratePerKm || trip?.ratePerKm || 0) }
                : { ratePerKm: Number(ratePerKm || 0) }),
              parking: Number(parking || 0),
              waitingCharge: Number(waiting || 0),
              discount: Number(discount || 0),
              driverCommissionType: commissionType,
              driverCommissionValue: Number(commissionValue || 0),
              ...(isRoundTrip && { returnDate }),
            }),
          }
        : { standReturnKm: Number(kmValue), photoUrl };

      const res = await apiFetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => null);
        // error is usually { code, message } — never render the object itself
        setError(errData?.error?.message || (typeof errData?.error === "string" ? errData.error : null) || "Failed to update odometer.");
        return;
      }

      const updatedTrip = await res.json();
      // Awaited so the spinner (and this modal) stays up until the trip
      // list/current-trip queries actually refetch — otherwise the modal
      // closes and the driver briefly sees the OLD stage/button underneath
      // until the background refetch lands.
      await onSuccess(updatedTrip);
      handleRemovePhoto();
      onClose();
    } catch (err: any) {
      setError(err?.message || "Network error while submitting odometer reading.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      {loading && (
        <TripActionLoader
          action={mode === "start" ? "start" : "complete"}
          {...(mode === "stand" && {
            title: "Saving back-at-stand reading...",
            subtext: "Recording the stand odometer and drop to stand distance...",
          })}
        />
      )}

      <Dialog open={isOpen} onOpenChange={onClose}>
        <DialogContent className={`${showBilling || driverExtras ? "max-w-md max-h-[90vh] overflow-y-auto" : "max-w-sm"} bg-background text-foreground border-border p-5 rounded-xl`}>
          <DialogHeader>
            <DialogTitle className="text-base font-bold text-foreground flex items-center gap-2">
              <Gauge className="w-5 h-5 text-amber-700 dark:text-amber-400" />
              {editBilling ? "Edit Trip Billing" : text.title}
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4 pt-2 text-xs">
            <div className="bg-card/60 p-3 rounded-lg border border-border space-y-1">
              <div className="text-muted-foreground">Booking: <span className="font-mono text-amber-700 dark:text-amber-400 font-bold">{trip.bookingId}</span></div>
              <div className="text-foreground font-medium">{trip.pickup?.name} ➔ {trip.destination?.name}</div>
              {previous && (
                <div className="text-muted-foreground pt-1 border-t border-border flex justify-between">
                  <span>{previous.label}:</span>
                  <span className="font-mono font-bold text-foreground">{previous.km} km</span>
                </div>
              )}
            </div>

            {!editBilling && (
            <div>
              <label className="text-xs text-amber-700 dark:text-amber-400 font-semibold uppercase block mb-1.5">
                {text.label}
              </label>
              <Input
                type="number"
                value={kmValue}
                onChange={(e) => setKmValue(e.target.value)}
                placeholder="e.g. 82450"
                className="bg-card border-amber-300 dark:border-amber-500/50 text-xl font-mono font-bold text-amber-700 dark:text-amber-400 text-center py-6"
              />
            </div>
            )}

            {previous && !editBilling && (
              <div className="bg-amber-950/20 border border-amber-300 dark:border-amber-500/30 rounded-lg p-3 flex justify-between items-center text-xs">
                <span className="text-muted-foreground">{previous.leg}:</span>
                <span className="text-lg font-mono font-bold text-emerald-700 dark:text-emerald-400">
                  {legKm} km
                </span>
              </div>
            )}

            {driverExtras && (
              <div className="space-y-3 bg-card/60 p-3 rounded-lg border border-border">
                {isRoundTrip && (
                  <div>
                    <label className="text-[11px] text-foreground block mb-1">Return Date</label>
                    <Input type="date" value={returnDate} onChange={(e) => setReturnDate(e.target.value)} className="bg-card border-border text-xs h-9" />
                  </div>
                )}
                <div>
                  <label className="text-[11px] text-foreground block mb-1">Total Distance (KM)</label>
                  <div className="h-9 px-3 flex items-center font-mono font-bold text-sm bg-background border border-border rounded-md text-emerald-700 dark:text-emerald-400">
                    {odometerKm} KM
                  </div>
                  <p className="text-[10px] text-muted-foreground mt-1">Ending KM - Starting KM ({startKm}).</p>
                </div>
                <div className="grid grid-cols-3 gap-2">
                  <div>
                    <label className="text-[10px] text-muted-foreground block mb-1">Toll (₹)</label>
                    <Input type="number" min={0} value={toll} onChange={(e) => setToll(e.target.value)} className="bg-card border-border text-xs h-8 font-mono" />
                  </div>
                  <div>
                    <label className="text-[10px] text-muted-foreground block mb-1">Parking (₹)</label>
                    <Input type="number" min={0} value={parking} onChange={(e) => setParking(e.target.value)} className="bg-card border-border text-xs h-8 font-mono" />
                  </div>
                  <div>
                    <label className="text-[10px] text-muted-foreground block mb-1">Waiting (₹)</label>
                    <Input type="number" min={0} value={waiting} onChange={(e) => setWaiting(e.target.value)} className="bg-card border-border text-xs h-8 font-mono" />
                  </div>
                </div>
              </div>
            )}

            {showBilling && (
              <div className="space-y-3 bg-card/60 p-3 rounded-lg border border-border">
                {isRoundTrip && (
                  <div>
                    <label className="text-[11px] text-foreground block mb-1">Return Date</label>
                    <Input type="date" value={returnDate} onChange={(e) => setReturnDate(e.target.value)} className="bg-card border-border text-xs h-9" />
                  </div>
                )}
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-[11px] text-foreground block mb-1">Total Road Distance (KM) *</label>
                    <div className="h-9 px-3 flex items-center font-mono font-bold text-sm bg-background border border-border rounded-md text-amber-700 dark:text-amber-400">
                      {odometerKm} KM
                    </div>
                  </div>
                  <div>
                    <label className="text-[11px] text-muted-foreground block mb-1">Effective Billable KM</label>
                    <div className="h-9 px-3 flex items-center font-mono font-bold text-sm bg-background border border-border rounded-md text-emerald-700 dark:text-emerald-400">
                      {odometerKm} KM
                    </div>
                  </div>
                </div>
                <p className="text-[10px] text-muted-foreground -mt-1">Odometer: Ending KM - Starting KM ({startKm}).</p>
                <div className="flex items-center justify-between bg-background/70 border border-border rounded-lg px-3 py-2">
                  <span className="text-[11px] font-bold text-foreground">
                    {pricingMode === "package" ? "Total Package Rate" : "Rate per KM"}
                    <span className="block text-[10px] font-normal text-muted-foreground">
                      {pricingMode === "package" ? "Flat amount; toll/parking still apply on top" : "Odometer KM x rate"}
                    </span>
                  </span>
                  <Switch checked={pricingMode === "package"} onCheckedChange={(c) => setPricingMode(c ? "package" : "per_km")} />
                </div>
                {pricingMode === "package" ? (
                  <div>
                    <label className="text-[11px] text-foreground block mb-1">Total Package Amount (₹) *</label>
                    <Input type="number" value={packageTotal} onChange={(e) => setPackageTotal(e.target.value)} placeholder="e.g. 12000" className="bg-card border-border text-xs h-9 font-mono font-bold text-amber-700 dark:text-amber-400" />
                  </div>
                ) : (
                  <div>
                    <label className="text-[11px] text-foreground block mb-1">Rate Per KM (₹) *</label>
                    <Input type="number" value={ratePerKm} onChange={(e) => setRatePerKm(e.target.value)} className="bg-card border-border text-xs h-9 font-mono font-bold text-amber-700 dark:text-amber-400" />
                  </div>
                )}
                <div className="flex items-center justify-between bg-background/70 border border-border rounded-lg px-3 py-2">
                  <span className="text-[11px] font-bold text-foreground">
                    {commissionType === "flat" ? "Flat Value" : "Commission %"}
                    <span className="block text-[10px] font-normal text-muted-foreground">Driver commission (internal)</span>
                  </span>
                  <Switch checked={commissionType === "flat"} onCheckedChange={(c) => setCommissionType(c ? "flat" : "percentage")} />
                </div>
                <div>
                  <label className="text-[11px] text-foreground block mb-1">
                    {commissionType === "flat" ? "Commission Amount (₹)" : "Commission (% of Customer Total)"}
                  </label>
                  <Input type="number" min={0} value={commissionValue} onChange={(e) => setCommissionValue(e.target.value)} className="bg-card border-border text-xs h-9 font-mono" />
                </div>
                <div className="grid grid-cols-3 gap-2">
                  <div>
                    <label className="text-[10px] text-muted-foreground block mb-1">Parking (₹)</label>
                    <Input type="number" min={0} value={parking} onChange={(e) => setParking(e.target.value)} className="bg-card border-border text-xs h-8 font-mono" />
                  </div>
                  <div>
                    <label className="text-[10px] text-muted-foreground block mb-1">Waiting (₹)</label>
                    <Input type="number" min={0} value={waiting} onChange={(e) => setWaiting(e.target.value)} className="bg-card border-border text-xs h-8 font-mono" />
                  </div>
                  <div>
                    <label className="text-[10px] text-muted-foreground block mb-1">Discount (₹)</label>
                    <Input type="number" min={0} value={discount} onChange={(e) => setDiscount(e.target.value)} className="bg-card border-border text-xs h-8 font-mono text-rose-700 dark:text-rose-400" />
                  </div>
                </div>

                <div className="bg-background border border-border rounded-lg p-3 space-y-1.5">
                  <div className="flex justify-between border-b border-border pb-1.5">
                    <span className="font-bold text-foreground">{pricingMode === "package" ? "Package Basis:" : "Billable Volume:"}</span>
                    <span className="font-mono text-foreground">
                      {pricingMode === "package" ? `Flat total (${odometerKm} KM travelled)` : `${odometerKm} KM @ ₹${Number(ratePerKm || 0)}/km`}
                    </span>
                  </div>
                  <div className="flex justify-between text-muted-foreground">
                    <span>{pricingMode === "package" ? "Package Fare:" : "Base Distance Fare:"}</span>
                    <span className="font-mono text-foreground">{formatINR(baseFare)}</span>
                  </div>
                  {(tollAmount > 0 || permitAmount > 0) && (
                    <div className="flex justify-between text-muted-foreground">
                      <span>Toll & Permit:</span>
                      <span className="font-mono text-foreground">{formatINR(tollAmount + permitAmount)}</span>
                    </div>
                  )}
                  {extrasAmount > 0 && (
                    <div className="flex justify-between text-muted-foreground">
                      <span>Parking & Waiting:</span>
                      <span className="font-mono text-foreground">{formatINR(extrasAmount)}</span>
                    </div>
                  )}
                  {discountAmount > 0 && (
                    <div className="flex justify-between text-rose-700 dark:text-rose-400">
                      <span>Discount Applied:</span>
                      <span className="font-mono">- {formatINR(discountAmount)}</span>
                    </div>
                  )}
                  <div className="flex justify-between text-muted-foreground pt-1.5 border-t border-border">
                    <span>Subtotal:</span>
                    <span className="font-mono font-bold text-foreground">{formatINR(subtotal)}</span>
                  </div>
                  <div className="flex justify-between items-center bg-card p-2.5 rounded-lg border border-amber-300 dark:border-amber-500/30">
                    <span className="font-black text-[11px] text-amber-700 dark:text-amber-400 uppercase">Customer Total Fare:</span>
                    <span className="text-lg font-black font-mono text-emerald-700 dark:text-emerald-400">{formatINR(customerTotal)}</span>
                  </div>
                  {Number(commissionValue || 0) > 0 && (
                    <div className="flex justify-between items-center text-purple-700 dark:text-purple-400">
                      <span className="text-[11px] font-bold uppercase">Driver Commission {commissionType === "percentage" ? `(${commissionValue}%)` : "(Flat)"}:</span>
                      <span className="font-mono font-bold">{formatINR(commissionAmount)}</span>
                    </div>
                  )}
                </div>
              </div>
            )}

            {!editBilling && (
            <div>
              <label className="text-xs text-amber-700 dark:text-amber-400 font-semibold uppercase block mb-1.5">
                Upload Odometer Reading Image <span className="text-rose-600 dark:text-rose-400">*</span>
              </label>
              {/* accept="image/*" (no PDF/other types) + capture="environment"
                  together make Android launch the camera app directly with
                  no gallery/file-picker option — this must stay camera-only,
                  not a pick-from-gallery upload. */}
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                capture="environment"
                onChange={handlePickPhoto}
                className="hidden"
              />

              {!photoFile ? (
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="w-full flex flex-col items-center justify-center gap-1.5 py-5 rounded-xl border-2 border-dashed border-amber-300 dark:border-amber-500/40 bg-card/60 text-muted-foreground hover:bg-amber-950/10 hover:border-amber-400 transition-colors cursor-pointer"
                >
                  <Camera className="w-5 h-5 text-amber-700 dark:text-amber-400" />
                  <span className="text-[11px] font-semibold">Tap to photograph the odometer</span>
                  <span className="text-[10px] text-muted-foreground">Camera only · JPG/PNG/HEIC · up to 8MB</span>
                </button>
              ) : (
                <div className="flex items-center gap-2.5 p-2.5 rounded-xl border border-emerald-300 dark:border-emerald-500/40 bg-emerald-950/10">
                  <img src={photoPreviewUrl || undefined} alt="Odometer preview" className="w-12 h-12 object-cover rounded-lg border border-border shrink-0" />
                  <div className="min-w-0 flex-1">
                    <div className="text-[11px] font-semibold text-foreground truncate">{photoFile.name}</div>
                    <div className="text-[10px] text-emerald-700 dark:text-emerald-400 flex items-center gap-1">
                      <CheckCircle2 className="w-3 h-3" /> Captured
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={handleRemovePhoto}
                    className="text-muted-foreground hover:text-rose-700 hover:dark:text-rose-400 cursor-pointer p-1"
                    title="Retake photo"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              )}
            </div>
            )}

            {error && (
              <div className="bg-rose-950/40 border border-rose-300 dark:border-rose-500/40 rounded p-2.5 text-xs text-rose-700 dark:text-rose-300 flex items-center gap-2">
                <AlertCircle className="w-4 h-4 flex-shrink-0" />
                <span>{error}</span>
              </div>
            )}

            <Button
              type="button"
              onClick={handleSubmit}
              disabled={loading || (!editBilling && !photoFile)}
              className="w-full bg-amber-400 hover:bg-amber-300 text-zinc-950 font-bold py-5 text-sm disabled:opacity-50"
            >
              {loading ? (
                <ButtonLoader label={text.loading} />
              ) : (
                <>
                  <CheckCircle2 className="w-4 h-4 mr-1.5" />
                  {editBilling ? "Save Billing" : text.submit}
                </>
              )}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
};
