import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { ArrowUpRight, BarChart3, CircleDollarSign, ShieldCheck } from "lucide-react";
import { WakaLogo } from "@/components/waka-logo";
import { LangToggle } from "@/components/lang-toggle";
import { useI18n } from "@/lib/i18n";

function CommerceVisual() {
  return (
    <div className="auth-visual" aria-hidden="true">
      <div className="auth-orbit auth-orbit-one" />
      <div className="auth-orbit auth-orbit-two" />
      <div className="auth-visual-grid" />
      <div className="auth-data-card auth-data-card-main">
        <div className="flex items-center justify-between text-xs text-white/60">
          <span>Today&apos;s sales</span>
          <ArrowUpRight className="size-4 text-emerald-300" />
        </div>
        <strong className="mt-3 block text-3xl tracking-tight text-white">UGX 8.42M</strong>
        <div className="mt-5 flex h-20 items-end gap-2">
          {[32, 46, 39, 62, 54, 76, 68, 92].map((height, index) => (
            <span key={index} className="auth-bar" style={{ height: `${height}%`, animationDelay: `${index * 70}ms` }} />
          ))}
        </div>
      </div>
      <div className="auth-data-card auth-data-card-float">
        <div className="flex size-9 items-center justify-center rounded-xl bg-orange-400/20 text-orange-200"><CircleDollarSign className="size-4" /></div>
        <div><span className="block text-[10px] uppercase tracking-widest text-white/45">Transactions</span><strong className="text-lg text-white">1,284</strong></div>
      </div>
      <div className="auth-visual-caption"><ShieldCheck className="size-4" /><span>Built for businesses that move</span></div>
    </div>
  );
}

function FeatureRail() {
  return (
    <aside className="hidden min-h-full flex-1 flex-col justify-between overflow-hidden rounded-[2rem] bg-[#171411] p-10 text-white lg:flex xl:p-14">
      <div className="relative z-10"><WakaLogo size="sm" tagline={false} showSync={false} /></div>
      <div className="relative z-10 max-w-md"><p className="mb-5 flex items-center gap-2 text-xs font-bold uppercase tracking-[0.24em] text-orange-300"><BarChart3 className="size-4" /> Commerce, in motion</p><h2 className="text-4xl font-semibold leading-[1.08] tracking-[-0.04em] xl:text-5xl">Every sale is a step forward.</h2><p className="mt-5 max-w-sm text-sm leading-6 text-white/55">A calm, capable workspace for the people powering your business.</p></div>
      <CommerceVisual />
    </aside>
  );
}

export function AuthLayout({
  children,
  title,
  subtitle,
}: {
  children: ReactNode;
  title: string;
  subtitle?: string;
}) {
  const { t } = useI18n();
  return (
    <div className="auth-page flex min-h-dvh flex-col bg-background px-4 py-4 sm:px-6 lg:p-6">
      <div className="mx-auto flex w-full max-w-[1440px] flex-1 flex-col">
        <header className="flex items-center justify-between px-1 py-2 lg:hidden"><Link to="/"><WakaLogo size="sm" tagline={false} /></Link><LangToggle /></header>
        <main className="grid flex-1 items-center gap-6 lg:grid-cols-[minmax(0,1.1fr)_minmax(400px,0.9fr)] lg:gap-10 xl:gap-20">
          <FeatureRail />
          <section className="mx-auto w-full max-w-[460px] py-6 lg:py-10">
            <div className="mb-8 hidden items-center justify-between lg:flex"><Link to="/"><WakaLogo size="sm" tagline={false} /></Link><LangToggle /></div>
            <div className="auth-card rounded-[1.75rem] border border-border/70 bg-card p-6 shadow-[0_24px_80px_-32px_hsl(var(--primary)/0.35)] sm:p-9">
              <div className="auth-copy"><h1 className="text-[2rem] font-semibold tracking-[-0.04em] text-foreground sm:text-[2.35rem]">{title}</h1>{subtitle && <p className="mt-2 text-sm leading-6 text-muted-foreground">{subtitle}</p>}</div>
              <div className="mt-8">{children}</div>
              <div className="mt-8 flex items-center justify-center gap-2 text-[11px] font-medium text-muted-foreground"><span className="auth-status-dot" /> Secure connection</div>
            </div>
            <p className="mt-5 text-center text-[11px] text-muted-foreground"><Link to="/terms" className="transition-colors hover:text-primary">{t("legal.terms")}</Link><span className="mx-2 opacity-40">·</span><Link to="/privacy" className="transition-colors hover:text-primary">{t("legal.privacy")}</Link></p>
          </section>
        </main>
      </div>
    </div>
  );
}

