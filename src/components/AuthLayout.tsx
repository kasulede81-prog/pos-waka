import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { Bookmark, ChevronDown, FileText, Globe, Headphones, Shield } from "lucide-react";
import type { Language } from "../types";
import { languageToggleLabel, nextLanguage } from "../lib/language";
import { WakaPosLogo } from "./brand/WakaLogo";
import { WAKA_BRAND_NAME, WAKA_LEGAL_COMPANY_NAME, WAKA_SLOGAN } from "../config/wakaSupport";
import { AppThemeToggle } from "./ui/AppThemeToggle";

type Props = {
  lang: Language;
  setLang: (lg: Language) => void;
  children: ReactNode;
  /** Logo link target (default sign-in). */
  brandHref?: string;
};

export function AuthLayout({ lang, setLang, children, brandHref = "/login" }: Props) {
  return (
    <div className="auth-scroll-root relative flex h-dvh max-h-[100dvh] flex-col overflow-hidden bg-brand-cream-wash transition-colors duration-300 dark:bg-foreground">
      <div
        className="pointer-events-none absolute -left-24 -top-24 h-72 w-72 rounded-full bg-waka-300/30 blur-3xl dark:bg-waka-600/15"
        aria-hidden
      />
      <div
        className="pointer-events-none absolute -right-20 top-1/4 h-56 w-56 rounded-full bg-waka-200/40 blur-3xl dark:bg-waka-500/10"
        aria-hidden
      />
      <div
        className="pointer-events-none absolute bottom-0 left-1/4 h-48 w-48 rounded-full bg-waka-100/50 blur-3xl dark:bg-waka-900/10"
        aria-hidden
      />

      <div className="auth-scroll-pane relative min-h-0 flex-1 overflow-x-hidden overflow-y-auto overscroll-y-contain [-webkit-overflow-scrolling:touch]">
        <div className="mx-auto w-full max-w-md px-4 pb-[max(1.5rem,env(safe-area-inset-bottom,0px))] pt-[max(1rem,env(safe-area-inset-top,0px))] sm:py-8">
          <header className="flex items-center justify-between gap-3">
            <Link to={brandHref} className="block min-w-0 rounded-2xl py-1">
              <WakaPosLogo size="sm" className="max-w-[min(100%,220px)]" />
            </Link>
            <div className="flex shrink-0 items-center gap-2">
              <AppThemeToggle lang={lang} />
              <button
                type="button"
                onClick={() => setLang(nextLanguage(lang))}
                className="inline-flex min-h-[40px] shrink-0 items-center gap-1.5 rounded-xl border border-border bg-card px-2.5 py-2 text-sm font-semibold text-foreground shadow-sm active:bg-muted dark:bg-foreground dark:text-background"
              >
                <Globe className="h-4 w-4 text-muted-foreground" aria-hidden />
                <span>{languageToggleLabel(lang)}</span>
                <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />
              </button>
            </div>
          </header>

          <main className="py-5 sm:py-6">{children}</main>

          <footer className="pb-2 text-center">
            <p className="text-sm font-black tracking-wide text-foreground dark:text-background">{WAKA_BRAND_NAME}</p>
            <p className="mt-0.5 text-xs font-medium text-muted-foreground dark:text-muted-foreground">{WAKA_SLOGAN}</p>
            <p className="mt-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground dark:text-muted-foreground">
              © {new Date().getFullYear()} {WAKA_LEGAL_COMPANY_NAME}
            </p>
            <nav className="mt-3 flex flex-wrap items-center justify-center gap-x-1 gap-y-1 text-xs font-semibold text-muted-foreground dark:text-muted-foreground">
              <FooterLink to="/terms" icon={FileText} label="Terms" />
              <span className="text-muted-foreground" aria-hidden>
                ·
              </span>
              <FooterLink to="/privacy" icon={Shield} label="Privacy" />
              <span className="text-muted-foreground" aria-hidden>
                ·
              </span>
              <FooterLink to="/acceptable-use" icon={Bookmark} label="Acceptable use" />
              <span className="text-muted-foreground" aria-hidden>
                ·
              </span>
              <FooterLink to="/support" icon={Headphones} label="Support" />
            </nav>
          </footer>
        </div>
      </div>
    </div>
  );
}

function FooterLink({ to, icon: Icon, label }: { to: string; icon: typeof FileText; label: string }) {
  return (
    <Link
      to={to}
      className="inline-flex items-center gap-1 rounded-lg px-1.5 py-1 transition hover:text-waka-600 dark:hover:text-waka-400"
    >
      <Icon className="h-3.5 w-3.5" aria-hidden />
      {label}
    </Link>
  );
}
