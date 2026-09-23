import clsx from "clsx";
import { Award, Percent, Star } from "lucide-react";
import type { Language } from "../../types";
import { t } from "../../lib/i18n";
import { formatShortUgx } from "../../lib/profitPageView";

type Props = {
  lang: Language;
  grossProfitUgx: number;
  revenueUgx: number;
  costUgx: number;
  marginPct: number;
  bestShelf: string | null;
  bestProduct: string | null;
  /** When true, headline gross profit is cost-incomplete (missing buy costs). */
  costIncomplete?: boolean;
  /** Approved cash expenses for the same period, from the existing expenses source. */
  expensesUgx?: number | null;
};

function StatementRow({
  label,
  value,
  emphasis,
  valueClass,
}: {
  label: string;
  value: string;
  emphasis?: boolean;
  valueClass?: string;
}) {
  return (
    <div
      className={clsx(
        "flex items-baseline justify-between gap-3 px-3 py-2",
        emphasis && "border-t border-border/80 bg-muted/40",
      )}
    >
      <span
        className={clsx(
          "min-w-0 truncate",
          emphasis
            ? "text-xs font-black uppercase tracking-wide text-foreground"
            : "text-xs font-bold text-muted-foreground",
        )}
      >
        {label}
      </span>
      <span
        className={clsx(
          "shrink-0 tabular-nums",
          emphasis ? "text-base font-black" : "text-sm font-bold",
          valueClass ?? "text-foreground",
        )}
      >
        {value}
      </span>
    </div>
  );
}

function MiniTile({
  icon: Icon,
  label,
  value,
  valueClass,
}: {
  icon: typeof Award;
  label: string;
  value: string;
  valueClass?: string;
}) {
  return (
    <div className="flex min-h-[64px] flex-col justify-between rounded-2xl border border-border/90 bg-card p-2.5 shadow-sm">
      <div className="flex items-center gap-1.5">
        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
          <Icon className="h-3.5 w-3.5" aria-hidden />
        </span>
        <span className="line-clamp-2 text-[10px] font-bold uppercase leading-tight tracking-wide text-muted-foreground">
          {label}
        </span>
      </div>
      <p className={clsx("truncate text-sm font-black leading-tight tabular-nums", valueClass ?? "text-foreground")}>
        {value}
      </p>
    </div>
  );
}

export function ProfitStatGrid({
  lang,
  grossProfitUgx,
  revenueUgx,
  costUgx,
  marginPct,
  bestShelf,
  bestProduct,
  costIncomplete = false,
  expensesUgx = null,
}: Props) {
  const profitLabel = costIncomplete ? t(lang, "profitGrossProfitEstimated") : t(lang, "profitStatGrossProfit");
  const loss = grossProfitUgx < 0;

  return (
    <div className="space-y-2.5">
      <section
        className="rounded-3xl border border-waka-300 bg-gradient-to-br from-waka-50 to-waka-50/60 px-4 py-5 text-center shadow-sm"
        aria-label={profitLabel}
      >
        <p className="text-[11px] font-black uppercase tracking-[0.18em] text-muted-foreground">{profitLabel}</p>
        <p
          className={clsx(
            "mt-1.5 text-3xl font-black leading-tight tabular-nums sm:text-4xl",
            loss ? "text-rose-700" : "text-waka-800",
          )}
        >
          {formatShortUgx(grossProfitUgx)}
        </p>
        <p className="mt-1 text-xs font-bold text-muted-foreground tabular-nums">
          {t(lang, "profitStatMargin")} {marginPct.toFixed(1)}%
        </p>
      </section>

      <section className="overflow-hidden rounded-2xl border border-border/90 bg-card shadow-sm">
        <StatementRow label={t(lang, "profitStatRevenue")} value={formatShortUgx(revenueUgx)} />
        <StatementRow label={t(lang, "profitStatCost")} value={formatShortUgx(costUgx)} />
        <StatementRow
          label={profitLabel}
          value={formatShortUgx(grossProfitUgx)}
          emphasis
          valueClass={loss ? "text-rose-700" : "text-teal-800"}
        />
        {expensesUgx != null ? (
          <StatementRow label={t(lang, "cashPositionExpenses")} value={formatShortUgx(expensesUgx)} />
        ) : null}
      </section>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 sm:gap-2.5">
        <MiniTile
          icon={Percent}
          label={t(lang, "profitStatMargin")}
          value={`${marginPct.toFixed(1)}%`}
          valueClass={marginPct >= 0 ? "text-teal-800" : "text-rose-700"}
        />
        <MiniTile icon={Award} label={t(lang, "profitStatBestShelf")} value={bestShelf ?? "—"} />
        <MiniTile icon={Star} label={t(lang, "profitStatBestProduct")} value={bestProduct ?? "—"} />
      </div>

    </div>
  );
}
