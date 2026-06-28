import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import type { Language } from "../../types";
import { languageToggleLabel, nextLanguage } from "../../lib/language";
import { WakaPosLogo } from "../brand/WakaLogo";
import { WAKA_BRAND_NAME, WAKA_LEGAL_COMPANY_NAME, WAKA_SLOGAN } from "../../config/wakaSupport";
import { t } from "../../lib/i18n";
import { BusinessBuilderScene } from "./BusinessBuilderScene";
import { BuilderProgressRail } from "./BuilderProgressRail";
import type { BuilderUnlock } from "../../lib/businessBuilder/businessSceneState";

export type BuilderFunnelStep = "account" | "business" | "setup" | "review" | "open";

type Props = {
  lang: Language;
  setLang: (lg: Language) => void;
  children: ReactNode;
  /** Current funnel step for breadcrumb (1–5). */
  funnelStep?: BuilderFunnelStep;
  unlocks?: BuilderUnlock[];
  showProgress?: boolean;
  previewLabel?: string;
  brandHref?: string;
  footer?: ReactNode;
};

const FUNNEL_STEPS: BuilderFunnelStep[] = ["account", "business", "setup", "review", "open"];

const FUNNEL_LABEL_KEYS: Record<BuilderFunnelStep, string> = {
  account: "builderStepAccount",
  business: "builderStepBusiness",
  setup: "builderStepSetup",
  review: "builderStepReview",
  open: "builderStepOpen",
};

export function BusinessBuilderShell({
  lang,
  setLang,
  children,
  funnelStep = "account",
  unlocks = [],
  showProgress = true,
  previewLabel,
  brandHref = "/login",
  footer,
}: Props) {
  const stepIndex = FUNNEL_STEPS.indexOf(funnelStep);

  return (
    <div className="builder-scroll-root flex h-dvh max-h-[100dvh] flex-col overflow-hidden bg-gradient-to-br from-orange-50 via-white to-stone-100">
      <div className="builder-scroll-pane min-h-0 flex-1 overflow-x-hidden overflow-y-auto overscroll-y-contain [-webkit-overflow-scrolling:touch]">
        <div className="mx-auto w-full max-w-6xl px-4 pb-[max(1.5rem,env(safe-area-inset-bottom,0px))] pt-[max(0.75rem,env(safe-area-inset-top,0px))] lg:px-8 lg:py-6">
          <header className="flex items-center justify-between gap-3 py-2">
            <Link to={brandHref} className="block min-w-0 rounded-2xl py-1">
              <WakaPosLogo size="md" className="max-w-[min(100%,240px)]" />
            </Link>
            <button
              type="button"
              onClick={() => setLang(nextLanguage(lang))}
              className="min-h-[44px] shrink-0 rounded-2xl border border-stone-200/80 bg-white/80 px-3 py-2 text-sm font-semibold text-stone-800 shadow-sm backdrop-blur-sm active:bg-stone-50"
            >
              {languageToggleLabel(lang)}
            </button>
          </header>

          {stepIndex >= 0 ? (
            <nav
              className="mb-3 flex flex-wrap items-center justify-center gap-1 text-[10px] font-bold uppercase tracking-wide sm:gap-2 sm:text-xs"
              aria-label={t(lang, "builderFunnelAria")}
            >
              {FUNNEL_STEPS.map((step, i) => {
                const active = i === stepIndex;
                const done = i < stepIndex;
                return (
                  <span key={step} className="flex items-center gap-1 sm:gap-2">
                    {i > 0 ? (
                      <span className="hidden h-px w-4 bg-stone-300 sm:block" aria-hidden />
                    ) : null}
                    <span
                      className={`rounded-full px-2.5 py-1 transition-colors sm:px-3 ${
                        active
                          ? "bg-gradient-to-r from-orange-500 to-orange-600 text-white shadow-md"
                          : done
                            ? "bg-emerald-100 text-emerald-800"
                            : "bg-stone-100 text-stone-500"
                      }`}
                    >
                      {i + 1}. {t(lang, FUNNEL_LABEL_KEYS[step])}
                    </span>
                  </span>
                );
              })}
            </nav>
          ) : null}

          <div className="builder-layout flex flex-col gap-4 lg:flex-row lg:items-stretch lg:gap-6">
            <aside
              className="builder-preview-pane order-1 lg:order-none lg:w-[45%] lg:shrink-0"
              aria-live="polite"
              aria-label={previewLabel ?? t(lang, "builderLivePreview")}
            >
              <div className="builder-preview-sticky lg:sticky lg:top-4">
                <div className="overflow-hidden rounded-[28px] border border-white/60 bg-gradient-to-b from-sky-100/80 via-white to-orange-50/60 p-3 shadow-[0_20px_60px_-20px_rgba(234,88,12,0.35)] backdrop-blur-sm sm:rounded-[32px] sm:p-4">
                  <div className="mb-2 flex items-center justify-between gap-2 px-1">
                    <span className="builder-live-tag inline-flex items-center gap-1.5 rounded-full bg-orange-500/10 px-2.5 py-1 text-[10px] font-black uppercase tracking-wider text-orange-700">
                      <span className="builder-live-dot h-1.5 w-1.5 rounded-full bg-orange-500" aria-hidden />
                      {t(lang, "builderLivePreview")}
                    </span>
                  </div>
                  <BusinessBuilderScene className="w-full" lang={lang} />
                  {showProgress && unlocks.length > 0 ? (
                    <BuilderProgressRail lang={lang} unlocks={unlocks} className="mt-3 hidden lg:block" />
                  ) : null}
                </div>
                {showProgress && unlocks.length > 0 ? (
                  <BuilderProgressRail lang={lang} unlocks={unlocks} className="mt-3 lg:hidden" />
                ) : null}
              </div>
            </aside>

            <main className="builder-form-pane order-2 min-w-0 flex-1 lg:w-[55%]">{children}</main>
          </div>

          <footer className="builder-trust-footer mt-8 grid grid-cols-2 gap-2 text-center text-[10px] font-bold text-stone-500 sm:grid-cols-4 lg:mt-10">
            <span className="rounded-2xl border border-stone-200/60 bg-white/60 px-2 py-2 backdrop-blur-sm">
              {t(lang, "builderTrustSecure")}
            </span>
            <span className="rounded-2xl border border-stone-200/60 bg-white/60 px-2 py-2 backdrop-blur-sm">
              {t(lang, "builderTrustOffline")}
            </span>
            <span className="rounded-2xl border border-stone-200/60 bg-white/60 px-2 py-2 backdrop-blur-sm">
              {t(lang, "builderTrustCloud")}
            </span>
            <span className="rounded-2xl border border-stone-200/60 bg-white/60 px-2 py-2 backdrop-blur-sm">
              {t(lang, "builderTrustBusiness")}
            </span>
          </footer>

          {footer ?? (
            <div className="mt-4 pb-2 text-center text-xs font-semibold text-stone-500">
              <p className="font-black text-stone-700">{WAKA_BRAND_NAME}</p>
              <p>{WAKA_SLOGAN}</p>
              <p className="mt-1 text-[10px] text-stone-400">
                © {new Date().getFullYear()} {WAKA_LEGAL_COMPANY_NAME}
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
