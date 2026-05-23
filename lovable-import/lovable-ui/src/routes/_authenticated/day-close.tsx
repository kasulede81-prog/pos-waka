import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { Wallet, Lock, Unlock } from "lucide-react";
import { seoHead } from "@/components/seo-head";
import { usePOS, formatUGX } from "@/lib/pos-store";

export const Route = createFileRoute("/_authenticated/day-close")({
  head: () => seoHead({ title: "Day-close — Waka POS", description: "Open and close your cash drawer.", path: "/day-close" }),
  component: DayClosePage,
});

function DayClosePage() {
  const open = usePOS((s) => s.currentDay());
  const sales = usePOS((s) => s.sales);
  const cashEntries = usePOS((s) => s.cashEntries);
  const sessions = usePOS((s) => s.daySessions);
  const openDay = usePOS((s) => s.openDay);
  const closeDay = usePOS((s) => s.closeDay);

  const [opening, setOpening] = useState("");
  const [counted, setCounted] = useState("");
  const [note, setNote] = useState("");

  const cashSales = useMemo(() => {
    if (!open) return 0;
    return sales
      .filter((s) => s.method === "cash" && s.createdAt >= open.openedAt)
      .reduce((a, b) => a + b.total, 0);
  }, [sales, open]);

  const { cashExpense, cashIn, cashOut } = useMemo(() => {
    if (!open) return { cashExpense: 0, cashIn: 0, cashOut: 0 };
    let ex = 0, ci = 0, co = 0;
    for (const e of cashEntries) {
      if (e.method !== "cash" || e.createdAt < open.openedAt) continue;
      if (e.kind === "expense") ex += e.amount;
      else if (e.kind === "cash_in") ci += e.amount;
      else co += e.amount;
    }
    return { cashExpense: ex, cashIn: ci, cashOut: co };
  }, [cashEntries, open]);

  const expected = open ? open.openingFloat + cashSales + cashIn - cashExpense - cashOut : 0;

  const past = sessions.filter((d) => d.closedAt);

  return (
    <div>
      <div className="flex items-center gap-3">
        <span className="grid h-10 w-10 place-items-center rounded-xl bg-waka-100 text-waka-700">
          <Wallet className="h-5 w-5" />
        </span>
        <h1 className="text-2xl font-black">Day-close</h1>
      </div>

      {!open ? (
        <div className="mt-6 rounded-2xl border border-border/60 bg-card p-5">
          <div className="flex items-center gap-2 text-sm font-bold">
            <Lock className="h-4 w-4 text-muted-foreground" /> Drawer is closed
          </div>
          <p className="mt-1 text-xs text-muted-foreground">Open the day with your starting float to begin tracking cash.</p>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const v = Number(opening);
              if (v >= 0) { openDay(v); setOpening(""); }
            }}
            className="mt-4 flex gap-2"
          >
            <input
              type="number" min="0" required
              value={opening} onChange={(e) => setOpening(e.target.value)}
              placeholder="Opening float UGX"
              className="flex-1 rounded-xl border border-border bg-background px-3 py-2.5 text-sm"
            />
            <button className="rounded-full bg-waka-600 px-5 py-2.5 text-sm font-bold text-primary-foreground">Open day</button>
          </form>
        </div>
      ) : (
        <div className="mt-6 rounded-2xl border border-waka-500/40 bg-waka-50 p-5">
          <div className="flex items-center gap-2 text-sm font-bold text-waka-800">
            <Unlock className="h-4 w-4" /> Drawer open since{" "}
            {new Date(open.openedAt).toLocaleString("en-UG", { dateStyle: "medium", timeStyle: "short" })}
          </div>
          <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <Stat label="Opening float" value={formatUGX(open.openingFloat)} />
            <Stat label="Cash sales" value={formatUGX(cashSales)} />
            <Stat label="Cash in" value={`+ ${formatUGX(cashIn)}`} />
            <Stat label="Cash expenses" value={`− ${formatUGX(cashExpense)}`} />
            <Stat label="Cash out" value={`− ${formatUGX(cashOut)}`} />
            <Stat label="Expected in drawer" value={formatUGX(expected)} highlight />
          </div>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const v = Number(counted);
              if (v >= 0) {
                closeDay(v, note.trim() || undefined);
                setCounted(""); setNote("");
              }
            }}
            className="mt-5 grid gap-2 sm:grid-cols-[1fr_1fr_auto]"
          >
            <input
              type="number" min="0" required
              value={counted} onChange={(e) => setCounted(e.target.value)}
              placeholder="Counted cash UGX"
              className="rounded-xl border border-border bg-background px-3 py-2.5 text-sm"
            />
            <input
              value={note} onChange={(e) => setNote(e.target.value)}
              placeholder="Note (optional)"
              className="rounded-xl border border-border bg-background px-3 py-2.5 text-sm"
            />
            <button className="rounded-full bg-foreground px-5 py-2.5 text-sm font-bold text-background">Close day</button>
          </form>
        </div>
      )}

      {past.length > 0 && (
        <section className="mt-8">
          <h2 className="text-sm font-black uppercase tracking-wider text-muted-foreground">Past days</h2>
          <ul className="mt-3 space-y-2">
            {past.slice(0, 20).map((d) => (
              <li key={d.id} className="rounded-2xl border border-border/60 bg-card p-4">
                <div className="flex items-start justify-between gap-3">
                  <p className="text-sm font-bold">
                    {new Date(d.openedAt).toLocaleDateString("en-UG", { dateStyle: "medium" })}
                  </p>
                  <span
                    className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${
                      (d.variance ?? 0) === 0
                        ? "bg-emerald-100 text-emerald-800"
                        : (d.variance ?? 0) > 0
                          ? "bg-sky-100 text-sky-800"
                          : "bg-destructive/15 text-destructive"
                    }`}
                  >
                    {(d.variance ?? 0) === 0 ? "balanced" : (d.variance ?? 0) > 0 ? `+${formatUGX(d.variance!)}` : formatUGX(d.variance!)}
                  </span>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  Expected {formatUGX(d.expectedCash ?? 0)} · Counted {formatUGX(d.countedCash ?? 0)}
                </p>
                {d.note && <p className="mt-1 text-xs italic text-muted-foreground">"{d.note}"</p>}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function Stat({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className={`rounded-xl border p-3 ${highlight ? "border-waka-500 bg-background" : "border-border/60 bg-background"}`}>
      <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className={`mt-1 text-lg font-black ${highlight ? "text-waka-700" : ""}`}>{value}</p>
    </div>
  );
}
