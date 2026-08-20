import { useCallback, useRef, useState } from "react";
import clsx from "clsx";
import { Minus, Plus, X } from "lucide-react";
import type { Language } from "../../types";
import { t } from "../../lib/i18n";
import {
  CASHIER_DENSITY_LEVELS,
  DISPLAY_SCALE_META,
  cashierDensityLabelKey,
  toCashierDensityLevel,
  type DisplayScaleLevel,
} from "../../lib/displayScale/scaleTokens";
import { useDisplayScale } from "../../context/DisplayScaleProvider";
import { AppModalOverlay } from "../layout/AppModalOverlay";

type Props = {
  lang: Language;
  /** Header toolbar (default) — never overlaps other chrome. */
  variant?: "header";
  /** Light text on dark header bars (e.g. launcher). */
  inverted?: boolean;
  /** Tighter layout for narrow mobile headers. */
  compact?: boolean;
};

/** Sell screen — cashier density selector (Comfortable / Balanced / Compact). Not browser zoom. */
export function DisplayScaleControl({
  lang,
  variant = "header",
  inverted = false,
  compact = false,
}: Props) {
  const { level, featureEnabled, setLevel, stepUp, stepDown, reset } = useDisplayScale();
  const [sheetOpen, setSheetOpen] = useState(false);
  const lastTapAtRef = useRef(0);
  const cashierLevel = toCashierDensityLevel(level);

  const onModeTap = useCallback(() => {
    const now = Date.now();
    if (now - lastTapAtRef.current < 350) {
      reset();
      lastTapAtRef.current = 0;
      return;
    }
    lastTapAtRef.current = now;
    setSheetOpen(true);
  }, [reset]);

  if (!featureEnabled || variant !== "header") return null;

  const modeLabel = t(lang, cashierDensityLabelKey(level));
  const btnClass = clsx(
    "pos-ds-density-btn flex items-center justify-center rounded-xl transition disabled:opacity-40",
    compact ? "h-8 w-8 min-h-8 min-w-8" : "min-h-[48px] min-w-[48px]",
    inverted ? "text-white active:bg-white/15" : "text-muted-foreground active:bg-muted",
  );

  return (
    <>
      <div
        className={clsx(
          "pos-ds-density-control flex shrink-0 items-center rounded-xl border",
          compact ? "gap-0 p-0" : "gap-0.5 p-0.5",
          inverted ? "border-white/25 bg-white/10" : "border-border/90 bg-card shadow-sm",
        )}
        role="group"
        aria-label={t(lang, "displayScaleControlLabel")}
      >
        <button
          type="button"
          onClick={stepDown}
          disabled={cashierLevel === "compact"}
          className={btnClass}
          aria-label={t(lang, "displayScaleDecrease")}
        >
          <Minus className={clsx("pos-ds-icon-sm", compact ? "h-3.5 w-3.5" : "h-4 w-4")} aria-hidden />
        </button>
        <button
          type="button"
          onClick={onModeTap}
          className={clsx(
            "pos-ds-density-label rounded-xl text-center font-black",
            compact
              ? "h-8 min-h-8 min-w-[2.25rem] px-1 text-[10px] leading-none"
              : "min-h-[48px] min-w-[5.5rem] px-2 text-xs",
            inverted ? "text-white active:bg-white/10" : "text-foreground active:bg-muted",
          )}
          title={t(lang, "displayScaleDoubleTapHint")}
          aria-label={modeLabel}
          aria-haspopup="dialog"
          aria-expanded={sheetOpen}
        >
          {compact ? "Aa" : modeLabel}
        </button>
        <button
          type="button"
          onClick={stepUp}
          disabled={cashierLevel === "large"}
          className={btnClass}
          aria-label={t(lang, "displayScaleIncrease")}
        >
          <Plus className={clsx("pos-ds-icon-sm", compact ? "h-3.5 w-3.5" : "h-4 w-4")} aria-hidden />
        </button>
      </div>

      {sheetOpen ? (
        <AppModalOverlay
          className="z-[var(--waka-z-pos-modal)] flex flex-col justify-end bg-overlay/40"
          onClick={() => setSheetOpen(false)}
        >
          <div
            className="pos-ds-dialog max-h-[min(85dvh,28rem)] w-full overflow-y-auto rounded-t-3xl bg-card px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-3 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal
            aria-labelledby="display-scale-sheet-title"
          >
            <div className="mb-3 flex items-center justify-between gap-2">
              <h2 id="display-scale-sheet-title" className="pos-ds-dialog-title text-lg font-black text-foreground">
                {t(lang, "displayScaleSheetTitle")}
              </h2>
              <button
                type="button"
                onClick={() => setSheetOpen(false)}
                className="pos-ds-dialog-btn flex min-h-[48px] min-w-[48px] items-center justify-center rounded-full bg-muted text-muted-foreground"
                aria-label={t(lang, "cancel")}
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <p className="mb-3 text-xs font-semibold text-muted-foreground">{t(lang, "displayScaleSheetSub")}</p>
            <ul className="space-y-2">
              {CASHIER_DENSITY_LEVELS.map((opt) => {
                const meta = DISPLAY_SCALE_META[opt];
                const selected = cashierLevel === opt;
                return (
                  <li key={opt}>
                    <button
                      type="button"
                      onClick={() => {
                        setLevel(opt as DisplayScaleLevel);
                        setSheetOpen(false);
                      }}
                      className={clsx(
                        "pos-ds-dialog-btn flex w-full min-h-[52px] items-center gap-3 rounded-2xl border px-4 py-3 text-left transition duration-200",
                        selected
                          ? "border-waka-500 bg-waka-50 ring-1 ring-waka-200"
                          : "border-border bg-card active:bg-muted",
                      )}
                      aria-pressed={selected}
                    >
                      <span
                        className={clsx(
                          "flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2",
                          selected ? "border-waka-600" : "border-border",
                        )}
                        aria-hidden
                      >
                        {selected ? <span className="h-2.5 w-2.5 rounded-full bg-waka-600" /> : null}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm font-black text-foreground">
                          {t(lang, meta.cashierLabelKey)}
                        </span>
                        <span className="text-xs font-semibold text-muted-foreground">
                          {t(lang, `${meta.cashierLabelKey}Hint`)}
                        </span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
            <p className="mt-4 text-[11px] font-semibold text-muted-foreground">
              {t(lang, "displayScaleDoubleTapHint")}
            </p>
          </div>
        </AppModalOverlay>
      ) : null}
    </>
  );
}
