import { createFileRoute, Link } from "@tanstack/react-router";
import { Briefcase, Users, Truck, Wallet, Settings as Cog, ArrowRight, BarChart3, Receipt, Crown } from "lucide-react";
import { seoHead } from "@/components/seo-head";
import { usePOS, formatUGX, PLAN_LIMITS } from "@/lib/pos-store";
import { FinishProfileForm } from "@/components/finish-profile-form";

export const Route = createFileRoute("/_authenticated/office")({
  head: () => seoHead({ title: "Office — Waka POS", description: "Shop tools, suppliers, day-close and settings.", path: "/office" }),
  component: OfficePage,
});

function OfficePage() {
  const customers = usePOS((s) => s.customers);
  const suppliers = usePOS((s) => s.suppliers);
  const profile = usePOS((s) => s.profile);
  const currentDay = usePOS((s) => s.currentDay());
  const cashEntries = usePOS((s) => s.cashEntries);

  const customerDebt = customers.reduce((a, c) => a + c.balance, 0);
  const supplierDebt = suppliers.reduce((a, c) => a + c.balance, 0);

  const todayMs = (() => { const d = new Date(); d.setHours(0,0,0,0); return d.getTime(); })();
  const expenseToday = cashEntries
    .filter((e) => e.kind === "expense" && e.createdAt >= todayMs)
    .reduce((a, e) => a + e.amount, 0);

  const tiles = [
    { to: "/reports", icon: BarChart3, label: "Reports", sub: "Sales trends & top products" },
    { to: "/customers", icon: Users, label: "Customers", sub: `${formatUGX(customerDebt)} owed to you` },
    { to: "/suppliers", icon: Truck, label: "Suppliers", sub: `${formatUGX(supplierDebt)} you owe` },
    { to: "/expenses", icon: Receipt, label: "Expenses", sub: `${formatUGX(expenseToday)} today` },
    { to: "/day-close", icon: Wallet, label: "Day-close", sub: currentDay ? "Day open" : "Closed" },
    { to: "/upgrade", icon: Crown, label: "Upgrade", sub: `${PLAN_LIMITS[profile.plan].label} plan — see options` },
    { to: "/settings", icon: Cog, label: "Settings", sub: "Profile, language, printer" },
  ] as const;

  const profileIncomplete = !profile.shopName || !profile.phone;

  return (
    <div>
      <div className="flex items-center gap-3">
        <span className="grid h-10 w-10 place-items-center rounded-xl bg-waka-100 text-waka-700">
          <Briefcase className="h-5 w-5" />
        </span>
        <h1 className="text-2xl font-black">Back Office</h1>
      </div>
      <p className="mt-2 text-sm text-muted-foreground">Back-office tools for your shop.</p>

      {profileIncomplete && (
        <div className="mt-5">
          <FinishProfileForm returnTo="/dashboard" />
        </div>
      )}


      <div className="mt-6 grid gap-3 sm:grid-cols-2">
        {tiles.map((t) => {
          const Icon = t.icon;
          return (
            <Link
              key={t.to}
              to={t.to}
              className="group flex items-center justify-between rounded-2xl border border-border/60 bg-card p-5 hover:border-waka-500"
            >
              <span className="flex items-center gap-3">
                <span className="grid h-11 w-11 place-items-center rounded-xl bg-waka-100 text-waka-700">
                  <Icon className="h-5 w-5" />
                </span>
                <span>
                  <span className="block text-sm font-bold">{t.label}</span>
                  <span className="block text-xs text-muted-foreground">{t.sub}</span>
                </span>
              </span>
              <ArrowRight className="h-4 w-4 text-muted-foreground group-hover:text-waka-700" />
            </Link>
          );
        })}
      </div>
    </div>
  );
}
