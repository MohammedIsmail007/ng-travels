import { apiFetch } from "@/lib/apiFetch";
import React, { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Car, Plus, Search, ShieldCheck, AlertTriangle, CheckCircle2,
  Calendar, Wrench, User, Fuel, Clock, FileText, Edit2, Trash2, X
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "sonner";
import { NGTravelsLoader } from "@/components/loading";
import { ConfirmDeleteDialog } from "@/components/common/ConfirmDeleteDialog";

export const VehiclesPage: React.FC = () => {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [filterType, setFilterType] = useState("all");
  const [addModalOpen, setAddModalOpen] = useState(false);
  const [editingVehicle, setEditingVehicle] = useState<any | null>(null);
  const [deletingVehicle, setDeletingVehicle] = useState<any | null>(null);

  // Form State
  const [formData, setFormData] = useState({
    vehicleNumber: "",
    vehicleType: "Innova Crysta",
    brand: "Toyota",
    model: "Innova Crysta 2.4 ZX",
    year: "2023",
    capacity: "7",
    fuelType: "Diesel",
    rcNumber: "",
    insurancePolicy: "",
    insuranceExpiry: "",
    permitNumber: "",
    permitExpiry: "",
    fitnessCertNumber: "",
    fitnessExpiry: "",
    pollutionCertNumber: "",
    pollutionExpiry: "",
    assignedDriverId: "",
    currentOdometerKm: "0",
    maintenanceStatus: "good",
    notes: "",
  });

  // Queries
  const { data: rawVehicles = [], isLoading } = useQuery({
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

  const { data: drivers = [] } = useQuery({
    queryKey: ["/api/drivers"],
    queryFn: async () => {
      const res = await apiFetch("/api/drivers");
      if (!res.ok) return [];
      return res.json();
    },
  });

  // Create Mutation
  const createMutation = useMutation({
    mutationFn: async (payload: any) => {
      const res = await apiFetch("/api/vehicles", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error("Failed to create vehicle");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/vehicles"] });
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard"] });
      toast.success("Vehicle registered successfully!");
      setAddModalOpen(false);
      resetForm();
    },
    onError: (err: any) => toast.error(err.message),
  });

  // Update Mutation
  const updateMutation = useMutation({
    mutationFn: async ({ id, payload }: { id: number; payload: any }) => {
      const res = await apiFetch(`/api/vehicles/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error("Failed to update vehicle");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/vehicles"] });
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard"] });
      toast.success("Vehicle updated successfully!");
      setEditingVehicle(null);
      resetForm();
    },
    onError: (err: any) => toast.error(err.message),
  });

  // Delete Mutation (server archives the vehicle so past trips keep their record)
  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      const res = await apiFetch(`/api/vehicles/${id}`, { method: "DELETE" });
      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        throw new Error(errJson.error?.message || "Failed to delete vehicle");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/vehicles"] });
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard"] });
      toast.success("Vehicle deleted");
      setDeletingVehicle(null);
    },
    onError: (err: any) => toast.error(err.message),
  });

  const resetForm = () => {
    setFormData({
      vehicleNumber: "",
      vehicleType: "Innova Crysta",
      brand: "Toyota",
      model: "Innova Crysta 2.4 ZX",
      year: "2023",
      capacity: "7",
      fuelType: "Diesel",
      rcNumber: "",
      insurancePolicy: "",
      insuranceExpiry: "",
      permitNumber: "",
      permitExpiry: "",
      fitnessCertNumber: "",
      fitnessExpiry: "",
      pollutionCertNumber: "",
      pollutionExpiry: "",
      assignedDriverId: "",
      currentOdometerKm: "0",
      maintenanceStatus: "good",
      notes: "",
    });
  };

  const handleOpenAdd = () => {
    setEditingVehicle(null);
    resetForm();
    setAddModalOpen(true);
  };

  const handleOpenEdit = (v: any) => {
    setEditingVehicle(v);
    setFormData({
      vehicleNumber: v.vehicleNumber || "",
      vehicleType: v.vehicleType || "Sedan",
      brand: v.brand || "",
      model: v.model || "",
      year: String(v.year || ""),
      capacity: String(v.capacity || 4),
      fuelType: v.fuelType || "Diesel",
      rcNumber: v.rcNumber || "",
      insurancePolicy: v.insurancePolicy || "",
      insuranceExpiry: v.insuranceExpiry || "",
      permitNumber: v.permitNumber || "",
      permitExpiry: v.permitExpiry || "",
      fitnessCertNumber: v.fitnessCertNumber || "",
      fitnessExpiry: v.fitnessExpiry || "",
      pollutionCertNumber: v.pollutionCertNumber || "",
      pollutionExpiry: v.pollutionExpiry || "",
      assignedDriverId: v.assignedDriverId ? String(v.assignedDriverId) : "",
      currentOdometerKm: String(v.currentOdometerKm || 0),
      maintenanceStatus: v.maintenanceStatus || "good",
      notes: v.notes || "",
    });
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.vehicleNumber.trim()) {
      toast.error("Vehicle registration number is required");
      return;
    }
    const payload = {
      ...formData,
      year: formData.year ? Number(formData.year) : null,
      capacity: Number(formData.capacity || 4),
      assignedDriverId: formData.assignedDriverId ? Number(formData.assignedDriverId) : null,
      currentOdometerKm: formData.currentOdometerKm || "0",
    };
    if (editingVehicle) {
      updateMutation.mutate({ id: editingVehicle.id, payload });
    } else {
      createMutation.mutate(payload);
    }
  };

  // Metrics
  const activeVehicles = vehicles.filter((v: any) => v && v.status === "active").length;
  const maintenanceVehicles = vehicles.filter((v: any) => v && v.maintenanceStatus !== "good").length;
  const expiringVehicles = vehicles.filter((v: any) => v && v.hasExpiringDocuments).length;

  const filteredVehicles = vehicles.filter((v: any) => {
    if (!v) return false;
    const q = search.toLowerCase();
    const matchSearch =
      v.vehicleNumber?.toLowerCase().includes(q) ||
      v.brand?.toLowerCase().includes(q) ||
      v.model?.toLowerCase().includes(q);
    const matchType = filterType === "all" || v.vehicleType === filterType;
    return matchSearch && matchType;
  });

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl sm:text-2xl font-black text-foreground flex items-center gap-2 tracking-tight">
            <Car className="w-6 h-6 text-amber-700 dark:text-amber-400" /> Commercial Fleet Vehicles
          </h1>
          <p className="text-xs text-muted-foreground mt-1">
            Registered commercial vehicles, driver assignments, service intervals, and document compliance
          </p>
        </div>
        <Button
          onClick={() => {
            resetForm();
            setAddModalOpen(true);
          }}
          className="bg-amber-400 hover:bg-amber-300 text-zinc-950 font-bold text-xs py-5 px-4 shadow-lg shadow-amber-400/20 flex items-center gap-2 cursor-pointer"
        >
          <Plus className="w-4 h-4" /> Add Commercial Vehicle
        </Button>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="bg-card/90 border border-border p-4 rounded-xl">
          <div className="text-[11px] font-bold text-muted-foreground uppercase tracking-wider">Total Fleet</div>
          <div className="text-2xl font-black text-foreground mt-1">{vehicles.length}</div>
          <div className="text-[10px] text-muted-foreground mt-0.5">Commercial transport units</div>
        </div>

        <div className="bg-card/90 border border-emerald-300 dark:border-emerald-500/20 p-4 rounded-xl">
          <div className="text-[11px] font-bold text-emerald-700 dark:text-emerald-400 uppercase tracking-wider">Active on Road</div>
          <div className="text-2xl font-black text-emerald-700 dark:text-emerald-400 mt-1">{activeVehicles}</div>
          <div className="text-[10px] text-muted-foreground mt-0.5">Ready for trip dispatch</div>
        </div>

        <div className="bg-card/90 border border-amber-300 dark:border-amber-500/20 p-4 rounded-xl">
          <div className="text-[11px] font-bold text-amber-700 dark:text-amber-400 uppercase tracking-wider">Doc Expirations</div>
          <div className="text-2xl font-black text-amber-700 dark:text-amber-400 mt-1">{expiringVehicles}</div>
          <div className="text-[10px] text-muted-foreground mt-0.5">Expiring within 30 days</div>
        </div>

        <div className="bg-card/90 border border-sky-300 dark:border-sky-500/20 p-4 rounded-xl">
          <div className="text-[11px] font-bold text-sky-700 dark:text-sky-400 uppercase tracking-wider">Maintenance Due</div>
          <div className="text-2xl font-black text-sky-700 dark:text-sky-400 mt-1">{maintenanceVehicles}</div>
          <div className="text-[10px] text-muted-foreground mt-0.5">Service interval scheduled</div>
        </div>
      </div>

      {/* Filters & Search */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="w-4 h-4 absolute left-3 top-3 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search vehicle number (e.g. KA-01-MJ-5050), model, or brand..."
            className="pl-9 bg-card/90 border-border text-xs py-5 rounded-xl placeholder:text-muted-foreground"
          />
        </div>
        <select
          value={filterType}
          onChange={(e) => setFilterType(e.target.value)}
          className="bg-card/90 border border-border text-foreground text-xs px-3 py-2.5 rounded-xl cursor-pointer"
        >
          <option value="all">All Vehicle Types</option>
          <option value="Innova Crysta">Innova Crysta</option>
          <option value="Sedan">Sedan</option>
          <option value="SUV">SUV</option>
          <option value="Tempo Traveller">Tempo Traveller</option>
        </select>
      </div>

      {/* Vehicle Grid */}
      {isLoading ? (
        <div className="py-12 flex justify-center">
          <NGTravelsLoader
            size="md"
            text="Syncing fleet operations..."
            subtext="Checking commercial vehicle status, permits and maintenance"
          />
        </div>
      ) : vehicles.length === 0 ? (
        <div className="p-12 text-center bg-card/50 rounded-2xl border border-border text-muted-foreground space-y-3">
          <Car className="w-12 h-12 text-muted-foreground mx-auto" />
          <div className="text-sm font-semibold text-foreground">No fleet vehicles registered yet</div>
          <div className="text-xs text-muted-foreground max-w-sm mx-auto">
            Get started by registering your first commercial taxi, sedan, Innova, or Tempo Traveller.
          </div>
          <Button onClick={handleOpenAdd} className="bg-amber-400 hover:bg-amber-500 text-zinc-950 font-bold text-xs mt-2">
            <Plus className="w-4 h-4 mr-1.5" />
            Register First Vehicle
          </Button>
        </div>
      ) : filteredVehicles.length === 0 ? (
        <div className="p-12 text-center bg-card/50 rounded-2xl border border-border text-muted-foreground text-xs">
          No vehicles found matching your criteria.
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredVehicles.map((v: any) => {
            const assignedDriver = drivers.find((d: any) => d.id === v.assignedDriverId);
            return (
              <div
                key={v.id}
                className="bg-card/90 border border-border/90 hover:border-border p-5 rounded-2xl space-y-4 shadow-xl transition-all"
              >
                {/* Top Card Header */}
                <div className="flex items-start justify-between">
                  <div>
                    <span className="inline-block px-2 py-0.5 rounded font-mono text-xs font-black bg-amber-100 dark:bg-amber-400/10 text-amber-700 dark:text-amber-300 border border-amber-300 dark:border-amber-400/30">
                      {v.vehicleNumber}
                    </span>
                    <h3 className="text-base font-extrabold text-foreground mt-1.5">{v.brand} {v.model}</h3>
                    <div className="text-[11px] text-muted-foreground">{v.vehicleType} • {v.capacity} Seater • {v.fuelType}</div>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <button
                      onClick={() => handleOpenEdit(v)}
                      className="p-1.5 rounded-lg bg-muted/80 hover:bg-muted text-foreground transition-colors cursor-pointer"
                      title="Edit vehicle"
                    >
                      <Edit2 className="w-3.5 h-3.5" />
                    </button>
                    <button
                      onClick={() => setDeletingVehicle(v)}
                      className="p-1.5 rounded-lg bg-muted/80 hover:bg-rose-100 hover:dark:bg-rose-500/20 text-rose-700 dark:text-rose-400 transition-colors cursor-pointer"
                      title="Delete vehicle"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>

                {/* Assigned Driver */}
                <div className="bg-background/70 p-3 rounded-xl border border-border/70 text-xs space-y-1">
                  <div className="text-[10px] text-muted-foreground uppercase font-bold flex items-center gap-1">
                    <User className="w-3 h-3 text-amber-700 dark:text-amber-400" /> Assigned Pilot
                  </div>
                  <div className="font-bold text-foreground">
                    {assignedDriver ? assignedDriver.name : <span className="text-muted-foreground font-normal">Unassigned</span>}
                  </div>
                  {assignedDriver && (
                    <div className="text-[10px] text-muted-foreground font-mono">{assignedDriver.mobile}</div>
                  )}
                </div>

                {/* Document Status Badges */}
                <div className="space-y-1.5">
                  <div className="text-[10px] text-muted-foreground uppercase font-bold flex items-center gap-1">
                    <FileText className="w-3 h-3 text-muted-foreground" /> Regulatory Compliance
                  </div>
                  <div className="grid grid-cols-2 gap-1.5 text-[10px] font-mono">
                    <div className={`p-1.5 rounded border flex justify-between ${
                      v.insuranceStatus === "expired" ? "bg-rose-100 dark:bg-rose-500/10 text-rose-700 dark:text-rose-400 border-rose-300 dark:border-rose-500/30 font-bold" :
                      v.insuranceStatus === "expiring_soon" ? "bg-amber-100 dark:bg-amber-500/10 text-amber-700 dark:text-amber-300 border-amber-300 dark:border-amber-500/30 font-bold" :
                      "bg-background text-muted-foreground border-border"
                    }`}>
                      <span>Insurance:</span>
                      <span>{v.insuranceExpiry || "N/A"}</span>
                    </div>

                    <div className={`p-1.5 rounded border flex justify-between ${
                      v.permitStatus === "expired" ? "bg-rose-100 dark:bg-rose-500/10 text-rose-700 dark:text-rose-400 border-rose-300 dark:border-rose-500/30 font-bold" :
                      v.permitStatus === "expiring_soon" ? "bg-amber-100 dark:bg-amber-500/10 text-amber-700 dark:text-amber-300 border-amber-300 dark:border-amber-500/30 font-bold" :
                      "bg-background text-muted-foreground border-border"
                    }`}>
                      <span>Permit:</span>
                      <span>{v.permitExpiry || "N/A"}</span>
                    </div>

                    <div className={`p-1.5 rounded border flex justify-between ${
                      v.fitnessStatus === "expired" ? "bg-rose-100 dark:bg-rose-500/10 text-rose-700 dark:text-rose-400 border-rose-300 dark:border-rose-500/30 font-bold" :
                      v.fitnessStatus === "expiring_soon" ? "bg-amber-100 dark:bg-amber-500/10 text-amber-700 dark:text-amber-300 border-amber-300 dark:border-amber-500/30 font-bold" :
                      "bg-background text-muted-foreground border-border"
                    }`}>
                      <span>Fitness:</span>
                      <span>{v.fitnessExpiry || "N/A"}</span>
                    </div>

                    <div className={`p-1.5 rounded border flex justify-between ${
                      v.pollutionStatus === "expired" ? "bg-rose-100 dark:bg-rose-500/10 text-rose-700 dark:text-rose-400 border-rose-300 dark:border-rose-500/30 font-bold" :
                      v.pollutionStatus === "expiring_soon" ? "bg-amber-100 dark:bg-amber-500/10 text-amber-700 dark:text-amber-300 border-amber-300 dark:border-amber-500/30 font-bold" :
                      "bg-background text-muted-foreground border-border"
                    }`}>
                      <span>PUC:</span>
                      <span>{v.pollutionExpiry || "N/A"}</span>
                    </div>
                  </div>
                </div>

                {/* Expiry Alerts Callout if any */}
                {v.hasExpiringDocuments && (
                  <div className="bg-amber-100 dark:bg-amber-500/10 border border-amber-300 dark:border-amber-500/30 rounded-xl p-2.5 text-[11px] text-amber-700 dark:text-amber-300 flex items-start gap-2">
                    <AlertTriangle className="w-3.5 h-3.5 text-amber-700 dark:text-amber-400 shrink-0 mt-0.5" />
                    <div>
                      <div className="font-bold">Attention Required</div>
                      <div className="text-[10px] text-amber-300/80">{v.documentAlerts.join(" • ")}</div>
                    </div>
                  </div>
                )}

                {/* Bottom Odometer & Status */}
                <div className="pt-2 border-t border-border/80 flex items-center justify-between text-xs">
                  <div className="text-muted-foreground font-mono">
                    <span className="text-[10px] text-muted-foreground uppercase">Odometer: </span>
                    <span className="font-bold text-foreground">{Number(v.currentOdometerKm || 0).toLocaleString()} KM</span>
                  </div>
                  <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase ${
                    v.status === "active" ? "bg-emerald-100 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border border-emerald-300 dark:border-emerald-500/20" :
                    "bg-rose-100 dark:bg-rose-500/10 text-rose-700 dark:text-rose-400 border border-rose-300 dark:border-rose-500/20"
                  }`}>
                    {v.status}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Add / Edit Vehicle Modal */}
      <Dialog open={addModalOpen || Boolean(editingVehicle)} onOpenChange={(open) => {
        if (!open) {
          setAddModalOpen(false);
          setEditingVehicle(null);
        }
      }}>
        <DialogContent className="sm:max-w-2xl bg-background border-border text-foreground p-6 max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-lg font-bold flex items-center gap-2">
              <Car className="w-5 h-5 text-amber-700 dark:text-amber-400" />
              {editingVehicle ? "Edit Commercial Vehicle" : "Register New Commercial Vehicle"}
            </DialogTitle>
          </DialogHeader>

          <form onSubmit={handleSubmit} className="space-y-4 pt-2">
            {/* Core Info */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-xs font-semibold text-foreground">Registration Number *</Label>
                <Input
                  required
                  placeholder="KA-01-MJ-5050"
                  value={formData.vehicleNumber}
                  onChange={(e) => setFormData({ ...formData, vehicleNumber: e.target.value })}
                  className="bg-card border-border text-xs uppercase font-mono"
                />
              </div>

              <div className="space-y-1">
                <Label className="text-xs font-semibold text-foreground">Vehicle Type</Label>
                <select
                  value={formData.vehicleType}
                  onChange={(e) => setFormData({ ...formData, vehicleType: e.target.value })}
                  className="w-full bg-card border border-border text-foreground text-xs px-3 py-2 rounded-lg"
                >
                  <option value="Innova Crysta">Innova Crysta (7 Seater)</option>
                  <option value="Sedan">Sedan (Dzire / Etios - 4 Seater)</option>
                  <option value="SUV">SUV (Ertiga - 6 Seater)</option>
                  <option value="Tempo Traveller">Tempo Traveller (12-16 Seater)</option>
                  <option value="Luxury Bus">Luxury Mini Bus (21 Seater)</option>
                </select>
              </div>

              <div className="space-y-1">
                <Label className="text-xs font-semibold text-foreground">Brand</Label>
                <Input
                  placeholder="Toyota"
                  value={formData.brand}
                  onChange={(e) => setFormData({ ...formData, brand: e.target.value })}
                  className="bg-card border-border text-xs"
                />
              </div>

              <div className="space-y-1">
                <Label className="text-xs font-semibold text-foreground">Model Name</Label>
                <Input
                  placeholder="Innova Crysta 2.4 ZX"
                  value={formData.model}
                  onChange={(e) => setFormData({ ...formData, model: e.target.value })}
                  className="bg-card border-border text-xs"
                />
              </div>

              <div className="space-y-1">
                <Label className="text-xs font-semibold text-foreground">Assigned Driver</Label>
                <select
                  value={formData.assignedDriverId}
                  onChange={(e) => setFormData({ ...formData, assignedDriverId: e.target.value })}
                  className="w-full bg-card border border-border text-foreground text-xs px-3 py-2 rounded-lg"
                >
                  <option value="">Unassigned</option>
                  {drivers.map((d: any) => (
                    <option key={d.id} value={d.id}>
                      {d.name} ({d.driverCode || d.mobile})
                    </option>
                  ))}
                </select>
              </div>

              <div className="space-y-1">
                <Label className="text-xs font-semibold text-foreground">Current Odometer (KM)</Label>
                <Input
                  type="number"
                  placeholder="45200"
                  value={formData.currentOdometerKm}
                  onChange={(e) => setFormData({ ...formData, currentOdometerKm: e.target.value })}
                  className="bg-card border-border text-xs font-mono"
                />
              </div>
            </div>

            {/* Compliance Documents & Expiry */}
            <div className="p-3.5 rounded-xl bg-card/60 border border-border space-y-3">
              <div className="text-xs font-bold text-amber-700 dark:text-amber-400 uppercase tracking-wider flex items-center gap-1.5">
                <ShieldCheck className="w-4 h-4" /> Regulatory Documents & Expiry Dates
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label className="text-[11px] text-muted-foreground">Insurance Policy Expiry</Label>
                  <Input
                    type="date"
                    value={formData.insuranceExpiry}
                    onChange={(e) => setFormData({ ...formData, insuranceExpiry: e.target.value })}
                    className="bg-background border-border text-xs"
                  />
                </div>

                <div className="space-y-1">
                  <Label className="text-[11px] text-muted-foreground">State / All India Permit Expiry</Label>
                  <Input
                    type="date"
                    value={formData.permitExpiry}
                    onChange={(e) => setFormData({ ...formData, permitExpiry: e.target.value })}
                    className="bg-background border-border text-xs"
                  />
                </div>

                <div className="space-y-1">
                  <Label className="text-[11px] text-muted-foreground">Fitness Certificate Expiry</Label>
                  <Input
                    type="date"
                    value={formData.fitnessExpiry}
                    onChange={(e) => setFormData({ ...formData, fitnessExpiry: e.target.value })}
                    className="bg-background border-border text-xs"
                  />
                </div>

                <div className="space-y-1">
                  <Label className="text-[11px] text-muted-foreground">Pollution (PUC) Expiry</Label>
                  <Input
                    type="date"
                    value={formData.pollutionExpiry}
                    onChange={(e) => setFormData({ ...formData, pollutionExpiry: e.target.value })}
                    className="bg-background border-border text-xs"
                  />
                </div>
              </div>
            </div>

            {/* Actions */}
            <div className="flex gap-2 pt-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  setAddModalOpen(false);
                  setEditingVehicle(null);
                }}
                className="w-1/2 border-border text-foreground text-xs py-5 cursor-pointer"
              >
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={createMutation.isPending || updateMutation.isPending}
                className="w-1/2 bg-amber-400 hover:bg-amber-300 text-zinc-950 font-bold text-xs py-5 cursor-pointer shadow-lg shadow-amber-400/20"
              >
                {editingVehicle ? "Save Changes" : "Register Vehicle"}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      <ConfirmDeleteDialog
        isOpen={Boolean(deletingVehicle)}
        title="Delete Vehicle"
        description={
          <>
            Remove <strong className="text-foreground">{deletingVehicle?.vehicleNumber}</strong> ({deletingVehicle?.brand} {deletingVehicle?.model}) from the fleet?
            Past trips keep their vehicle record. Vehicles on open trips can't be deleted until those trips are reassigned or closed.
          </>
        }
        loading={deleteMutation.isPending}
        onConfirm={() => deletingVehicle && deleteMutation.mutate(deletingVehicle.id)}
        onClose={() => setDeletingVehicle(null)}
      />
    </div>
  );
};
