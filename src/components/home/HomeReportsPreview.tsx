import { ArrowRight, BarChart3 } from "lucide-react";
import type { Language } from "../../types";
import { t } from "../../lib/i18n";
import type { HomeTileLiveStat } from "../../lib/homeExecutiveKpis";
import { EnterpriseCard } from "../enterprise/EnterpriseCard";
import { Caption, MonoNumber, SectionTitle } from "../enterprise/EnterpriseTypography";
import { enterpriseIconClass, ENTERPRISE_ICON_STROKE } from "../../lib/enterpriseIcons";

type Props = {
  lang: Language;
  liveStat?: HomeTileLiveStat;
  onOpen: () => void;
};

/** Phase 34.1 — Reports as executive scan, not a shouting gradient tile. */
export function HomeReportsPreview({ lang, liveStat, onOpen }: Props) {
  return (
    <EnterpriseCard className="!p-0 overflow-hidden">
      <button
        type="button"
        onClick={onOpen}
        className="flex w-full min-h-[88px] items-stretch gap-3 p-3 text-left transition-colors hover:bg-muted/40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-waka-500 sm:p-4"
      >
        <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-teal-700 text-white">
          <BarChart3 className={enterpriseIconClass("md")} strokeWidth={ENTERPRISE_ICON_STROKE} aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <SectionTitle as="span" className="!text-base">
            {t(lang, "desktopHomeTileReports")}
          </SectionTitle>
          <Caption className="mt-0.5 normal-case">{t(lang, "desktopHomeTileReportsSub")}</Caption>
          {liveStat ? (
            <div className="mt-2">
              <p className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">{liveStat.label}</p>
              <div className="mt-0.5 flex flex-wrap items-baseline gap-x-2">
                <MonoNumber className="text-lg">{liveStat.value}</MonoNumber>
                {liveStat.trend ? (
                  <span className="text-xs font-bold text-success">{liveStat.trend}</span>
                ) : null}
              </div>
            </div>
          ) : null}
        </div>
        <span className="flex shrink-0 items-center gap-1 self-center text-xs font-black text-waka-900">
          {t(lang, "desktopHomeCtaViewReports")}
          <ArrowRight className="h-4 w-4" aria-hidden />
        </span>
      </button>
    </EnterpriseCard>
  );
}
