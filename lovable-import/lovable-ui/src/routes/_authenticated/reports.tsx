import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
  PieChart, Pie, Cell, Legend,
} from "recharts";
import { BarChart3, TrendingUp, Receipt as ReceiptIcon, Download } from "lucide-react";
import { seoHead } from "@/components/seo-head";
import { usePOS, formatUGX, type PayMethod } from "@/lib/pos-store";

export const Route = createFileRoute("/_authenticated/reports")({
  head: () => seoHead({ title: "Reports — Waka POS", description: "Sales trends, top products and payment breakdown.", path: "/reports" }),
  component: ReportsPage,
});

type Range = 7 | 30 | 90;

const METHOD_COLORS: Record<PayMethod, string> = {
  cash: "hsl(var(--chart-1, 142 71% 45%))",
  momo: "hsl(var(--chart-2, 38 92% 50%))",
  credit: "hsl(var(--chart-3, 0 84% 60%))",
};

const dayKey = (ts: number) => {
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

const shortDay = (key: string) => {
  const d = new Date(key);
  return d.toLocaleDateString("en-UG", { month: "short", day: "numeric" });
};

function ReportsPage() {
  const sales = usePOS((s) => s.sales);
  const products = usePOS((s) => s.products);
  const customers = usePOS((s) => s.customers);
  const [range, setRange] = useState<Range>(7);

  const stats = useMemo(() => {
    const cutoff = Date.now() - range * 24 * 60 * 60 * 1000;
    const inRange = sales.filter((s) => s.createdAt >= cutoff);

    // Daily series
    const byDay = new Map<string, number>();
    for (let i = range - 1; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      byDay.set(dayKey(d.getTime()), 0);
    }
    for (const s of inRange) {
      const k = dayKey(s.createdAt);
      byDay.set(k, (byDay.get(k) ?? 0) + s.total);
    }
    const daily = Array.from(byDay, ([day, total]) => ({ day: shortDay(day), total }));

    // Top products
    const productTotals = new Map<string, { name: string; revenue: number; qty: number }>();
    for (const s of inRange) {
      for (const it of s.items) {
        const cur = productTotals.get(it.productId) ?? { name: it.name, revenue: 0, qty: 0 };
        cur.revenue += it.price * it.qty;
        cur.qty += it.qty;
        productTotals.set(it.productId, cur);
      }
    }
    const topProducts = Array.from(productTotals.values())
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, 5);

    // Payment breakdown
    const byMethod: Record<PayMethod, number> = { cash: 0, momo: 0, credit: 0 };
    for (const s of inRange) byMethod[s.method] += s.total;
    const methodData = (Object.entries(byMethod) as Array<[PayMethod, number]>)
      .filter(([, v]) => v > 0)
      .map(([name, value]) => ({ name, value }));

    // KPIs
    const revenue = inRange.reduce((a, b) => a + b.total, 0);
    const tx = inRange.length;
    const avg = tx > 0 ? revenue / tx : 0;
    const debt = customers.reduce((a, c) => a + c.balance, 0);
    const lowStock = products.filter((p) => p.stock > 0 && p.stock <= 3).length;
    const outOfStock = products.filter((p) => p.stock === 0).length;

    return { daily, topProducts, methodData, revenue, tx, avg, debt, lowStock, outOfStock };
  }, [sales, products, customers, range]);

  const exportCSV = () => {
    const header = "date,id,total,method,customer,items\n";
    const rows = sales
      .filter((s) => s.createdAt >= Date.now() - range * 86400_000)
      .map((s) => {
        const date = new Date(s.createdAt).toISOString();
        const items = s.items.map((i) => `${i.name} x${i.qty}`).join("; ");
        const customer = (s.customerName ?? "").replace(/[",]/g, " ");
        return `${date},${s.id},${s.total},${s.method},"${customer}","${items}"`;
      })
      .join("\n");
    const blob = new Blob([header + rows], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `waka-sales-${range}d-${dayKey(Date.now())}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="grid h-10 w-10 place-items-center rounded-xl bg-waka-100 text-waka-700">
            <BarChart3 className="h-5 w-5" />
          </span>
          <h1 className="text-2xl font-black">Reports</h1>
        </div>
        <div className="flex items-center gap-2">
          <div className="inline-flex rounded-full border border-border p-1 text-xs font-bold">
            {([7, 30, 90] as const).map((r) => (
              <button
                key={r}
                onClick={() => setRange(r)}
                className={`rounded-full px-3 py-1.5 ${range === r ? "bg-waka-600 text-primary-foreground" : "text-foreground/70"}`}
              >
                {r}d
              </button>
            ))}
          </div>
          <button
            onClick={exportCSV}
            className="inline-flex items-center gap-1.5 rounded-full border border-border px-3 py-1.5 text-xs font-bold hover:bg-muted"
          >
            <Download className="h-3.5 w-3.5" /> CSV
          </button>
        </div>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <KPI label="Revenue" value={formatUGX(stats.revenue)} icon={TrendingUp} />
        <KPI label="Transactions" value={String(stats.tx)} icon={ReceiptIcon} />
        <KPI label="Avg ticket" value={formatUGX(stats.avg)} icon={TrendingUp} />
        <KPI label="Owed to you" value={formatUGX(stats.debt)} icon={ReceiptIcon} />
      </div>

      <section className="mt-6 rounded-2xl border border-border/60 bg-card p-4">
        <h2 className="text-sm font-bold text-foreground/80">Daily sales</h2>
        <div className="mt-3 h-56">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={stats.daily} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
              <XAxis dataKey="day" tick={{ fontSize: 11 }} stroke="hsl(var(--muted-foreground))" />
              <YAxis tick={{ fontSize: 11 }} stroke="hsl(var(--muted-foreground))" tickFormatter={(v) => Math.round(v / 1000) + "k"} />
              <Tooltip
                formatter={(v: number) => formatUGX(v)}
                contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 12, fontSize: 12 }}
              />
              <Bar dataKey="total" fill="hsl(var(--primary))" radius={[6, 6, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </section>

      <div className="mt-4 grid gap-4 md:grid-cols-2">
        <section className="rounded-2xl border border-border/60 bg-card p-4">
          <h2 className="text-sm font-bold text-foreground/80">Top products</h2>
          {stats.topProducts.length === 0 ? (
            <p className="mt-6 text-center text-xs text-muted-foreground">No sales yet in this range.</p>
          ) : (
            <ul className="mt-3 space-y-2">
              {stats.topProducts.map((p, i) => {
                const max = stats.topProducts[0].revenue || 1;
                const pct = Math.max(8, (p.revenue / max) * 100);
                return (
                  <li key={i} className="text-xs">
                    <div className="flex items-center justify-between">
                      <span className="truncate font-semibold">{p.name}</span>
                      <span className="ml-2 shrink-0 text-muted-foreground">{formatUGX(p.revenue)} · {p.qty}x</span>
                    </div>
                    <div className="mt-1 h-2 overflow-hidden rounded-full bg-muted">
                      <div className="h-full rounded-full bg-waka-600" style={{ width: `${pct}%` }} />
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <section className="rounded-2xl border border-border/60 bg-card p-4">
          <h2 className="text-sm font-bold text-foreground/80">Payment methods</h2>
          {stats.methodData.length === 0 ? (
            <p className="mt-6 text-center text-xs text-muted-foreground">No sales yet in this range.</p>
          ) : (
            <div className="h-56">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={stats.methodData} dataKey="value" nameKey="name" outerRadius={70} innerRadius={40} paddingAngle={2}>
                    {stats.methodData.map((m) => (
                      <Cell key={m.name} fill={METHOD_COLORS[m.name]} />
                    ))}
                  </Pie>
                  <Tooltip
                    formatter={(v: number) => formatUGX(v)}
                    contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 12, fontSize: 12 }}
                  />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                </PieChart>
              </ResponsiveContainer>
            </div>
          )}
        </section>
      </div>

      <section className="mt-4 grid gap-3 sm:grid-cols-2">
        <div className="rounded-2xl border border-amber-300/60 bg-amber-50 p-4 dark:bg-amber-950/30">
          <p className="text-xs font-bold uppercase tracking-wider text-amber-800 dark:text-amber-300">Low stock</p>
          <p className="mt-1 text-2xl font-black text-amber-900 dark:text-amber-200">{stats.lowStock}</p>
          <p className="text-xs text-amber-800/80 dark:text-amber-300/80">products with ≤ 3 units left</p>
        </div>
        <div className="rounded-2xl border border-destructive/40 bg-destructive/10 p-4">
          <p className="text-xs font-bold uppercase tracking-wider text-destructive">Out of stock</p>
          <p className="mt-1 text-2xl font-black text-destructive">{stats.outOfStock}</p>
          <p className="text-xs text-destructive/80">products at 0</p>
        </div>
      </section>
    </div>
  );
}

function KPI({ label, value, icon: Icon }: { label: string; value: string; icon: typeof TrendingUp }) {
  return (
    <div className="rounded-2xl border border-border/60 bg-card p-3">
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <Icon className="h-3.5 w-3.5" /> {label}
      </div>
      <p className="mt-1 truncate text-lg font-black">{value}</p>
    </div>
  );
}
