import type { Language, ShiftRecord, ShopPreferences } from "../../types";
import { t } from "../../lib/i18n";
import { buildShiftCashAuditTimeline, classifyCashVariance, varianceStateLabelKey, varianceStateStatusKind } from "../../lib/cashVarianceExperience";
import { statusTokens } from "../../lib/statusTokens";
import clsx from "clsx";

type Props = {
  lang: Language;
  shift: ShiftRecord;
  expectedCashUgx: number;
  preferences: Pick<ShopPreferences, "cashVarianceThresholdPct" | "cashVarianceThresholdUgxFixed">;
  className?: string;
};

export function ShiftCashAuditTimeline({ lang, shift, expectedCashUgx, preferences, className }: Props) {
  const timeline = buildShiftCashAuditTimeline(shift, expectedCashUgx, preferences);
  const counted = shift.countedCashUgx ?? null;
  const assessment =
    counted != null ? classifyCashVariance(expectedCashUgx, counted, preferences, "shift_close") : null;

  return (
    <div className={clsx("rounded-2xl border border-border bg-card p-4", className)}>
      <h3 className="text-xs font-black uppercase tracking-wider text-muted-foreground">
        {t(lang, "drawerShiftTimelineTitle")}
      </h3>
      {assessment ? (
        <span
          className={clsx(
            "mt-2 inline-flex",
            statusTokens[varianceStateStatusKind(assessment.state)].badgeRing,
          )}
        >
          {t(lang, varianceStateLabelKey(assessment.state))}
        </span>
      ) : null}
      <ul className="mt-3 space-y-2">
        {timeline.map((entry) => (
          <li key={entry.id} className="flex items-center justify-between gap-3 text-sm">
            <span className="font-semibold text-muted-foreground">{t(lang, entry.labelKey)}</span>
            <span className="font-bold tabular-nums text-foreground">{entry.value}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
