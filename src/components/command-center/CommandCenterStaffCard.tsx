import { Link } from "react-router-dom";
import clsx from "clsx";
import type { Language } from "../../types";
import { t } from "../../lib/i18n";
import type { StaffControlRow } from "../../lib/ownerCommandCenterBuilders";
import { formatShortUgx } from "../../lib/commandCenterPageView";
import { staffRiskBadge } from "../../lib/statusTokens";
import { chartStroke } from "../../lib/chartTokens";
import { EnterpriseCard } from "../enterprise/EnterpriseCard";
import { EnterpriseEmptyState } from "../enterprise/EnterpriseEmptyState";
import { Caption, SectionTitle } from "../enterprise/EnterpriseTypography";
import { WakaButton } from "../ui/wakaPrimitives";
import { Users } from "lucide-react";
import { statusTokens } from "../../lib/statusTokens";

type Props = {
  lang: Language;
  rows: StaffControlRow[];
  periodLabel: string;
};

function initials(label: string): string {
  const parts = label.trim().split(/\s+/);
  if (parts.length >= 2) return `${parts[0]![0] ?? ""}${parts[1]![0] ?? ""}`.toUpperCase();
  return (label[0] ?? "?").toUpperCase();
}

function TrustRing({ score }: { score: number }) {
  const r = 28;
  const c = 2 * Math.PI * r;
  const offset = c - (score / 100) * c;
  return (
    <div className="relative flex h-16 w-16 shrink-0 items-center justify-center">
      <svg viewBox="0 0 72 72" className="h-full w-full -rotate-90" aria-hidden>
        <circle cx="36" cy="36" r={r} fill="none" stroke={chartStroke.track} strokeWidth="6" />
        <circle
          cx="36"
          cy="36"
          r={r}
          fill="none"
          stroke={chartStroke.positive}
          strokeWidth="6"
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={offset}
        />
      </svg>
      <span className="absolute text-xs font-black tabular-nums text-success">{score}%</span>
    </div>
  );
}

export function CommandCenterStaffCard({ lang, rows, periodLabel }: Props) {
  const featured = rows.find((r) => r.hasActiveShift) ?? rows[0] ?? null;

  if (!featured) {
    return (
      <EnterpriseCard title={t(lang, "cmdCenterStaffTitle")}>
        <EnterpriseEmptyState
          icon={Users}
          title={t(lang, "ownerShiftEmpty")}
          className="!border-0 !bg-transparent !p-0 !shadow-none"
        />
        <Link to="/office/open-shifts" className="mt-3 block">
          <WakaButton type="button" variant="secondary" className="w-full">
            {t(lang, "ownerShiftViewAll")} →
          </WakaButton>
        </Link>
      </EnterpriseCard>
    );
  }

  return (
    <EnterpriseCard
      title={t(lang, "cmdCenterStaffTitle")}
      subtitle={periodLabel}
      actions={
        <Link to="/office/open-shifts" className="text-[11px] font-black text-waka-700">
          {t(lang, "cmdCenterAllShifts")} →
        </Link>
      }
    >
      <div className="flex gap-3 rounded-2xl bg-muted p-3">
        <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-waka-600 text-lg font-black text-white">
          {initials(featured.label)}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <SectionTitle as="p" className="!text-base">{featured.label}</SectionTitle>
            <span className={clsx("rounded-full px-2 py-0.5 text-[10px] font-black", staffRiskBadge(featured.riskTier === "offender" ? "offender" : featured.riskTier === "review" ? "review" : "ok"))}>
              {featured.riskTier === "trusted"
                ? t(lang, "ownerStaffRiskTrusted")
                : featured.riskTier === "review"
                  ? t(lang, "ownerStaffRiskReview")
                  : t(lang, "ownerStaffRiskOffender")}
            </span>
            {featured.hasActiveShift ? (
              <span className={clsx("rounded-full px-2 py-0.5 text-[10px] font-black uppercase", statusTokens.info.badge)}>
                {t(lang, "ownerShiftActive")}
              </span>
            ) : null}
          </div>
          <div className="mt-2 flex items-center gap-3">
            <TrustRing score={featured.riskScore} />
            <dl className="grid flex-1 grid-cols-2 gap-x-2 gap-y-1">
              <div>
                <dt><Caption>{t(lang, "ownerStaffColSales")}</Caption></dt>
                <dd className="font-black tabular-nums text-foreground">{formatShortUgx(featured.salesUgx)}</dd>
              </div>
              <div>
                <dt><Caption>{t(lang, "ownerStaffColVoids")}</Caption></dt>
                <dd className="font-black text-foreground">{featured.voidCount}</dd>
              </div>
              <div>
                <dt><Caption>{t(lang, "ownerStaffColReturns")}</Caption></dt>
                <dd className="font-black text-foreground">{featured.returnCount}</dd>
              </div>
              <div>
                <dt><Caption>{t(lang, "ownerStaffColDiscounts")}</Caption></dt>
                <dd className="font-black text-foreground">{featured.discountCount}</dd>
              </div>
            </dl>
          </div>
        </div>
      </div>

      {rows.length > 1 ? (
        <ul className="mt-3 space-y-1 border-t border-border pt-2">
          {rows.slice(1, 4).map((row) => (
            <li key={row.userId} className="flex items-center justify-between text-xs font-bold text-muted-foreground">
              <span>{row.label}</span>
              <span className="tabular-nums">{formatShortUgx(row.salesUgx)}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </EnterpriseCard>
  );
}
