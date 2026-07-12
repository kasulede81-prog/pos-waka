import { CheckCircle2, AlertTriangle, XCircle } from "lucide-react";
import clsx from "clsx";
import type { Language } from "../../types";
import { t, tTemplate } from "../../lib/i18n";
import {
  classifyCashVariance,
  logDrawerDiagnostic,
  varianceStateLabelKey,
  varianceStateStatusKind,
  type CashVarianceContext,
} from "../../lib/cashVarianceExperience";
import type { ShopPreferences } from "../../types";
import { statusTokens } from "../../lib/statusTokens";
import { Link } from "react-router-dom";
import { useEffect, useMemo } from "react";

type Props = {
  lang: Language;
  expectedCashUgx: number;
  countedCashUgx: number;
  preferences: Pick<ShopPreferences, "cashVarianceThresholdPct" | "cashVarianceThresholdUgxFixed">;
  context?: CashVarianceContext;
  showDecision?: boolean;
  showSettingsLink?: boolean;
  diagnosticEvent?: string;
  className?: string;
};

function StateIcon({ state }: { state: ReturnType<typeof classifyCashVariance>["state"] }) {
  if (state === "within_tolerance") return <CheckCircle2 className="h-5 w-5 shrink-0" aria-hidden />;
  if (state === "minor_variance") return <AlertTriangle className="h-5 w-5 shrink-0" aria-hidden />;
  return <XCircle className="h-5 w-5 shrink-0" aria-hidden />;
}

export function CashVarianceSummary({
  lang,
  expectedCashUgx,
  countedCashUgx,
  preferences,
  context = "shift_close",
  showDecision = true,
  showSettingsLink = false,
  diagnosticEvent,
  className,
}: Props) {
  const assessment = useMemo(
    () => classifyCashVariance(expectedCashUgx, countedCashUgx, preferences, context),
    [expectedCashUgx, countedCashUgx, preferences, context],
  );

  useEffect(() => {
    if (!diagnosticEvent) return;
    logDrawerDiagnostic(diagnosticEvent, assessment, { context });
  }, [diagnosticEvent, assessment, context]);

  const token = statusTokens[varianceStateStatusKind(assessment.state)];

  return (
    <div className={clsx("space-y-3", className)}>
      <dl className="grid gap-2 rounded-2xl border border-border bg-card p-4 text-sm">
        <div className="flex justify-between gap-3">
          <dt className="font-semibold text-muted-foreground">{t(lang, "drawerVarianceExpected")}</dt>
          <dd className="font-black tabular-nums text-foreground">
            UGX {assessment.expectedCashUgx.toLocaleString()}
          </dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt className="font-semibold text-muted-foreground">{t(lang, "drawerVarianceCounted")}</dt>
          <dd className="font-black tabular-nums text-foreground">
            UGX {assessment.countedCashUgx.toLocaleString()}
          </dd>
        </div>
        <div className="flex justify-between gap-3 border-t border-border pt-2">
          <dt className="font-semibold text-muted-foreground">{t(lang, "drawerVarianceAmount")}</dt>
          <dd className="font-black tabular-nums text-foreground">
            {assessment.varianceUgx >= 0 ? "+" : ""}UGX {assessment.varianceUgx.toLocaleString()}
          </dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt className="font-semibold text-muted-foreground">{t(lang, "drawerVarianceTolerance")}</dt>
          <dd className="font-black tabular-nums text-foreground">
            ±UGX {assessment.thresholdUgx.toLocaleString()}
          </dd>
        </div>
      </dl>

      <div className={clsx(token.banner, "flex items-start gap-3")}>
        <StateIcon state={assessment.state} />
        <div className="min-w-0 flex-1">
          <p className="font-black">{t(lang, varianceStateLabelKey(assessment.state))}</p>
          {showDecision ? (
            <p className="mt-1 text-sm font-semibold opacity-90">
              {tTemplate(lang, assessment.decisionKey, {
                amount: Math.abs(assessment.varianceUgx).toLocaleString(),
                tolerance: assessment.thresholdUgx.toLocaleString(),
              })}
            </p>
          ) : null}
        </div>
      </div>

      {showSettingsLink ? (
        <p className="text-xs font-medium text-muted-foreground">
          <Link to="/settings/cash-drawer" className="font-bold text-waka-700 underline">
            {t(lang, "cashManageDrawerSettings")}
          </Link>
        </p>
      ) : null}
    </div>
  );
}
