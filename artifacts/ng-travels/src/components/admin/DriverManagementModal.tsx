import React, { useState } from "react";
import {
  X,
  Plus,
  Key,
  Mail,
  User,
  Phone,
  AlertCircle,
  CheckCircle2,
  Loader,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

interface DriverManagementModalProps {
  isOpen: boolean;
  onClose: () => void;
  onCreateDriver: (data: CreateDriverData) => Promise<void>;
  onResetPassword: (driverId: number, newPassword: string) => Promise<void>;
  drivers: any[];
}

export interface CreateDriverData {
  name: string;
  driverCode: string;
  mobile: string;
  email?: string;
  licenseNumber?: string;
  licenseExpiry?: string;
  emergencyContact?: string;
  initialPassword: string;
}

export const DriverManagementModal: React.FC<DriverManagementModalProps> = ({
  isOpen,
  onClose,
  onCreateDriver,
  onResetPassword,
  drivers = [],
}) => {
  const [activeTab, setActiveTab] = useState<"create" | "reset">("create");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<{
    type: "success" | "error";
    text: string;
  } | null>(null);

  // Create driver form state
  const [createForm, setCreateForm] = useState({
    name: "",
    driverCode: "",
    mobile: "",
    email: "",
    licenseNumber: "",
    licenseExpiry: "",
    emergencyContact: "",
    initialPassword: "",
    confirmPassword: "",
  });

  // Reset password form state
  const [resetForm, setResetForm] = useState({
    driverId: "",
    newPassword: "",
    confirmPassword: "",
  });

  const handleCreateSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setMessage(null);

    if (
      !createForm.name ||
      !createForm.driverCode ||
      !createForm.mobile ||
      !createForm.initialPassword
    ) {
      setMessage({
        type: "error",
        text: "Name, driver code, mobile, and password are required.",
      });
      return;
    }

    if (createForm.initialPassword !== createForm.confirmPassword) {
      setMessage({ type: "error", text: "Passwords do not match." });
      return;
    }

    if (createForm.initialPassword.length < 6) {
      setMessage({
        type: "error",
        text: "Password must be at least 6 characters.",
      });
      return;
    }

    setLoading(true);
    try {
      await onCreateDriver({
        name: createForm.name,
        driverCode: createForm.driverCode.toUpperCase(),
        mobile: createForm.mobile,
        email: createForm.email.trim() || undefined,
        licenseNumber: createForm.licenseNumber || undefined,
        licenseExpiry: createForm.licenseExpiry || undefined,
        emergencyContact: createForm.emergencyContact || undefined,
        initialPassword: createForm.initialPassword,
      });
      setMessage({
        type: "success",
        text: "Driver account created successfully!",
      });
      setCreateForm({
        name: "",
        driverCode: "",
        mobile: "",
        email: "",
        licenseNumber: "",
        licenseExpiry: "",
        emergencyContact: "",
        initialPassword: "",
        confirmPassword: "",
      });
      setTimeout(() => onClose(), 2000);
    } catch (err: any) {
      setMessage({
        type: "error",
        text: err.message || "Failed to create driver account.",
      });
    } finally {
      setLoading(false);
    }
  };

  const handleResetSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setMessage(null);

    if (!resetForm.driverId || !resetForm.newPassword) {
      setMessage({ type: "error", text: "Driver and password are required." });
      return;
    }

    if (resetForm.newPassword !== resetForm.confirmPassword) {
      setMessage({ type: "error", text: "Passwords do not match." });
      return;
    }

    if (resetForm.newPassword.length < 6) {
      setMessage({
        type: "error",
        text: "Password must be at least 6 characters.",
      });
      return;
    }

    setLoading(true);
    try {
      await onResetPassword(
        parseInt(resetForm.driverId),
        resetForm.newPassword,
      );
      setMessage({
        type: "success",
        text: "Driver password reset successfully!",
      });
      setResetForm({ driverId: "", newPassword: "", confirmPassword: "" });
      setTimeout(() => onClose(), 2000);
    } catch (err: any) {
      setMessage({
        type: "error",
        text: err.message || "Failed to reset password.",
      });
    } finally {
      setLoading(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-card border border-border rounded-2xl max-w-2xl w-full max-h-[90vh] overflow-y-auto shadow-2xl">
        {/* Header */}
        <div className="sticky top-0 bg-card border-b border-border p-6 flex items-center justify-between">
          <h2 className="text-xl font-bold text-foreground flex items-center gap-2">
            <Key className="w-5 h-5 text-amber-700 dark:text-amber-400" />
            Driver Account Management
          </h2>
          <button
            onClick={onClose}
            className="text-muted-foreground hover:text-foreground transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 space-y-6">
          {/* Tabs */}
          <div className="flex gap-2 border-b border-border">
            <button
              onClick={() => setActiveTab("create")}
              className={`px-4 py-2 font-semibold text-sm transition-colors border-b-2 ${
                activeTab === "create"
                  ? "text-amber-700 dark:text-amber-400 border-amber-400"
                  : "text-muted-foreground border-transparent hover:text-foreground"
              }`}
            >
              <Plus className="w-4 h-4 inline mr-2" />
              Create New Driver
            </button>
            <button
              onClick={() => setActiveTab("reset")}
              className={`px-4 py-2 font-semibold text-sm transition-colors border-b-2 ${
                activeTab === "reset"
                  ? "text-amber-700 dark:text-amber-400 border-amber-400"
                  : "text-muted-foreground border-transparent hover:text-foreground"
              }`}
            >
              <Key className="w-4 h-4 inline mr-2" />
              Reset Password
            </button>
          </div>

          {/* Message */}
          {message && (
            <div
              className={`p-4 rounded-xl flex items-start gap-3 ${
                message.type === "success"
                  ? "bg-emerald-950/40 border border-emerald-300 dark:border-emerald-500/40 text-emerald-700 dark:text-emerald-300"
                  : "bg-rose-950/40 border border-rose-300 dark:border-rose-500/40 text-rose-700 dark:text-rose-300"
              }`}
            >
              {message.type === "success" ? (
                <CheckCircle2 className="w-5 h-5 shrink-0 mt-0.5" />
              ) : (
                <AlertCircle className="w-5 h-5 shrink-0 mt-0.5" />
              )}
              <div className="text-sm">{message.text}</div>
            </div>
          )}

          {/* Create Driver Form */}
          {activeTab === "create" && (
            <form onSubmit={handleCreateSubmit} className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-foreground mb-2">
                    Driver Name *
                  </label>
                  <div className="relative">
                    <User className="w-4 h-4 text-muted-foreground absolute left-3 top-3" />
                    <Input
                      type="text"
                      required
                      placeholder="e.g. Rajesh Kumar"
                      value={createForm.name}
                      onChange={(e) =>
                        setCreateForm({ ...createForm, name: e.target.value })
                      }
                      className="pl-9"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-foreground mb-2">
                    Driver Code *
                  </label>
                  <Input
                    type="text"
                    required
                    placeholder="e.g. DRV-101"
                    value={createForm.driverCode}
                    onChange={(e) =>
                      setCreateForm({
                        ...createForm,
                        driverCode: e.target.value,
                      })
                    }
                    className="font-mono"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-foreground mb-2">
                    Mobile Number *
                  </label>
                  <div className="relative">
                    <Phone className="w-4 h-4 text-muted-foreground absolute left-3 top-3" />
                    <Input
                      type="tel"
                      required
                      placeholder="e.g. 9845011223"
                      value={createForm.mobile}
                      onChange={(e) =>
                        setCreateForm({ ...createForm, mobile: e.target.value })
                      }
                      className="pl-9 font-mono"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-foreground mb-2">
                    Email Address (optional)
                  </label>
                  <div className="relative">
                    <Mail className="w-4 h-4 text-muted-foreground absolute left-3 top-3" />
                    <Input
                      type="email"
                      placeholder="e.g. driver@example.com"
                      value={createForm.email}
                      onChange={(e) =>
                        setCreateForm({ ...createForm, email: e.target.value })
                      }
                      className="pl-9"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-foreground mb-2">
                    License Number
                  </label>
                  <Input
                    type="text"
                    placeholder="Optional"
                    value={createForm.licenseNumber}
                    onChange={(e) =>
                      setCreateForm({
                        ...createForm,
                        licenseNumber: e.target.value,
                      })
                    }
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-foreground mb-2">
                    License Expiry
                  </label>
                  <Input
                    type="date"
                    value={createForm.licenseExpiry}
                    onChange={(e) =>
                      setCreateForm({
                        ...createForm,
                        licenseExpiry: e.target.value,
                      })
                    }
                  />
                </div>

                <div className="md:col-span-2">
                  <label className="block text-xs font-semibold text-foreground mb-2">
                    Emergency Contact
                  </label>
                  <Input
                    type="text"
                    placeholder="Optional - name and phone"
                    value={createForm.emergencyContact}
                    onChange={(e) =>
                      setCreateForm({
                        ...createForm,
                        emergencyContact: e.target.value,
                      })
                    }
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-foreground mb-2">
                    Initial Password *
                  </label>
                  <Input
                    type="password"
                    required
                    placeholder="Minimum 6 characters"
                    value={createForm.initialPassword}
                    onChange={(e) =>
                      setCreateForm({
                        ...createForm,
                        initialPassword: e.target.value,
                      })
                    }
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-foreground mb-2">
                    Confirm Password *
                  </label>
                  <Input
                    type="password"
                    required
                    placeholder="Repeat password"
                    value={createForm.confirmPassword}
                    onChange={(e) =>
                      setCreateForm({
                        ...createForm,
                        confirmPassword: e.target.value,
                      })
                    }
                  />
                </div>
              </div>

              <Button
                type="submit"
                disabled={loading}
                className="w-full bg-amber-400 hover:bg-amber-300 text-zinc-950 font-bold py-6"
              >
                {loading ? (
                  <Loader className="w-4 h-4 animate-spin mr-2" />
                ) : (
                  <Plus className="w-4 h-4 mr-2" />
                )}
                Create Driver Account
              </Button>
            </form>
          )}

          {/* Reset Password Form */}
          {activeTab === "reset" && (
            <form onSubmit={handleResetSubmit} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-foreground mb-2">
                  Select Driver *
                </label>
                <select
                  required
                  value={resetForm.driverId}
                  onChange={(e) =>
                    setResetForm({ ...resetForm, driverId: e.target.value })
                  }
                  className="w-full px-3 py-2 bg-background border border-border text-foreground rounded-lg text-xs focus:outline-none focus:ring-2 focus:ring-amber-400"
                >
                  <option value="">-- Select a driver --</option>
                  {drivers.map((driver) => (
                    <option key={driver.id} value={driver.id}>
                      {driver.name} ({driver.driverCode})
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-foreground mb-2">
                  New Password *
                </label>
                <Input
                  type="password"
                  required
                  placeholder="Minimum 6 characters"
                  value={resetForm.newPassword}
                  onChange={(e) =>
                    setResetForm({ ...resetForm, newPassword: e.target.value })
                  }
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-foreground mb-2">
                  Confirm Password *
                </label>
                <Input
                  type="password"
                  required
                  placeholder="Repeat password"
                  value={resetForm.confirmPassword}
                  onChange={(e) =>
                    setResetForm({
                      ...resetForm,
                      confirmPassword: e.target.value,
                    })
                  }
                />
              </div>

              <Button
                type="submit"
                disabled={loading}
                className="w-full bg-amber-400 hover:bg-amber-300 text-zinc-950 font-bold py-6"
              >
                {loading ? (
                  <Loader className="w-4 h-4 animate-spin mr-2" />
                ) : (
                  <Key className="w-4 h-4 mr-2" />
                )}
                Reset Driver Password
              </Button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
};
