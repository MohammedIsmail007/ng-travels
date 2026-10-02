import React, { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Users, Search, Plus, Phone, Mail, MapPin, ArrowUpRight, CheckCircle2, CircleDollarSign, Trash2 } from "lucide-react";
import { apiFetch } from "@/lib/apiFetch";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatINR } from "@/lib/fareEngine";
import { NGTravelsLoader } from "@/components/loading";
import { ConfirmDeleteDialog } from "@/components/common/ConfirmDeleteDialog";

interface CustomersPageProps {
  customers: any[];
  isLoading?: boolean;
  onCustomerCreated?: (newCustomer: any) => void;
}

export const CustomersPage: React.FC<CustomersPageProps> = ({ customers = [], isLoading = false }) => {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [deletingCustomer, setDeletingCustomer] = useState<any | null>(null);

  // Server archives the customer so their past trips and payments stay intact
  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      const res = await apiFetch(`/api/customers/${id}`, { method: "DELETE" });
      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        throw new Error(errJson.error?.message || "Failed to delete customer");
      }
      return res.json();
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["/api/customers"] });
      toast.success("Customer deleted");
      setDeletingCustomer(null);
    },
    onError: (err: any) => toast.error(err.message),
  });

  const customerList = Array.isArray(customers) ? customers : (Array.isArray((customers as any)?.items) ? (customers as any).items : []);

  const filtered = customerList.filter((c: any) => {
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return (
      c.name?.toLowerCase().includes(q) ||
      c.mobile?.includes(q) ||
      c.email?.toLowerCase().includes(q) ||
      c.customerCode?.toLowerCase().includes(q) ||
      c.customerId?.toLowerCase().includes(q)
    );
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-foreground flex items-center gap-2">
            <Users className="w-5 h-5 text-amber-700 dark:text-amber-400" />
            Customer Account Directory
          </h1>
          <p className="text-xs text-muted-foreground mt-1">
            Manage customer profiles, lifetime trip histories, and pending account balances.
          </p>
        </div>
      </div>

      <div className="relative bg-card/60 p-4 rounded-xl border border-border">
        <Search className="w-4 h-4 text-muted-foreground absolute left-7 top-6.5" />
        <Input
          placeholder="Search by customer name, mobile, email or customer code..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="bg-card border-border pl-10 text-xs"
        />
      </div>

      {isLoading && customerList.length === 0 ? (
        <div className="p-12 flex justify-center bg-card/50 rounded-2xl border border-border">
          <NGTravelsLoader size="sm" text="Loading customers..." />
        </div>
      ) : customerList.length === 0 ? (
        <div className="p-12 text-center bg-card/50 rounded-2xl border border-border text-muted-foreground space-y-3">
          <Users className="w-12 h-12 text-muted-foreground mx-auto" />
          <div className="text-sm font-semibold text-foreground">No customers registered yet</div>
          <div className="text-xs text-muted-foreground max-w-sm mx-auto">
            Customers will automatically appear here when booking trips, receiving quotes, or registering new journeys.
          </div>
        </div>
      ) : filtered.length === 0 ? (
        <div className="p-12 text-center bg-card/50 rounded-2xl border border-border text-muted-foreground text-xs">
          No customer accounts found matching "{search}".
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {filtered.map((c: any) => (
          <div
            key={c.id}
            className="bg-card/70 border border-border rounded-xl p-5 space-y-4 hover:border-border transition-all shadow-md"
          >
            <div className="flex justify-between items-start">
              <div>
                <span className="font-mono text-[11px] text-amber-700 dark:text-amber-400 font-bold">{c.customerId || c.customerCode}</span>
                <h3 className="font-bold text-sm text-foreground mt-0.5">{c.name}</h3>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="text-[10px] bg-muted text-foreground font-mono px-2 py-0.5 rounded border border-border">
                  {c.totalTrips || 0} Trip(s)
                </span>
                <button
                  onClick={() => setDeletingCustomer(c)}
                  className="p-1.5 rounded-lg bg-muted/80 hover:bg-rose-100 hover:dark:bg-rose-500/20 text-rose-700 dark:text-rose-400 transition-colors cursor-pointer"
                  title="Delete customer"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>

            <div className="space-y-1.5 text-xs text-muted-foreground">
              <div className="flex items-center gap-2">
                <Phone className="w-3.5 h-3.5 text-muted-foreground" />
                <span>{c.mobile}</span>
              </div>
              {c.email && (
                <div className="flex items-center gap-2">
                  <Mail className="w-3.5 h-3.5 text-muted-foreground" />
                  <span className="truncate">{c.email}</span>
                </div>
              )}
              {c.address && (
                <div className="flex items-center gap-2">
                  <MapPin className="w-3.5 h-3.5 text-muted-foreground" />
                  <span className="truncate">{c.address}</span>
                </div>
              )}
            </div>

            <div className="grid grid-cols-2 gap-2 pt-3 border-t border-border text-xs">
              <div>
                <span className="text-muted-foreground text-[10px] block">Lifetime Spent</span>
                <span className="font-mono font-bold text-emerald-700 dark:text-emerald-400">{formatINR(c.totalPaid || 0)}</span>
              </div>
              <div>
                <span className="text-muted-foreground text-[10px] block">Pending Balance</span>
                <span className={`font-mono font-bold ${Number(c.pending) > 0 ? "text-amber-700 dark:text-amber-300" : "text-muted-foreground"}`}>
                  {formatINR(c.pending || 0)}
                </span>
              </div>
            </div>
          </div>
        ))}
        </div>
      )}

      <ConfirmDeleteDialog
        isOpen={Boolean(deletingCustomer)}
        title="Delete Customer"
        description={
          <>
            Remove <strong className="text-foreground">{deletingCustomer?.name}</strong> ({deletingCustomer?.mobile}) from the customer directory?
            Their past trips and payments are kept. Customers with open trips can't be deleted until those trips are completed or cancelled.
          </>
        }
        loading={deleteMutation.isPending}
        onConfirm={() => deletingCustomer && deleteMutation.mutate(deletingCustomer.id)}
        onClose={() => setDeletingCustomer(null)}
      />
    </div>
  );
};
