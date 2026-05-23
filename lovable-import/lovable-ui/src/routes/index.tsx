import { createFileRoute, Link } from "@tanstack/react-router";
import { ShoppingBag, Package, Wallet, WifiOff, ArrowRight, Check } from "lucide-react";
import { MarketingLayout } from "@/components/marketing/marketing-layout";
import { useI18n } from "@/lib/i18n";
import { seoHead } from "@/components/seo-head";

export const Route = createFileRoute("/")({
  head: () =>
    seoHead({
      title: "Waka POS — Run your shop with confidence",
      description:
        "Mobile-first point-of-sale for Ugandan shops. Track sales, stock, debts and suppliers. Works offline.",
      path: "/",
    }),
  component: HomePage,
});

function HomePage() {
  const { t } = useI18n();
  const features = [
    { icon: ShoppingBag, title: t("home.features.sell.title"), body: t("home.features.sell.body") },
    { icon: Package, title: t("home.features.stock.title"), body: t("home.features.stock.body") },
    { icon: Wallet, title: t("home.features.debt.title"), body: t("home.features.debt.body") },
    { icon: WifiOff, title: t("home.features.offline.title"), body: t("home.features.offline.body") },
  ];

  return (
    <MarketingLayout>
      {/* Hero */}
      <section className="relative overflow-hidden">
        <div className="absolute inset-0 -z-10 bg-gradient-to-b from-waka-50 via-background to-background" />
        <div className="mx-auto max-w-6xl px-4 pb-16 pt-12 sm:pt-20">
          <div className="grid items-center gap-12 md:grid-cols-2">
            <div>
              <span className="inline-flex items-center rounded-full bg-waka-100 px-3 py-1 text-xs font-bold text-waka-900">
                {t("home.hero.eyebrow")}
              </span>
              <h1 className="mt-4 text-4xl font-black leading-[1.05] tracking-tight text-foreground sm:text-5xl md:text-6xl">
                {t("home.hero.title")}
              </h1>
              <p className="mt-5 max-w-lg text-lg text-muted-foreground">
                {t("home.hero.subtitle")}
              </p>
              <div className="mt-7 flex flex-wrap gap-3">
                <Link
                  to="/register"
                  className="inline-flex items-center gap-2 rounded-full bg-primary px-6 py-3 text-sm font-bold text-primary-foreground shadow-lg shadow-primary/30 transition hover:bg-primary/90"
                >
                  {t("home.hero.cta.primary")}
                  <ArrowRight className="h-4 w-4" />
                </Link>
                <Link
                  to="/demo"
                  className="inline-flex items-center rounded-full border border-border bg-card px-6 py-3 text-sm font-bold text-foreground hover:bg-muted"
                >
                  {t("home.hero.cta.secondary")}
                </Link>
              </div>
            </div>

            {/* Mock device card */}
            <div className="relative">
              <div className="mx-auto max-w-sm rotate-1 rounded-3xl border border-border/60 bg-card p-5 shadow-2xl shadow-primary/10">
                <div className="rounded-2xl bg-foreground p-3 text-background">
                  <p className="text-[10px] uppercase tracking-wider text-background/60">Today</p>
                  <p className="mt-1 text-3xl font-black">UGX 1,240,500</p>
                  <p className="text-xs text-background/60">42 sales · 7 on credit</p>
                </div>
                <div className="mt-4 grid grid-cols-3 gap-2">
                  {["Soda", "Sugar", "Bread", "Rice", "Soap", "Eggs"].map((p) => (
                    <div
                      key={p}
                      className="rounded-xl border border-border bg-secondary p-3 text-center"
                    >
                      <div className="mx-auto mb-1.5 h-8 w-8 rounded-full bg-waka-100" />
                      <p className="text-xs font-bold text-foreground">{p}</p>
                    </div>
                  ))}
                </div>
                <button className="mt-4 w-full rounded-xl bg-primary py-3 text-sm font-bold text-primary-foreground">
                  Checkout
                </button>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Features */}
      <section className="border-y border-border/60 bg-card/40">
        <div className="mx-auto max-w-6xl px-4 py-16">
          <h2 className="text-3xl font-black tracking-tight text-foreground sm:text-4xl">
            {t("home.features.title")}
          </h2>
          <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {features.map((f) => {
              const Icon = f.icon;
              return (
                <div
                  key={f.title}
                  className="rounded-2xl border border-border/60 bg-card p-5 transition hover:border-primary/40 hover:shadow-md"
                >
                  <div className="grid h-10 w-10 place-items-center rounded-xl bg-waka-100 text-waka-700">
                    <Icon className="h-5 w-5" />
                  </div>
                  <p className="mt-3 text-base font-bold text-foreground">{f.title}</p>
                  <p className="mt-1 text-sm text-muted-foreground">{f.body}</p>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* Pricing teaser */}
      <section className="mx-auto max-w-6xl px-4 py-16">
        <div className="rounded-3xl bg-gradient-to-br from-waka-600 to-waka-700 p-8 text-primary-foreground sm:p-12">
          <h2 className="max-w-xl text-3xl font-black sm:text-4xl">{t("home.pricing.title")}</h2>
          <p className="mt-3 max-w-xl text-primary-foreground/90">{t("home.pricing.body")}</p>
          <ul className="mt-6 grid max-w-xl gap-2 text-sm">
            {["Free up to 10 products", "Add staff with PINs", "Mobile money + cash + credit"].map(
              (i) => (
                <li key={i} className="flex items-center gap-2">
                  <Check className="h-4 w-4" /> {i}
                </li>
              ),
            )}
          </ul>
          <Link
            to="/register"
            className="mt-7 inline-flex items-center gap-2 rounded-full bg-background px-6 py-3 text-sm font-bold text-foreground hover:bg-background/90"
          >
            {t("home.cta.create")} <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
      </section>

      {/* Founder */}
      <section className="bg-card/40">
        <div className="mx-auto max-w-3xl px-4 py-16 text-center">
          <div className="mx-auto mb-4 h-20 w-20 rounded-full bg-gradient-to-br from-waka-200 to-waka-500" />
          <h2 className="text-2xl font-black text-foreground sm:text-3xl">
            {t("home.founder.title")}
          </h2>
          <p className="mt-3 text-muted-foreground">{t("home.founder.body")}</p>
          <Link
            to="/founder"
            className="mt-5 inline-flex items-center gap-1 text-sm font-bold text-primary hover:underline"
          >
            {t("nav.founder")} <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
      </section>
    </MarketingLayout>
  );
}
