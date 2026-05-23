import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { Wallet, Trash2, ArrowDownCircle, ArrowUpCircle, Receipt as ReceiptIcon } from "lucide-react";
import { seoHead } from "@/components/seo-head";
import { usePOS, formatUGX, type CashKind, type CashMethod } from "@/lib/pos-store";

export const Route = createFileRoute("/_authenticated/expenses")({
  head: () =>
    seoHead({
      title: "Expenses & cash log — Waka POS",
      description: "Track shop expenses, cash in and cash out.",
      path: "/expenses",
    }),
  component: ExpensesPage,
});

const CATEGORIES = ["Rent", "Transport", "Salaries", "Utilities", "Stock", "Repairs", "Other"];

function ExpensesPage() {
  const entries = usePOS((s) => s.cashEntries);
  const addEntry = usePOS((s) => s.addCashEntry);
  const removeEntry = usePOS((s) => s.removeCashEntry);
  const currentDay = usePOS((s) => s.currentDay());

  const [kind, setKind] = useState<CashKind>("expense");
  const [method, setMethod] = useState<CashMethod>("cash");
  const [category, setCategory] = useState<string>(CATEGORIES[0]);
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");

  const totals = useMemo(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayMs = today.getTime();
    let expenseToday = 0;
    let cashInToday = 0;
    let cashOutToday = 0;
    for (const e of entries) {
      if (e.createdAt < todayMs) continue;
      if (e.kind === "expense") expenseToday += e.amount;
      else if (e.kind === "cash_in") cashInToday += e.amount;
      else cashOutToday += e.amount;
    }
    return { expenseToday, cashInToday, cashOutToday };
  }, [entries]);

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const v = Number(amount);
    if (!(v > 0)) return;
    addEntry({
      kind,
      category: kind === "expense" ? category : undefined,
      method,
      amount: v,
      note: note.trim() || undefined,
    });
    setAmount("");
    setNote("");
  };

  return (
    <div>
      <div className="flex items-center gap-3">
        <span className="grid h-10 w-10 place-items-center rounded-xl bg-waka-100 text-waka-700">
          <Wallet className="h-5 w-5" />
        </span>
        <div>
          <h1 className="text-2xl font-black">Expenses & cash log</h1>
          <p className="text-xs text-muted-foreground">
            Cash entries reduce or add to your expected drawer at day-close.
          </p>
        </div>
      </div>

      <div className="mt-5 grid gap-3 sm:grid-cols-3">
        <Stat label="Expenses today" value={formatUGX(totals.expenseToday)} tone="rose" />
        <Stat label="Cash in today" value={formatUGX(totals.cashInToday)} tone="emerald" />
        <Stat label="Cash out today" value={formatUGX(totals.cashOutToday)} tone="amber" />
      </div>

      {!currentDay && (
        <p className="mt-4 rounded-xl border border-amber-300/60 bg-amber-50 px-3 py-2 text-xs text-amber-900">
          No day is open. Entries still record but won't affect a day-close until you open one.
        </p>
      )}

      <section className="mt-6 rounded-2xl border border-border/60 bg-card p-5">
        <h2 className="text-sm font-black uppercase tracking-wider">Record entry</h2>
        <form onSubmit={onSubmit} className="mt-4 space-y-4">
          <div className="grid grid-cols-3 gap-2">
            {([
              { id: "expense", label: "Expense", icon: ReceiptIcon },
              { id: "cash_out", label: "Cash out", icon: ArrowUpCircle },
              { id: "cash_in", label: "Cash in", icon: ArrowDownCircle },
            ] as const).map((k) => {
              const Icon = k.icon;
              const active = kind === k.id;
              return (
                <button
                  type="button"
                  key={k.id}
                  onClick={() => setKind(k.id)}
                  className={`flex flex-col items-center gap-1.5 rounded-2xl border-2 p-3 text-xs font-bold ${
                    active ? "border-waka-600 bg-waka-50 text-waka-700" : "border-border text-foreground/70"
                  }`}
                >
                  <Icon className="h-5 w-5" />
                  {k.label}
                </button>
              );
            })}
          </div>

          {kind === "expense" && (
            <div>
              <label className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Category</label>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {CATEGORIES.map((c) => (
                  <button
                    type="button"
                    key={c}
                    onClick={() => setCategory(c)}
                    className={`rounded-full border px-3 py-1 text-xs font-bold ${
                      category === c ? "border-waka-600 bg-waka-600 text-primary-foreground" : "border-border text-foreground/70"
                    }`}
                  >
                    {c}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div>
            <label className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Method</label>
            <div className="mt-2 inline-flex rounded-full border border-border p-1">
              {(["cash", "momo", "bank"] as const).map((m) => (
                <button
                  type="button"
                  key={m}
                  onClick={() => setMethod(m)}
                  className={`rounded-full px-4 py-1.5 text-xs font-bold uppercase ${
                    method === m ? "bg-waka-600 text-primary-foreground" : "text-foreground/70"
                  }`}
                >
                  {m}
                </button>
              ))}
            </div>
          </div>

          <div className="grid gap-2 sm:grid-cols-2">
            <input
              type="number"
              min="0"
              required
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="Amount UGX"
              className="rounded-xl border border-border bg-background px-3 py-2.5 text-sm"
            />
            <input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Note (optional)"
              className="rounded-xl border border-border bg-background px-3 py-2.5 text-sm"
            />
          </div>

          <button className="w-full rounded-full bg-waka-600 py-3 text-sm font-bold text-primary-foreground hover:bg-waka-700">
            Save entry
          </button>
        </form>
      </section>

      <section className="mt-8">
        <h2 className="text-sm font-black uppercase tracking-wider text-muted-foreground">Recent entries</h2>
        {entries.length === 0 ? (
          <div className="mt-3 rounded-2xl border border-dashed border-border bg-card/50 p-8 text-center text-sm text-muted-foreground">
            No entries yet.
          </div>
        ) : (
          <ul className="mt-3 space-y-2">
            {entries.slice(0, 50).map((e) => {
              const isIn = e.kind === "cash_in";
              const signed = `${isIn ? "+" : "−"} ${formatUGX(e.amount)}`;
              return (
                <li
                  key={e.id}
                  className="flex items-start justify-between gap-3 rounded-2xl border border-border/60 bg-card p-4"
                >
                  <div className="min-w-0">
                    <p className="text-sm font-bold">
                      {e.kind === "expense" ? (e.category ?? "Expense") : e.kind === "cash_in" ? "Cash in" : "Cash out"}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {new Date(e.createdAt).toLocaleString("en-UG", { dateStyle: "medium", timeStyle: "short" })}
                      {" · "}{e.method.toUpperCase()}
                      {e.note ? ` · ${e.note}` : ""}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <span
                      className={`text-sm font-black ${
                        isIn ? "text-emerald-700" : "text-rose-700"
                      }`}
                    >
                      {signed}
                    </span>
                    <button
                      onClick={() => removeEntry(e.id)}
                      className="rounded-full p-1.5 text-muted-foreground hover:bg-muted hover:text-destructive"
                      aria-label="Delete entry"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone: "rose" | "emerald" | "amber" }) {
  const cls =
    tone === "rose"
      ? "text-rose-700"
      : tone === "emerald"
        ? "text-emerald-700"
        : "text-amber-700";
  return (
    <div className="rounded-2xl border border-border/60 bg-card p-4">
      <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className={`mt-1 text-xl font-black ${cls}`}>{value}</p>
    </div>
  );
}
