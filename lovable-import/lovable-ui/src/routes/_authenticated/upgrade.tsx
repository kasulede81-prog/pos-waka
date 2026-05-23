import { createFileRoute, Link } from "@tanstack/react-router";
import { Crown, Check, ArrowLeft } from "lucide-react";
import { seoHead } from "@/components/seo-head";
import { usePOS, PLAN_LIMITS, type PlanId } from "@/lib/pos-store";

export const Route = createFileRoute("/_authenticated/upgrade")({
  head: () =>
    seoHead({
      title: "Upgrade plan — Waka POS",
      description: "Pick the Waka POS plan that fits your shop.",
      path: "/upgrade",
    }),
  component: UpgradePage,
});

const FEATURES: Record<PlanId, string[]> = {
  free: ["Up to 10 products", "Sell + receipts", "Single device"],
  starter: ["Up to 100 products", "Customers & debts", "Cloud backup", "WhatsApp receipts"],
  business: ["Up to 1,000 products", "Suppliers & expenses", "Reports & day-close", "Thermal printer"],
  waka_plus: ["Unlimited products", "Priority support", "Multi-device sync", "Everything in Business"],
};

function UpgradePage() {
  const profile = usePOS((s) => s.profile);
  const update = usePOS((s) => s.updateProfile);
  const plans: PlanId[] = ["free", "starter", "business", "waka_plus"];

  return (
    <div>
      <Link to="/office" className="inline-flex items-center gap-1 text-xs font-bold text-muted-foreground hover:text-waka-700">
        <ArrowLeft className="h-3.5 w-3.5" /> Back to office
      </Link>
      <div className="mt-3 flex items-center gap-3">
        <span className="grid h-10 w-10 place-items-center rounded-xl bg-amber-100 text-amber-700">
          <Crown className="h-5 w-5" />
        </span>
        <h1 className="text-2xl font-black">Upgrade your plan</h1>
      </div>
      <p className="mt-2 text-sm text-muted-foreground">
        Currently on <strong>{PLAN_LIMITS[profile.plan].label}</strong>. Pick a plan to unlock more.
      </p>

      <div className="mt-6 grid gap-3 sm:grid-cols-2">
        {plans.map((id) => {
          const p = PLAN_LIMITS[id];
          const active = profile.plan === id;
          return (
            <div
              key={id}
              className={`rounded-2xl border-2 p-5 ${
                active ? "border-waka-600 bg-waka-50" : "border-border bg-card"
              }`}
            >
              <div className="flex items-center justify-between">
                <span className="flex items-center gap-2 text-sm font-black">
                  {id === "waka_plus" && <Crown className="h-4 w-4 text-amber-500" />}
                  {p.label}
                </span>
                {active && (
                  <span className="rounded-full bg-waka-600 px-2 py-0.5 text-[10px] font-bold text-primary-foreground">
                    Active
                  </span>
                )}
              </div>
              <p className="mt-1 text-2xl font-black text-waka-700">{p.price}</p>
              <ul className="mt-3 space-y-1.5 text-xs">
                {FEATURES[id].map((f) => (
                  <li key={f} className="flex items-start gap-1.5">
                    <Check className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-emerald-600" />
                    <span>{f}</span>
                  </li>
                ))}
              </ul>
              <button
                onClick={() => update({ plan: id })}
                disabled={active}
                className="mt-4 w-full rounded-full bg-waka-600 px-4 py-2.5 text-xs font-bold text-primary-foreground disabled:opacity-40"
              >
                {active ? "Current plan" : `Switch to ${p.label}`}
              </button>
            </div>
          );
        })}
      </div>

      <p className="mt-4 text-xs text-muted-foreground">
        Plan changes apply instantly on this device. Billing & activation approval will come with full payment integration.
      </p>
    </div>
  );
}
