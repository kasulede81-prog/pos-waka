import type { ReactNode } from "react";
import { useEffect, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import clsx from "clsx";
import { Menu, X } from "lucide-react";
import type { Language } from "../../types";
import { t } from "../../lib/i18n";
import {
  WAKA_BRAND_NAME,
  WAKA_LEGAL_COMPANY_NAME,
  WAKA_SUPPORT_EMAIL,
  WAKA_SUPPORT_WHATSAPP_WA_ME,
  wakaSupportWhatsAppUrl,
} from "../../config/company";
import { SOLUTION_NAV_LINKS } from "../../config/solutionPages";
import { WakaBrandWordmark } from "../brand/WakaLogo";
import { MarketingThemeToggle } from "./MarketingThemeToggle";
import {
  mktBtnPrimary,
  mktFooter,
  mktInputPill,
  mktNav,
  mktNavLink,
  mktPage,
} from "./marketingThemeClasses";

type Props = {
  lang: Language;
  setLang: (l: Language) => void;
  isAuthenticated: boolean;
  children: ReactNode;
};

const NAV = [
  { href: "/home#features", label: "Features" },
  { href: "/home#solutions", label: "Solutions" },
  { href: "/home#pricing", label: "Pricing" },
  { href: "/home#hardware", label: "Hardware" },
  { href: "/about", label: "About" },
  { href: "/home#faq", label: "FAQ" },
  { href: "/contact", label: "Contact" },
] as const;

const FOOTER = {
  product: [
    { to: "/home#features", label: "Features" },
    { to: "/home#pricing", label: "Pricing" },
    { to: "/home#hardware", label: "Hardware" },
    { to: "/demo", label: "Demo" },
  ],
  resources: [
    { to: "/support", label: "Support" },
    { to: "/home#faq", label: "FAQ" },
    { to: "/contact", label: "Contact" },
  ],
  company: [
    { to: "/about", label: "About" },
    { to: "/founder", label: "Founder" },
    { to: "/company", label: "Company" },
  ],
  legal: [
    { to: "/privacy", label: "Privacy" },
    { to: "/terms", label: "Terms" },
  ],
};

export function MarketingLayout({ lang, setLang, isAuthenticated, children }: Props) {
  return (
    <MarketingLayoutInner lang={lang} setLang={setLang} isAuthenticated={isAuthenticated}>
      {children}
    </MarketingLayoutInner>
  );
}

function MarketingLayoutInner({ lang, setLang, isAuthenticated, children }: Props) {
  const location = useLocation();
  const onHome = location.pathname === "/home";
  // Menu open state is keyed by pathname so navigation closes it during the
  // same render — avoids a setState-in-effect cascade the mobile menu would
  // otherwise trigger on every route change.
  const [menuOpenAt, setMenuOpenAt] = useState<string | null>(null);
  const menuOpen = menuOpenAt === location.pathname;
  const setMenuOpen = (open: boolean | ((prev: boolean) => boolean)) => {
    const next = typeof open === "function" ? open(menuOpen) : open;
    setMenuOpenAt(next ? location.pathname : null);
  };

  /** Release document scroll for marketing — overrides stale POS/auth shell locks. */
  useEffect(() => {
    document.body.style.overflow = "";
    document.documentElement.style.overflow = "";
  }, [location.pathname]);

  useEffect(() => {
    if (!location.hash) return;
    const id = decodeURIComponent(location.hash.slice(1));
    const scrollToHash = () => document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
    scrollToHash();
    const timer = window.setTimeout(scrollToHash, 150);
    return () => window.clearTimeout(timer);
  }, [location.pathname, location.hash]);

  return (
    <div className={clsx("marketing-site marketing-scroll-root min-h-dvh", mktPage)}>
      <header className={mktNav}>
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-4 py-3 sm:px-6 lg:px-8">
          <Link to="/home" className="shrink-0">
            <WakaBrandWordmark />
          </Link>

          <nav className="hidden items-center gap-1 lg:flex" aria-label="Primary">
            {NAV.map((item) => (
              <Link key={item.label} to={item.href} className={mktNavLink}>
                {item.label}
              </Link>
            ))}
          </nav>

          <div className="flex items-center gap-2">
            <MarketingThemeToggle className="hidden sm:flex" />
            <div className={clsx("hidden sm:flex", mktInputPill)}>
              {(["en", "lg", "sw"] as Language[]).map((code) => (
                <button
                  key={code}
                  type="button"
                  onClick={() => setLang(code)}
                  className={clsx(
                    "rounded-full px-2.5 py-1 uppercase transition duration-300",
                    lang === code
                      ? "bg-mkt-card text-waka-600 shadow-sm dark:text-waka-400"
                      : "text-mkt-text-secondary hover:text-mkt-text",
                  )}
                >
                  {code}
                </button>
              ))}
            </div>
            <MarketingThemeToggle variant="labeled" className="sm:hidden" />
            {!isAuthenticated ? (
              <>
                <Link
                  to="/login"
                  className="hidden rounded-full px-3 py-2 text-sm font-bold text-mkt-text-secondary transition duration-300 hover:bg-mkt-bg-secondary hover:text-waka-700 dark:hover:text-waka-400 sm:inline-flex"
                >
                  {t(lang, "marketingCtaLogin")}
                </Link>
                <Link
                  to="/register"
                  className={clsx(mktBtnPrimary, "min-h-[40px] rounded-full px-4 py-2 text-sm")}
                >
                  Start Free
                </Link>
              </>
            ) : (
              <Link
                to="/"
                className="inline-flex min-h-[40px] items-center rounded-full bg-mkt-text px-4 py-2 text-sm font-black text-mkt-bg transition duration-300 hover:opacity-90"
              >
                {t(lang, "activationContinueApp")}
              </Link>
            )}
            <button
              type="button"
              onClick={() => setMenuOpen((open) => !open)}
              aria-expanded={menuOpen}
              aria-controls="public-mobile-nav"
              aria-label={menuOpen ? "Close navigation" : "Open navigation"}
              className="inline-flex h-11 w-11 items-center justify-center rounded-full border border-mkt-border bg-mkt-card text-mkt-text lg:hidden"
            >
              {menuOpen ? <X className="h-5 w-5" aria-hidden /> : <Menu className="h-5 w-5" aria-hidden />}
            </button>
          </div>
        </div>
        {menuOpen ? (
          <nav id="public-mobile-nav" className="border-t border-mkt-border px-4 py-3 lg:hidden" aria-label="Mobile navigation">
            <div className="mx-auto grid max-w-7xl gap-1 sm:grid-cols-2">
              {NAV.map((item) => (
                <Link key={item.label} to={item.href} className="flex min-h-11 items-center rounded-lg px-3 text-sm font-bold text-mkt-text hover:bg-mkt-bg-secondary">
                  {item.label}
                </Link>
              ))}
              <Link to="/support" className="flex min-h-11 items-center rounded-lg px-3 text-sm font-bold text-mkt-text hover:bg-mkt-bg-secondary">Support</Link>
            </div>
          </nav>
        ) : null}
      </header>

      <main className={clsx("mx-auto max-w-7xl px-4 sm:px-6 lg:px-8", onHome ? "pb-0" : "py-10")}>{children}</main>

      <footer className={clsx(mktFooter, "px-4 py-14 sm:px-6 lg:px-8")}>
        <div className="mx-auto grid max-w-7xl gap-10 sm:grid-cols-2 lg:grid-cols-5">
          <div className="lg:col-span-2">
            <p className="text-xl font-black text-mkt-text">{WAKA_BRAND_NAME} POS</p>
            <p className="mt-2 max-w-sm text-sm font-medium leading-relaxed text-mkt-text-secondary">
              Offline-first point of sale for Ugandan shops, supermarkets, pharmacies, and restaurants.
            </p>
            <p className="mt-4 text-sm font-semibold text-mkt-text">
              <a href={`tel:+${WAKA_SUPPORT_WHATSAPP_WA_ME}`} className="transition hover:text-waka-700 dark:hover:text-waka-400">
                +256 792 521 711
              </a>
              <br />
              <a href={`mailto:${WAKA_SUPPORT_EMAIL}`} className="transition hover:text-waka-700 dark:hover:text-waka-400">
                {WAKA_SUPPORT_EMAIL}
              </a>
            </p>
            <a
              href={wakaSupportWhatsAppUrl()}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-4 inline-flex text-sm font-black text-waka-600 transition hover:text-waka-700 dark:text-waka-400 dark:hover:text-waka-300"
            >
              WhatsApp support →
            </a>
          </div>

          <FooterCol title="Product" links={FOOTER.product} />
          <FooterCol title="Solutions" links={SOLUTION_NAV_LINKS.map((l) => ({ to: l.path, label: l.label }))} />
          <div>
            <FooterCol title="Resources" links={FOOTER.resources} />
            <FooterCol title="Company" links={FOOTER.company} className="mt-8" />
          </div>
        </div>

        <div className="mx-auto mt-12 flex max-w-7xl flex-col gap-4 border-t border-mkt-border pt-8 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-xs text-mkt-text-secondary">© {new Date().getFullYear()} {WAKA_LEGAL_COMPANY_NAME}</p>
          <nav className="flex flex-wrap gap-4 text-xs font-bold text-mkt-text-secondary">
            {FOOTER.legal.map((l) => (
              <Link key={l.to} to={l.to} className="transition hover:text-waka-700 dark:hover:text-waka-400">
                {l.label}
              </Link>
            ))}
          </nav>
        </div>
      </footer>
    </div>
  );
}

function FooterCol({
  title,
  links,
  className,
}: {
  title: string;
  links: { to: string; label: string }[];
  className?: string;
}) {
  return (
    <div className={className}>
      <p className="text-xs font-black uppercase tracking-wider text-mkt-text-secondary">{title}</p>
      <ul className="mt-3 space-y-2">
        {links.map((l) => (
          <li key={`${title}-${l.to}`}>
            <Link
              to={l.to}
              className="text-sm font-semibold text-mkt-text transition hover:text-waka-700 dark:hover:text-waka-400"
            >
              {l.label}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
