import { useCallback, useRef, useState } from "react";
import clsx from "clsx";
import { Minus, Plus, SlidersHorizontal, X } from "lucide-react";
import type { Language } from "../../types";
import { t } from "../../lib/i18n";
import {
  DISPLAY_SCALE_LEVELS,
  DISPLAY_SCALE_META,
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

/** Sell screen — adjust POS display density (not browser zoom). Lives in the POS header row. */
export function DisplayScaleControl({
  lang,
  variant = "header",
  inverted = false,
  compact = false,
}: Props) {
  const { level, percent, featureEnabled, setLevel, stepUp, stepDown, reset } = useDisplayScale();
  const [sheetOpen, setSheetOpen] = useState(false);
  const lastTapAtRef = useRef(0);

  const onPercentTap = useCallback(() => {
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

  const btnClass = clsx(
    "flex items-center justify-center rounded-lg transition disabled:opacity-40",
    compact ? "h-8 w-8" : "h-9 w-9",
    inverted ? "text-white active:bg-white/15" : "text-stone-700 active:bg-stone-100",
  );

  return (
    <>
      <div
        className={clsx(
          "flex shrink-0 items-center gap-0.5 rounded-xl border p-0.5",
          compact ? "gap-0" : "gap-0.5",
          inverted
            ? "border-white/25 bg-white/10"
            : "border-stone-200/90 bg-white shadow-sm",
        )}
        role="group"
        aria-label={t(lang, "displayScaleControlLabel")}
      >
        <button
          type="button"
          onClick={stepDown}
          disabled={level === DISPLAY_SCALE_LEVELS[0]}
          className={btnClass}
          aria-label={t(lang, "displayScaleDecrease")}
        >
          <Minus className={compact ? "h-3.5 w-3.5" : "h-4 w-4"} aria-hidden />
        </button>
        <button
          type="button"
          onClick={onPercentTap}
          className={clsx(
            "rounded-lg px-1.5 text-center font-black tabular-nums",
            compact ? "min-h-[32px] min-w-[2.75rem] text-[10px]" : "min-h-[36px] min-w-[4.5rem] text-xs",
            inverted ? "text-white active:bg-white/10" : "text-stone-800 active:bg-stone-50",
          )}
          title={t(lang, "displayScaleDoubleTapHint")}
        >
          <span className={clsx(compact ? "hidden min-[400px]:inline" : "hidden sm:inline")}>
            {t(lang, "displayScaleShort")}{" "}
          </span>
          <span className={inverted ? "text-waka-100" : "text-waka-700"}>{percent}%</span>
        </button>
        <button
          type="button"
          onClick={stepUp}
          disabled={level === DISPLAY_SCALE_LEVELS[DISPLAY_SCALE_LEVELS.length - 1]}
          className={btnClass}
          aria-label={t(lang, "displayScaleIncrease")}
        >
          <Plus className={compact ? "h-3.5 w-3.5" : "h-4 w-4"} aria-hidden />
        </button>
      </div>

      {sheetOpen ? (
        <AppModalOverlay
          className="z-[var(--waka-z-pos-modal)] flex flex-col justify-end bg-black/40"
          onClick={() => setSheetOpen(false)}
        >
          <div
            className="max-h-[min(85dvh,28rem)] w-full overflow-y-auto rounded-t-3xl bg-white px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-3 shadow-2xl transition-transform duration-200"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal
            aria-labelledby="display-scale-sheet-title"
          >
            <div className="mb-3 flex items-center justify-between gap-2">
              <h2 id="display-scale-sheet-title" className="text-lg font-black text-stone-950">
                {t(lang, "displayScaleSheetTitle")}
              </h2>
              <button
                type="button"
                onClick={() => setSheetOpen(false)}
                className="flex h-9 w-9 items-center justify-center rounded-full bg-stone-100 text-stone-700"
                aria-label={t(lang, "cancel")}
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <p className="mb-3 text-xs font-semibold text-stone-600">{t(lang, "displayScaleSheetSub")}</p>
            <ul className="space-y-2">
              {DISPLAY_SCALE_LEVELS.map((opt) => {
                const meta = DISPLAY_SCALE_META[opt];
                const selected = level === opt;
                return (
                  <li key={opt}>
                    <button
                      type="button"
                      onClick={() => {
                        setLevel(opt);
                        setSheetOpen(false);
                      }}
                      className={clsx(
                        "flex w-full min-h-[48px] items-center gap-3 rounded-2xl border px-4 py-3 text-left transition duration-200",
                        selected
                          ? "border-waka-500 bg-waka-50 ring-1 ring-waka-200"
                          : "border-stone-200 bg-white active:bg-stone-50",
                      )}
                    >
                      <span
                        className={clsx(
                          "flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2",
                          selected ? "border-waka-600" : "border-stone-300",
                        )}
                        aria-hidden
                      >
                        {selected ? <span className="h-2.5 w-2.5 rounded-full bg-waka-600" /> : null}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm font-black text-stone-950">{t(lang, meta.labelKey)}</span>
                        <span className="text-xs font-semibold text-stone-500">
                          {t(lang, "displayScalePercentLabel").replace("{{percent}}", String(meta.percent))}
                        </span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
            <p className="mt-4 flex items-center gap-2 text-[11px] font-semibold text-stone-500">
              <SlidersHorizontal className="h-3.5 w-3.5 shrink-0" aria-hidden />
              {t(lang, "displayScaleDoubleTapHint")}
            </p>
          </div>
        </AppModalOverlay>
      ) : null}
    </>
  );
}
