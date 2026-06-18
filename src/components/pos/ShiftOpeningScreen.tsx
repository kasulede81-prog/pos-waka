import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { Language } from "../../types";
import { t } from "../../lib/i18n";
import { usePosStore } from "../../store/usePosStore";
import { AppModalOverlay } from "../layout/AppModalOverlay";
import { POS_HOME_ROUTE } from "../../lib/posNavigation";
import { dateKeyKampala } from "../../lib/datesUg";
import {
  activeDayDrawerOpenForDate,
  floatVerificationWithinTolerance,
  isDayDrawerOpenMutable,
  isFormulaV2,
  latestClosedShiftForDay,
  shiftVerificationBaselineUgx,
} from "../../lib/dayDrawerOpen";
import { FloatVerifyOverrideModal } from "./FloatVerifyOverrideModal";

type Props = {
  lang: Language;
  onShiftStarted: () => void;
};

/** Blocks sell flows until the cashier opens a shift with optional opening float. */
export function ShiftOpeningScreen({ lang, onShiftStarted }: Props) {
  const navigate = useNavigate();
  const beginShift = usePosStore((s) => s.beginShift);
  const beginShiftV2 = usePosStore((s) => s.beginShiftV2);
  const preferences = usePosStore((s) => s.preferences);
  const dayDrawerOpens = usePosStore((s) => s.dayDrawerOpens);
  const shifts = usePosStore((s) => s.preferences.shifts ?? []);
  const sales = usePosStore((s) => s.sales);

  const [floatInput, setFloatInput] = useState("");
  const [errorKey, setErrorKey] = useState<string | null>(null);
  const [overrideOpen, setOverrideOpen] = useState(false);

  const v2 = isFormulaV2(preferences);
  const todayKey = dateKeyKampala(new Date());
  const dayOpen = useMemo(
    () => activeDayDrawerOpenForDate(dayDrawerOpens, todayKey),
    [dayDrawerOpens, todayKey],
  );
  const priorShift = useMemo(() => latestClosedShiftForDay(shifts, todayKey), [shifts, todayKey]);
  const baseline = useMemo(
    () => shiftVerificationBaselineUgx(todayKey, shifts, dayOpen, priorShift),
    [todayKey, shifts, dayOpen, priorShift],
  );

  const verifiedN = Math.floor(Number(floatInput.replace(/\D/g, "")) || 0);
  const matched = floatVerificationWithinTolerance(baseline, verifiedN, preferences);

  const handleStartV1 = () => {
    const raw = floatInput.replace(/\D/g, "");
    const openingFloatUgx = raw.length > 0 ? Math.floor(Number(raw)) : undefined;
    const r = beginShift(openingFloatUgx);
    if (r.ok) onShiftStarted();
    else setErrorKey(r.errorKey ?? "saleError");
  };

  const tryStartV2 = (override?: {
    pin: string;
    action: "accept_cashier" | "correct_day_open" | "reject";
    reason: string;
  }) => {
    if (!dayOpen) {
      setErrorKey("dayDrawerNotOpen");
      return;
    }
    if (!matched && !override) {
      setOverrideOpen(true);
      return;
    }
    const r = beginShiftV2({
      verifiedFloatUgx: verifiedN,
      managerPin: override?.pin,
      overrideAction: override?.action,
      overrideReason: override?.reason,
    });
    if (r.ok) {
      setOverrideOpen(false);
      onShiftStarted();
      return;
    }
    setErrorKey(r.errorKey ?? "saleError");
    if (r.errorKey === "shiftFloatMismatch") setOverrideOpen(true);
  };

  if (v2 && !dayOpen) {
    return (
      <AppModalOverlay className="z-[80] flex items-center justify-center bg-stone-950/80 p-4" role="dialog" aria-modal>
        <div className="w-full max-w-md rounded-3xl bg-white p-6 shadow-2xl">
          <h1 className="text-2xl font-black text-stone-900">{t(lang, "shiftOpenTitle")}</h1>
          <p className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-950">
            {t(lang, "dayDrawerNotOpen")}
          </p>
          <button
            type="button"
            onClick={() => navigate(POS_HOME_ROUTE)}
            className="mt-6 min-h-[52px] w-full rounded-2xl border-2 border-stone-200 font-bold"
          >
            {t(lang, "cancel")}
          </button>
        </div>
      </AppModalOverlay>
    );
  }

  return (
    <>
      <AppModalOverlay className="z-[80] flex items-center justify-center bg-stone-950/80 p-4" role="dialog" aria-modal>
        <div className="w-full max-w-md rounded-3xl bg-white p-6 shadow-2xl">
          <h1 className="text-2xl font-black text-stone-900">{t(lang, "shiftOpenTitle")}</h1>
          <p className="mt-2 text-sm font-medium text-stone-600">{t(lang, "shiftOpenBody")}</p>

          {v2 ? (
            <>
              {priorShift?.handoffFloatUgx != null ? (
                <p className="mt-4 rounded-2xl bg-sky-50 px-4 py-3 text-sm font-bold text-sky-950">
                  {t(lang, "shiftVerifyHandoffLabel")}: UGX {baseline.toLocaleString()}
                </p>
              ) : (
                <p className="mt-4 rounded-2xl bg-sky-50 px-4 py-3 text-sm font-bold text-sky-950">
                  {t(lang, "shiftVerifyOfficialFloat")}: UGX {(dayOpen?.openingFloatUgx ?? 0).toLocaleString()}
                </p>
              )}
              <label className="mt-5 block text-sm font-bold text-stone-800">
                {t(lang, "shiftVerifyCountLabel")}
                <input
                  value={floatInput}
                  onChange={(e) => {
                    setFloatInput(e.target.value.replace(/\D/g, "").slice(0, 12));
                    setErrorKey(null);
                  }}
                  inputMode="numeric"
                  placeholder="0"
                  className="mt-2 min-h-[52px] w-full rounded-2xl border-2 border-stone-200 px-4 text-2xl font-black outline-none ring-waka-300 focus:border-waka-400 focus:ring"
                />
              </label>
              {floatInput.length > 0 && !matched ? (
                <p className="mt-2 text-sm font-bold text-rose-700">{t(lang, "shiftVerifyMismatch")}</p>
              ) : null}
            </>
          ) : (
            <label className="mt-5 block text-sm font-bold text-stone-800">
              {t(lang, "shiftOpenFloatLabel")}
              <span className="ml-1 font-medium text-stone-500">({t(lang, "optional")})</span>
              <input
                value={floatInput}
                onChange={(e) => setFloatInput(e.target.value.replace(/\D/g, "").slice(0, 12))}
                inputMode="numeric"
                placeholder="0"
                className="mt-2 min-h-[52px] w-full rounded-2xl border-2 border-stone-200 px-4 text-2xl font-black outline-none ring-waka-300 focus:border-waka-400 focus:ring"
              />
            </label>
          )}

          {errorKey ? (
            <p className="mt-3 text-sm font-bold text-rose-700">
              {(t as (l: Language, k: string) => string)(lang, errorKey)}
            </p>
          ) : null}

          <div className="mt-6 grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => navigate(POS_HOME_ROUTE)}
              className="min-h-[52px] rounded-2xl border-2 border-stone-200 font-bold text-stone-800"
            >
              {t(lang, "cancel")}
            </button>
            <button
              type="button"
              onClick={() => (v2 ? tryStartV2() : handleStartV1())}
              disabled={v2 && verifiedN <= 0}
              className="min-h-[52px] rounded-2xl bg-waka-600 font-black text-white disabled:opacity-50"
            >
              {t(lang, "shiftOpenStartBtn")}
            </button>
          </div>
          {v2 && floatInput.length > 0 && !matched ? (
            <button
              type="button"
              onClick={() => setOverrideOpen(true)}
              className="mt-2 min-h-[44px] w-full rounded-2xl border-2 border-amber-300 text-sm font-black text-amber-950"
            >
              {t(lang, "shiftVerifyRequestOverride")}
            </button>
          ) : null}
        </div>
      </AppModalOverlay>

      <FloatVerifyOverrideModal
        lang={lang}
        open={overrideOpen}
        expectedUgx={baseline}
        verifiedUgx={verifiedN}
        canCorrectDayOpen={isDayDrawerOpenMutable(sales, todayKey)}
        onClose={() => setOverrideOpen(false)}
        onConfirm={(input) => {
          if (input.action === "reject") {
            setOverrideOpen(false);
            setFloatInput("");
            return;
          }
          tryStartV2(input);
        }}
      />
    </>
  );
}
