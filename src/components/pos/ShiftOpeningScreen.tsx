import { useMemo, useState } from "react";
import { actorHasPermission, actorHasEffectivePermission } from "../../lib/actorAuthorization";
import { useNavigate } from "react-router-dom";
import { useSessionActor } from "../../context/SessionActorContext";
import { useSubscription } from "../../context/SubscriptionContext";

import type { Language } from "../../types";
import { t, tTemplate } from "../../lib/i18n";
import { usePosStore } from "../../store/usePosStore";
import { ModalSheet } from "../layout/ModalSheet";
import { POS_HOME_ROUTE } from "../../lib/posNavigation";
import { dateKeyKampala } from "../../lib/datesUg";
import { findUnclosedPriorBusinessDays } from "../../lib/sequentialBusinessDays";

import {
  activeDayDrawerOpenForDate,
  floatVerificationWithinTolerance,
  isDayDrawerOpenMutable,
  isFormulaV2,
  isOwnerDayOpenCorrectionAfterSalesEnabled,
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
  const actor = useSessionActor();
  const { snapshot, authMode } = useSubscription();
  const canOpenDay = actorHasEffectivePermission(actor, "day.open_drawer", snapshot, authMode);
  const beginShift = usePosStore((s) => s.beginShift);
  const beginShiftV2 = usePosStore((s) => s.beginShiftV2);
  const recordDayDrawerOpen = usePosStore((s) => s.recordDayDrawerOpen);
  const preferences = usePosStore((s) => s.preferences);
  const dayDrawerOpens = usePosStore((s) => s.dayDrawerOpens);
  const dayCloses = usePosStore((s) => s.dayCloses);
  const shifts = usePosStore((s) => s.preferences.shifts ?? []);
  const sales = usePosStore((s) => s.sales);

  const [floatInput, setFloatInput] = useState("");
  const [dayOpenAmount, setDayOpenAmount] = useState("");
  const [errorKey, setErrorKey] = useState<string | null>(null);
  const [unclosedDays, setUnclosedDays] = useState<string[]>([]);
  const [overrideOpen, setOverrideOpen] = useState(false);

  const v2 = isFormulaV2(preferences);
  const todayKey = dateKeyKampala(new Date());
  const canCloseDay = actorHasPermission(actor, "day.close");
  const knownUnclosedDays = useMemo(
    () =>
      findUnclosedPriorBusinessDays({
        targetDateKey: todayKey,
        dayCloses,
        sales,
        shifts,
        dayDrawerOpens,
      }),
    [todayKey, dayCloses, sales, shifts, dayDrawerOpens],
  );
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

  const submitDayOpen = () => {
    const openingFloatUgx = Math.floor(Number(dayOpenAmount.replace(/\D/g, "")) || 0);
    if (openingFloatUgx <= 0) return;
    const r = recordDayDrawerOpen({ openingFloatUgx });
    if (r.ok) {
      setDayOpenAmount("");
      setErrorKey(null);
      setUnclosedDays([]);
      return;
    }
    setErrorKey(r.errorKey ?? "saleError");
    setUnclosedDays(r.unclosedDays ?? knownUnclosedDays);
  };

  const blockedDays = unclosedDays.length > 0 ? unclosedDays : knownUnclosedDays;
  const needsPriorDayClose = knownUnclosedDays.length > 0;

  if (v2 && !dayOpen) {
    return (
      <ModalSheet
        open
        onClose={() => navigate(POS_HOME_ROUTE)}
        zIndexClass="z-[80]"
        clearNav={false}
        title={t(lang, "dayOpenTitle")}
        footer={
          canOpenDay ? (
            <button
              type="button"
              onClick={submitDayOpen}
              disabled={!dayOpenAmount.replace(/\D/g, "")}
              className="min-h-[56px] w-full rounded-2xl bg-waka-600 text-lg font-black text-white shadow-md disabled:opacity-50"
            >
              {t(lang, "dayOpenRecordBtn")}
            </button>
          ) : (
            <button
              type="button"
              onClick={() => navigate(POS_HOME_ROUTE)}
              className="min-h-[52px] w-full rounded-2xl border-2 border-stone-200 font-bold"
            >
              {t(lang, "cancel")}
            </button>
          )
        }
      >
        {canOpenDay ? (
          <>
            <p className="text-sm font-medium text-stone-600">{t(lang, "dayOpenSub")}</p>
            <label className="mt-5 block text-sm font-bold text-stone-800">
              {t(lang, "dayOpenAmountLabel")}
              <input
                value={dayOpenAmount}
                onChange={(e) => {
                  setDayOpenAmount(e.target.value.replace(/\D/g, "").slice(0, 12));
                  setErrorKey(null);
                }}
                inputMode="numeric"
                placeholder="0"
                autoFocus
                className="mt-2 min-h-[52px] w-full rounded-2xl border-2 border-stone-200 px-4 text-2xl font-black outline-none ring-waka-300 focus:border-waka-400 focus:ring"
              />
            </label>
            {needsPriorDayClose ? (
              <div className="mt-3 space-y-2 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-left">
                <p className="text-sm font-semibold text-amber-950">
                  {tTemplate(lang, "sequentialDayBlockedDates", { dates: blockedDays.join(", ") })}
                </p>
                {canCloseDay ? (
                  <button
                    type="button"
                    onClick={() => navigate(`/close-day?date=${blockedDays[0]}`)}
                    className="inline-flex min-h-[44px] items-center rounded-xl bg-waka-600 px-4 text-sm font-black text-white"
                  >
                    {tTemplate(lang, "sequentialDayBlockedCloseLink", { date: blockedDays[0]! })}
                  </button>
                ) : (
                  <p className="text-sm font-medium text-amber-900">{t(lang, "sequentialDayBlockedAskManager")}</p>
                )}
              </div>
            ) : null}
            {errorKey && errorKey !== "sequentialDayBlocked" ? (
              <p className="mt-3 text-sm font-bold text-rose-700">
                {(t as (l: Language, k: string) => string)(lang, errorKey)}
              </p>
            ) : null}
          </>
        ) : (
          <p className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-950">
            {t(lang, "dayDrawerNotOpen")}
          </p>
        )}
      </ModalSheet>
    );
  }

  return (
    <>
      <ModalSheet
        open
        onClose={() => navigate(POS_HOME_ROUTE)}
        zIndexClass="z-[80]"
        clearNav={false}
        title={t(lang, "shiftOpenTitle")}
        footer={
          <div className="space-y-2">
            <div className="grid grid-cols-2 gap-2">
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
                className="min-h-[44px] w-full rounded-2xl border-2 border-amber-300 text-sm font-black text-amber-950"
              >
                {t(lang, "shiftVerifyRequestOverride")}
              </button>
            ) : null}
          </div>
        }
      >
        <p className="text-sm font-medium text-stone-600">{t(lang, "shiftOpenBody")}</p>

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
      </ModalSheet>

      <FloatVerifyOverrideModal
        lang={lang}
        open={overrideOpen}
        expectedUgx={baseline}
        verifiedUgx={verifiedN}
        canCorrectDayOpen={
          isDayDrawerOpenMutable(sales, todayKey) ||
          isOwnerDayOpenCorrectionAfterSalesEnabled(preferences)
        }
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
