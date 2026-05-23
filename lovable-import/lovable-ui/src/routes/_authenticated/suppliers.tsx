import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { Truck, Plus, ArrowDownCircle, ArrowUpCircle } from "lucide-react";
import { seoHead } from "@/components/seo-head";
import { usePOS, formatUGX } from "@/lib/pos-store";

export const Route = createFileRoute("/_authenticated/suppliers")({
  head: () => seoHead({ title: "Suppliers — Waka POS", description: "Track supplier balances.", path: "/suppliers" }),
  component: SuppliersPage,
});

function SuppliersPage() {
  const suppliers = usePOS((s) => s.suppliers);
  const entries = usePOS((s) => s.supplierEntries);
  const addSupplier = usePOS((s) => s.addSupplier);
  const recordEntry = usePOS((s) => s.recordSupplierEntry);

  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");

  const total = suppliers.reduce((a, s) => a + s.balance, 0);

  return (
    <div>
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-2xl font-black">Suppliers</h1>
        <button
          onClick={() => setShowForm((v) => !v)}
          className="inline-flex items-center gap-1.5 rounded-full bg-waka-600 px-3 py-1.5 text-xs font-bold text-primary-foreground"
        >
          <Plus className="h-4 w-4" /> Add
        </button>
      </div>
      <p className="mt-2 text-sm text-muted-foreground">
        Total you owe: <span className="font-bold text-foreground">{formatUGX(total)}</span>
      </p>

      {showForm && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (!name.trim()) return;
            addSupplier({ name: name.trim(), phone: phone.trim() || undefined });
            setName(""); setPhone(""); setShowForm(false);
          }}
          className="mt-4 grid gap-2 rounded-2xl border border-border/60 bg-card p-4 sm:grid-cols-[1fr_1fr_auto]"
        >
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Supplier name" className="rounded-xl border border-border bg-background px-3 py-2.5 text-sm" />
          <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="Phone (optional)" className="rounded-xl border border-border bg-background px-3 py-2.5 text-sm" />
          <button className="rounded-full bg-waka-600 px-4 py-2.5 text-sm font-bold text-primary-foreground">Save</button>
        </form>
      )}

      {suppliers.length === 0 ? (
        <div className="mt-6 rounded-2xl border border-dashed border-border bg-card/50 p-10 text-center">
          <Truck className="mx-auto h-8 w-8 text-muted-foreground" />
          <p className="mt-3 text-sm font-semibold">No suppliers yet</p>
          <p className="mt-1 text-xs text-muted-foreground">Add a supplier to track purchases and payments.</p>
        </div>
      ) : (
        <ul className="mt-6 space-y-2">
          {suppliers.map((s) => (
            <li key={s.id} className="rounded-2xl border border-border/60 bg-card p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-bold">{s.name}</p>
                  {s.phone && <p className="text-xs text-muted-foreground">{s.phone}</p>}
                </div>
                <p className={`text-lg font-black ${s.balance > 0 ? "text-destructive" : "text-emerald-700"}`}>
                  {formatUGX(s.balance)}
                </p>
              </div>
              <div className="mt-3 flex gap-2">
                <button
                  onClick={() => {
                    const v = prompt(`New purchase from ${s.name} (UGX)`);
                    const amount = Number(v);
                    if (amount > 0) recordEntry(s.id, "purchase", amount);
                  }}
                  className="inline-flex items-center gap-1.5 rounded-full bg-amber-100 px-3 py-1.5 text-xs font-bold text-amber-800"
                >
                  <ArrowDownCircle className="h-3.5 w-3.5" /> Purchase
                </button>
                <button
                  onClick={() => {
                    const v = prompt(`Payment to ${s.name} (UGX)`, String(s.balance));
                    const amount = Number(v);
                    if (amount > 0) recordEntry(s.id, "payment", amount);
                  }}
                  className="inline-flex items-center gap-1.5 rounded-full bg-emerald-100 px-3 py-1.5 text-xs font-bold text-emerald-800"
                >
                  <ArrowUpCircle className="h-3.5 w-3.5" /> Payment
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {entries.length > 0 && (
        <section className="mt-8">
          <h2 className="text-sm font-black uppercase tracking-wider text-muted-foreground">Recent activity</h2>
          <ul className="mt-3 space-y-1.5">
            {entries.slice(0, 20).map((e) => (
              <li key={e.id} className="flex items-center justify-between rounded-xl border border-border/60 bg-card px-4 py-2.5 text-xs">
                <span className="truncate">
                  <span className="font-bold">{e.supplierName}</span> · {e.type}
                </span>
                <span className={`font-bold ${e.type === "purchase" ? "text-amber-700" : "text-emerald-700"}`}>
                  {e.type === "purchase" ? "+" : "−"}{formatUGX(e.amount)}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
