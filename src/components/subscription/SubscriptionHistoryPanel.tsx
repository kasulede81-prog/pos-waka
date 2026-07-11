import type { Language } from "../../types";
import { t } from "../../lib/i18n";
import {
  formatBillingStatusLabel,
  formatEffectivePlanLabel,
  formatSubscriptionTypeLabel,
  type SubscriptionHistoryRow,
} from "../../lib/subscriptionHistory";

type Props = {
  lang: Language;
  rows: SubscriptionHistoryRow[];
  compact?: boolean;
};

function fmtPlan(row: SubscriptionHistoryRow, side: "before" | "after"): string {
  const effective = side === "before" ? row.before : row.after;
  if (!effective) return "—";
  const plan = formatEffectivePlanLabel(effective);
  const status = formatBillingStatusLabel(effective.status);
  return `${plan} (${status})`;
}

export function SubscriptionHistoryPanel({ lang, rows, compact = false }: Props) {
  if (rows.length === 0) {
    return (
      <p className="rounded-xl bg-muted px-4 py-6 text-center text-sm font-semibold text-muted-foreground">
        {t(lang, "billingHistoryEmpty")}
      </p>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className={compact ? "w-full text-xs" : "w-full text-sm"}>
        <thead>
          <tr className="border-b border-border text-left text-[10px] font-black uppercase tracking-wide text-muted-foreground">
            <th className="px-2 py-2">{t(lang, "billingHistoryBefore")}</th>
            <th className="px-2 py-2">{t(lang, "billingHistoryAction")}</th>
            <th className="px-2 py-2">{t(lang, "billingHistoryAfter")}</th>
            <th className="px-2 py-2">{t(lang, "billingHistoryReason")}</th>
            <th className="px-2 py-2">{t(lang, "billingHistorySource")}</th>
            <th className="px-2 py-2">{t(lang, "billingHistoryOperator")}</th>
            <th className="px-2 py-2">{t(lang, "billingHistoryTimestamp")}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id} className="border-b border-border align-top">
              <td className="px-2 py-2 font-semibold text-muted-foreground">{fmtPlan(row, "before")}</td>
              <td className="px-2 py-2 font-black text-foreground">
                {row.action.replace(/^subscription\./, "").replace(/_/g, " ")}
              </td>
              <td className="px-2 py-2 font-semibold text-muted-foreground">{fmtPlan(row, "after")}</td>
              <td className="px-2 py-2 text-muted-foreground">{row.reason ?? "—"}</td>
              <td className="px-2 py-2 text-muted-foreground">{row.source ?? "—"}</td>
              <td className="px-2 py-2 font-mono text-[10px] text-muted-foreground">
                {row.operator ? row.operator.slice(0, 12) : "—"}
              </td>
              <td className="px-2 py-2 font-mono text-[10px] text-muted-foreground">
                {new Date(row.timestamp).toLocaleString("en-GB")}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {!compact ? (
        <p className="mt-2 text-[10px] text-muted-foreground">
          {t(lang, "billingHistoryTypeHint")}: {formatSubscriptionTypeLabel(rows[0]?.after?.subscriptionType ?? null)}
        </p>
      ) : null}
    </div>
  );
}
