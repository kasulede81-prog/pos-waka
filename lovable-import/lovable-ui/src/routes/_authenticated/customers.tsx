import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { Users, Plus } from "lucide-react";
import { seoHead } from "@/components/seo-head";
import { usePOS, formatUGX } from "@/lib/pos-store";

export const Route = createFileRoute("/_authenticated/customers")({
  head: () => seoHead({ title: "Customers — Waka POS", description: "Track customer debts.", path: "/customers" }),
  component: CustomersPage,
});

function CustomersPage() {
  const customers = usePOS((s) => s.customers);
  const addCustomer = usePOS((s) => s.addCustomer);
  const payDebt = usePOS((s) => s.payDebt);

  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [showForm, setShowForm] = useState(false);

  const totalDebt = customers.reduce((a, c) => a + c.balance, 0);

  return (
    <div>
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-2xl font-black">Customers</h1>
        <button
          onClick={() => setShowForm((v) => !v)}
          className="inline-flex items-center gap-1.5 rounded-full bg-waka-600 px-3 py-1.5 text-xs font-bold text-primary-foreground"
        >
          <Plus className="h-4 w-4" /> Add
        </button>
      </div>

      <p className="mt-2 text-sm text-muted-foreground">
        Total outstanding: <span className="font-bold text-foreground">{formatUGX(totalDebt)}</span>
      </p>

      {showForm && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (!name.trim()) return;
            addCustomer({ name: name.trim(), phone: phone.trim() || undefined });
            setName(""); setPhone(""); setShowForm(false);
          }}
          className="mt-4 grid gap-2 rounded-2xl border border-border/60 bg-card p-4 sm:grid-cols-[1fr_1fr_auto]"
        >
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Full name" className="rounded-xl border border-border bg-background px-3 py-2.5 text-sm" />
          <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="Phone (optional)" className="rounded-xl border border-border bg-background px-3 py-2.5 text-sm" />
          <button className="rounded-full bg-waka-600 px-4 py-2.5 text-sm font-bold text-primary-foreground">Save</button>
        </form>
      )}

      {customers.length === 0 ? (
        <div className="mt-6 rounded-2xl border border-dashed border-border bg-card/50 p-10 text-center">
          <Users className="mx-auto h-8 w-8 text-muted-foreground" />
          <p className="mt-3 text-sm font-semibold">No customers yet</p>
          <p className="mt-1 text-xs text-muted-foreground">Add a customer to track mpa mpaka (credit sales).</p>
        </div>
      ) : (
        <ul className="mt-6 space-y-2">
          {customers.map((c) => (
            <li key={c.id} className="flex items-center justify-between gap-3 rounded-2xl border border-border/60 bg-card p-4">
              <div className="min-w-0">
                <p className="truncate text-sm font-bold">{c.name}</p>
                {c.phone && <p className="text-xs text-muted-foreground">{c.phone}</p>}
              </div>
              <div className="text-right">
                <p className={`text-lg font-black ${c.balance > 0 ? "text-destructive" : "text-emerald-700"}`}>
                  {formatUGX(c.balance)}
                </p>
                {c.balance > 0 && (
                  <button
                    onClick={() => {
                      const v = prompt(`Record payment from ${c.name} (UGX)`, String(c.balance));
                      const amount = Number(v);
                      if (amount > 0) payDebt(c.id, amount);
                    }}
                    className="mt-1 text-xs font-bold text-waka-700 hover:underline"
                  >
                    Record payment
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
