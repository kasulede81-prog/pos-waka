import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowRight, Package, ShoppingBag, Sparkles, ShieldCheck } from "lucide-react";
import { seoHead } from "@/components/seo-head";
import { usePOS, formatUGX } from "@/lib/pos-store";
import { useI18n } from "@/lib/i18n";
import { FinishProfileForm } from "@/components/finish-profile-form";

export const Route = createFileRoute("/_authenticated/dashboard")({
  head: () => seoHead({ title: "Home — Waka POS", description: "Your shop today.", path: "/dashboard" }),
  component: DashboardPage,
});

function DashboardPage() {
  const { t } = useI18n();
  const products = usePOS((s) => s.products);
  const sales = usePOS((s) => s.sales);
  const customers = usePOS((s) => s.customers);
  const localProfile = usePOS((s) => s.profile);

  const today = new Date().toDateString();
  const todaySales = sales.filter((s) => new Date(s.createdAt).toDateString() === today);
  const todayTotal = todaySales.reduce((a, b) => a + b.total, 0);
  const creditToday = todaySales
    .filter((s) => s.method === "credit")
    .reduce((a, b) => a + b.total, 0);
  const lowStock = products.filter((p) => p.stock <= 5);
  const totalDebt = customers.reduce((a, c) => a + c.balance, 0);

  const quickProducts = products.slice(0, 9);
  const profileIncomplete = !localProfile.shopName || !localProfile.phone;

  return (
    <div className="space-y-4">
      {profileIncomplete && <FinishProfileForm />}

      {/* Quick products */}
      <div className="rounded-2xl bg-card p-5 shadow-sm">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-black">Quick products</h2>
          {quickProducts.length > 0 && (
            <Link to="/sell" className="inline-flex items-center gap-1 text-sm font-bold text-waka-700">
              Sell <ArrowRight className="h-4 w-4" />
            </Link>
          )}
        </div>
        {quickProducts.length === 0 ? (
          <EmptyState
            icon={<Package className="h-5 w-5" />}
            title={t("empty.quick_products.title")}
            body={t("empty.quick_products.body")}
            cta={{ to: "/products", label: t("empty.quick_products.cta") }}
          />
        ) : (
          <div className="mt-3 flex flex-wrap gap-2">
            {quickProducts.map((p) => (
              <Link
                key={p.id}
                to="/sell"
                search={{ add: p.id } as never}
                className="rounded-full bg-waka-50 px-3.5 py-1.5 text-sm font-bold text-waka-900 hover:bg-waka-100"
              >
                {p.name}
              </Link>
            ))}
          </div>
        )}
      </div>

      {/* Stat tiles */}
      <div className="grid grid-cols-2 gap-3">
        <div className="rounded-2xl bg-foreground p-5 text-background">
          <p className="text-[11px] font-bold uppercase tracking-wider text-background/70">Today</p>
          <p className="mt-2 text-3xl font-black">{formatUGX(todayTotal)}</p>
          <p className="mt-1 text-xs text-background/70">
            {todaySales.length} sales · {formatUGX(todayTotal)}
          </p>
        </div>
        <div className="rounded-2xl bg-rose-100 p-5 text-rose-900">
          <p className="text-[11px] font-bold uppercase tracking-wider">Low stock</p>
          <p className="mt-2 text-3xl font-black">{lowStock.length}</p>
          <p className="mt-3 text-xs font-bold text-rose-700">Refill soon</p>
        </div>
        <div className="col-span-2 rounded-2xl bg-gradient-to-br from-waka-500 to-waka-600 p-5 text-primary-foreground sm:col-span-1">
          <p className="text-[11px] font-bold uppercase tracking-wider text-primary-foreground/80">Credit given</p>
          <p className="mt-2 text-3xl font-black">{formatUGX(creditToday)}</p>
          <p className="mt-1 text-xs text-primary-foreground/80">Credit given today</p>
        </div>
        <div className="hidden rounded-2xl bg-card p-5 shadow-sm sm:block">
          <p className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">Owed to you</p>
          <p className="mt-2 text-3xl font-black">{formatUGX(totalDebt)}</p>
        </div>
      </div>

      {/* Today's sales */}
      <section className="rounded-2xl bg-card p-5 shadow-sm">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-black">Today's sales</h2>
          {todaySales.length > 0 && (
            <Link to="/receipts" className="text-sm font-bold text-waka-700">See all</Link>
          )}
        </div>
        {todaySales.length === 0 ? (
          <EmptyState
            icon={<ShoppingBag className="h-5 w-5" />}
            title={t("empty.today_sales.title")}
            body={t("empty.today_sales.body")}
            cta={{ to: "/sell", label: t("empty.today_sales.cta") }}
          />
        ) : (
          <ul className="mt-3 divide-y divide-border/60">
            {todaySales.slice(0, 5).map((s) => (
              <li key={s.id} className="flex items-center justify-between gap-3 py-2.5">
                <div className="min-w-0">
                  <p className="truncate text-sm font-bold">{formatUGX(s.total)} · {s.method.toUpperCase()}</p>
                  <p className="text-xs text-muted-foreground">
                    {new Date(s.createdAt).toLocaleTimeString("en-UG", { hour: "2-digit", minute: "2-digit" })}
                    {s.customerName ? ` · ${s.customerName}` : ""}
                  </p>
                </div>
                <span className="text-xs text-muted-foreground">
                  {s.items.length} item{s.items.length > 1 ? "s" : ""}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Selling fast */}
      <section className="rounded-2xl bg-card p-5 shadow-sm">
        <h2 className="text-lg font-black">Selling fast today</h2>
        {todaySales.length === 0 ? (
          <EmptyState
            icon={<Sparkles className="h-5 w-5" />}
            title={t("empty.selling_fast.title")}
            body={t("empty.selling_fast.body")}
          />
        ) : (
          <ul className="mt-3 space-y-2">
            {topSelling(todaySales).slice(0, 5).map((row) => (
              <li key={row.name} className="flex items-center justify-between rounded-xl bg-muted/40 px-3 py-2">
                <span className="text-sm font-bold">{row.name}</span>
                <span className="text-xs font-bold text-waka-700">×{row.qty}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Running low */}
      <section
        className={`rounded-2xl p-5 ${
          lowStock.length > 0 ? "border border-rose-200 bg-rose-50" : "bg-card shadow-sm"
        }`}
      >
        <h2 className={`text-lg font-black ${lowStock.length > 0 ? "text-rose-900" : ""}`}>
          Running low
        </h2>
        {lowStock.length === 0 ? (
          <EmptyState
            icon={<ShieldCheck className="h-5 w-5" />}
            title={t("empty.running_low.title")}
            body={t("empty.running_low.body")}
          />
        ) : (
          <ul className="mt-3 space-y-2">
            {lowStock.slice(0, 6).map((p) => (
              <li key={p.id} className="flex items-center justify-between rounded-xl bg-background px-4 py-3 shadow-sm">
                <span className="text-sm font-black text-rose-900">{p.name}</span>
                <span className="text-sm font-black text-rose-700">
                  {p.stock} {p.stock === 1 ? "piece" : "pieces"}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function EmptyState({
  icon,
  title,
  body,
  cta,
}: {
  icon: React.ReactNode;
  title: string;
  body: string;
  cta?: { to: string; label: string };
}) {
  return (
    <div className="mt-3 flex flex-col items-start gap-2 rounded-xl border border-dashed border-border bg-muted/30 px-4 py-5">
      <span className="grid h-9 w-9 place-items-center rounded-full bg-waka-100 text-waka-700">
        {icon}
      </span>
      <p className="text-sm font-black">{title}</p>
      <p className="text-xs text-muted-foreground">{body}</p>
      {cta && (
        <Link
          to={cta.to as never}
          className="mt-1 inline-flex items-center gap-1 rounded-full bg-waka-600 px-3.5 py-1.5 text-xs font-bold text-primary-foreground hover:bg-waka-700"
        >
          {cta.label} <ArrowRight className="h-3.5 w-3.5" />
        </Link>
      )}
    </div>
  );
}

function topSelling(sales: ReturnType<typeof usePOS.getState>["sales"]) {
  const map = new Map<string, number>();
  for (const s of sales) {
    for (const it of s.items) {
      map.set(it.name, (map.get(it.name) ?? 0) + it.qty);
    }
  }
  return Array.from(map.entries())
    .map(([name, qty]) => ({ name, qty }))
    .sort((a, b) => b.qty - a.qty);
}
