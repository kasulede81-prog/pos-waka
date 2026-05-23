import { createFileRoute, Link } from "@tanstack/react-router";
import { Receipt as ReceiptIcon, Printer } from "lucide-react";
import { seoHead } from "@/components/seo-head";
import { usePOS, formatUGX, type Sale } from "@/lib/pos-store";
import { printReceipt } from "@/lib/printer";

export const Route = createFileRoute("/_authenticated/receipts")({
  head: () => seoHead({ title: "Receipts — Waka POS", description: "All your sales.", path: "/receipts" }),
  component: ReceiptsPage,
});

function ReceiptsPage() {
  const sales = usePOS((s) => s.sales);
  const profile = usePOS((s) => s.profile);
  const onPrint = async (s: Sale) => {
    try { await printReceipt(s, profile); }
    catch (e) { alert((e as Error).message); }
  };

  const today = new Date().toDateString();
  const todayTotal = sales
    .filter((s) => new Date(s.createdAt).toDateString() === today)
    .reduce((a, b) => a + b.total, 0);

  return (
    <div>
      <h1 className="text-2xl font-black">Receipts</h1>
      <div className="mt-4 grid gap-3 sm:grid-cols-3">
        <Stat label="Today" value={formatUGX(todayTotal)} />
        <Stat label="All time" value={formatUGX(sales.reduce((a, b) => a + b.total, 0))} />
        <Stat label="Count" value={String(sales.length)} />
      </div>

      {sales.length === 0 ? (
        <div className="mt-6 rounded-2xl border border-dashed border-border bg-card/50 p-10 text-center">
          <ReceiptIcon className="mx-auto h-8 w-8 text-muted-foreground" />
          <p className="mt-3 text-sm font-semibold">No receipts yet</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Make your first sale on the{" "}
            <Link to="/sell" className="text-waka-700 underline">Sell screen</Link>.
          </p>
        </div>
      ) : (
        <ul className="mt-6 space-y-2">
          {sales.map((s) => (
            <li key={s.id} className="rounded-2xl border border-border/60 bg-card p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                    {new Date(s.createdAt).toLocaleString("en-UG", {
                      dateStyle: "medium",
                      timeStyle: "short",
                    })}
                  </p>
                  <p className="mt-0.5 text-sm">
                    {s.items.length} item{s.items.length > 1 ? "s" : ""}
                    {s.customerName ? ` · ${s.customerName}` : ""}
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-lg font-black text-waka-700">{formatUGX(s.total)}</p>
                  <span
                    className={`mt-1 inline-block rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${
                      s.method === "credit"
                        ? "bg-amber-100 text-amber-800"
                        : s.method === "momo"
                          ? "bg-sky-100 text-sky-800"
                          : "bg-emerald-100 text-emerald-800"
                    }`}
                  >
                    {s.method}
                  </span>
                </div>
              </div>
              <ul className="mt-3 space-y-1 border-t border-border/60 pt-3 text-xs text-muted-foreground">
                {s.items.map((i) => (
                  <li key={i.productId} className="flex justify-between">
                    <span>{i.name} × {i.qty}</span>
                    <span>{formatUGX(i.price * i.qty)}</span>
                  </li>
                ))}
              </ul>
              <button
                onClick={() => onPrint(s)}
                className="mt-3 inline-flex items-center gap-1.5 rounded-full border border-border px-3 py-1.5 text-xs font-bold hover:bg-muted"
              >
                <Printer className="h-3.5 w-3.5" /> Print
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-border/60 bg-card p-4">
      <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className="mt-1 text-xl font-black">{value}</p>
    </div>
  );
}
