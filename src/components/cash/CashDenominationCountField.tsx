import { useMemo, useState } from "react";
import clsx from "clsx";
import type { Language } from "../../types";
import { t } from "../../lib/i18n";
import {
  emptyDenominationCounts,
  formatDenominationLabel,
  sumDenominationCounts,
  UGX_DENOMINATIONS,
  type DenominationCounts,
} from "../../lib/cashDenominations";

type Props = {
  lang: Language;
  value: string;
  onChange: (next: string) => void;
  expectedUgx?: number;
  showVariance?: boolean;
  inputClassName?: string;
  /** When set, denominations mode is restored from this total only on first mount. */
  initialMode?: "total" | "denominations";
};

export function CashDenominationCountField({
  lang,
  value,
  onChange,
  expectedUgx,
  showVariance = false,
  inputClassName,
  initialMode = "total",
}: Props) {
  const [mode, setMode] = useState<"total" | "denominations">(initialMode);
  const [counts, setCounts] = useState<DenominationCounts>(() => emptyDenominationCounts());

  const denomTotal = useMemo(() => sumDenominationCounts(counts), [counts]);
  const manualUgx = Math.max(0, Math.floor(Number(value.replace(/\D/g, "")) || 0));
  const activeTotal = mode === "denominations" ? denomTotal : manualUgx;

  const setDenomCount = (denom: number, qty: number) => {
    setCounts((prev) => {
      const next = { ...prev, [denom]: qty };
      onChange(String(sumDenominationCounts(next)));
      return next;
    });
  };

  const variance = expectedUgx != null ? activeTotal - expectedUgx : 0;

  return (
    <div className="space-y-4">
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => setMode("total")}
          className={clsx(
            "min-h-[40px] flex-1 rounded-xl px-3 text-xs font-black",
            mode === "total" ? "bg-waka-600 text-white" : "bg-muted text-muted-foreground",
          )}
        >
          {t(lang, "cashPositionCountManual")}
        </button>
        <button
          type="button"
          onClick={() => setMode("denominations")}
          className={clsx(
            "min-h-[40px] flex-1 rounded-xl px-3 text-xs font-black",
            mode === "denominations" ? "bg-waka-600 text-white" : "bg-muted text-muted-foreground",
          )}
        >
          {t(lang, "cashPositionCountDenominations")}
        </button>
      </div>

      {mode === "total" ? (
        <input
          value={value}
          onChange={(e) => onChange(e.target.value.replace(/\D/g, "").slice(0, 12))}
          inputMode="numeric"
          placeholder="0"
          className={
            inputClassName ??
            "w-full rounded-2xl border-2 border-border bg-muted px-4 py-4 text-3xl font-black tabular-nums"
          }
        />
      ) : (
        <ul className="grid gap-2 sm:grid-cols-2">
          {UGX_DENOMINATIONS.map((denom) => (
            <li key={denom} className="flex items-center gap-2 rounded-xl bg-muted px-3 py-2">
              <span className="w-20 text-sm font-black tabular-nums text-foreground">
                {formatDenominationLabel(denom)}
              </span>
              <span className="text-muted-foreground">×</span>
              <input
                type="number"
                min={0}
                inputMode="numeric"
                value={counts[denom] || ""}
                onChange={(e) => {
                  const v = Math.max(0, Math.floor(Number(e.target.value) || 0));
                  setDenomCount(denom, v);
                }}
                className="min-w-0 flex-1 rounded-lg border border-border bg-card px-2 py-1.5 text-sm font-bold"
              />
              <span className="w-24 text-right text-xs font-bold tabular-nums text-muted-foreground">
                UGX {((counts[denom] ?? 0) * denom).toLocaleString()}
              </span>
            </li>
          ))}
        </ul>
      )}

      {mode === "denominations" ? (
        <div className="rounded-2xl border border-border bg-muted px-4 py-3">
          <div className="flex justify-between text-sm">
            <span className="font-bold text-muted-foreground">{t(lang, "cashPositionCountTotal")}</span>
            <span className="font-black tabular-nums text-foreground">UGX {activeTotal.toLocaleString()}</span>
          </div>
        </div>
      ) : null}

      {showVariance && expectedUgx != null ? (
        <div className="rounded-2xl border border-border bg-muted px-4 py-3">
          <div className="flex justify-between text-sm">
            <span className="font-bold text-muted-foreground">{t(lang, "cashPositionExpectedLabel")}</span>
            <span className="font-black tabular-nums">UGX {expectedUgx.toLocaleString()}</span>
          </div>
          {activeTotal > 0 ? (
            <div className="mt-1 flex justify-between text-sm">
              <span className="font-bold text-muted-foreground">{t(lang, "cashPositionVariance")}</span>
              <span
                className={clsx(
                  "font-black tabular-nums",
                  variance === 0 ? "text-emerald-700" : variance < 0 ? "text-rose-700" : "text-sky-700",
                )}
              >
                {variance >= 0 ? "+" : ""}UGX {variance.toLocaleString()}
              </span>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
