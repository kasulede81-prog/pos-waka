import { Link } from "@tanstack/react-router";
import { Menu, X } from "lucide-react";
import { useState, type ReactNode } from "react";
import { WakaLogo } from "@/components/waka-logo";
import { LangToggle } from "@/components/lang-toggle";
import { useI18n } from "@/lib/i18n";

export function MarketingLayout({ children }: { children: ReactNode }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);

  const nav = [
    { to: "/about", label: t("nav.about") },
    { to: "/contact", label: t("nav.contact") },
    { to: "/support", label: t("nav.support") },
  ];

  return (
    <div className="flex min-h-dvh flex-col bg-background">
      <header className="sticky top-0 z-40 border-b border-border/60 bg-background/85 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3">
          <Link to="/" className="shrink-0">
            <WakaLogo size="sm" />
          </Link>
          <nav className="hidden items-center gap-6 md:flex">
            {nav.map((n) => (
              <Link
                key={n.to}
                to={n.to}
                className="text-sm font-medium text-foreground/80 transition hover:text-primary"
                activeProps={{ className: "text-primary" }}
              >
                {n.label}
              </Link>
            ))}
          </nav>
          <div className="hidden items-center gap-2 md:flex">
            <LangToggle />
            <Link
              to="/login"
              className="rounded-full px-4 py-2 text-sm font-semibold text-foreground hover:bg-muted"
            >
              {t("nav.login")}
            </Link>
            <Link
              to="/register"
              className="rounded-full bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground shadow-sm hover:bg-primary/90"
            >
              {t("nav.register")}
            </Link>
          </div>
          <button
            className="rounded-lg p-2 md:hidden"
            onClick={() => setOpen((v) => !v)}
            aria-label="Menu"
          >
            {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>
        </div>
        {open && (
          <div className="border-t border-border/60 bg-background md:hidden">
            <div className="mx-auto flex max-w-6xl flex-col gap-1 px-4 py-3">
              {nav.map((n) => (
                <Link
                  key={n.to}
                  to={n.to}
                  onClick={() => setOpen(false)}
                  className="rounded-lg px-3 py-2 text-sm font-medium text-foreground/80 hover:bg-muted"
                >
                  {n.label}
                </Link>
              ))}
              <div className="mt-2 flex items-center gap-2 border-t border-border/60 pt-3">
                <LangToggle />
                <Link
                  to="/login"
                  onClick={() => setOpen(false)}
                  className="flex-1 rounded-full border border-border px-4 py-2 text-center text-sm font-semibold"
                >
                  {t("nav.login")}
                </Link>
                <Link
                  to="/register"
                  onClick={() => setOpen(false)}
                  className="flex-1 rounded-full bg-primary px-4 py-2 text-center text-sm font-semibold text-primary-foreground"
                >
                  {t("nav.register")}
                </Link>
              </div>
            </div>
          </div>
        )}
      </header>

      <main className="flex-1">{children}</main>

      <footer className="border-t border-border/60 bg-foreground text-background/90">
        <div className="mx-auto grid max-w-6xl gap-8 px-4 py-12 md:grid-cols-4">
          <div className="md:col-span-2">
            <div className="flex items-center gap-2.5">
              <div className="grid h-10 w-10 place-items-center rounded-2xl bg-primary text-primary-foreground">
                <span className="font-black">W</span>
              </div>
              <div>
                <p className="text-base font-black">{t("brand.product")}</p>
                <p className="text-xs text-background/60">{t("brand.slogan")}</p>
              </div>
            </div>
            <p className="mt-4 max-w-sm text-sm text-background/70">{t("footer.note")}</p>
          </div>
          <div>
            <p className="mb-3 text-sm font-semibold">{t("brand.company")}</p>
            <ul className="space-y-2 text-sm text-background/70">
              <li><Link to="/about" className="hover:text-primary">{t("footer.about")}</Link></li>
              <li><Link to="/founder" className="hover:text-primary">{t("nav.founder")}</Link></li>
              <li><Link to="/company" className="hover:text-primary">{t("nav.company")}</Link></li>
              <li><Link to="/contact" className="hover:text-primary">{t("footer.contact")}</Link></li>
            </ul>
          </div>
          <div>
            <p className="mb-3 text-sm font-semibold">Legal</p>
            <ul className="space-y-2 text-sm text-background/70">
              <li><Link to="/terms" className="hover:text-primary">{t("footer.terms")}</Link></li>
              <li><Link to="/privacy" className="hover:text-primary">{t("footer.privacy")}</Link></li>
              <li><Link to="/refund-policy" className="hover:text-primary">{t("legal.refund")}</Link></li>
              <li><Link to="/acceptable-use" className="hover:text-primary">{t("legal.acceptable")}</Link></li>
            </ul>
          </div>
        </div>
        <div className="border-t border-background/10">
          <p className="mx-auto max-w-6xl px-4 py-4 text-xs text-background/60">
            {t("footer.copyright", { year: new Date().getFullYear(), legal: t("brand.legal") })}
          </p>
        </div>
      </footer>
    </div>
  );
}
