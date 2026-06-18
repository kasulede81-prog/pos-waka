import { useMemo, useState } from "react";
import { Navigate } from "react-router-dom";
import type { Language } from "../types";
import { t } from "../lib/i18n";
import { usePosStore } from "../store/usePosStore";
import { useSessionActor } from "../context/SessionActorContext";
import { hasPermission } from "../lib/permissions";
import { PageHeader } from "../components/layout/PageHeader";
import { dateKeyKampala } from "../lib/datesUg";
import {
  activeDayDrawerOpenForDate,
  isDayDrawerOpenMutable,
  isFormulaV2,
} from "../lib/dayDrawerOpen";

export function DayOpenPage({ lang }: { lang: Language }) {
  const actor = useSessionActor();
  const canOpen = hasPermission(actor.role, "day.open_drawer");
  const preferences = usePosStore((s) => s.preferences);
  const dayDrawerOpens = usePosStore((s) => s.dayDrawerOpens);
  const sales = usePosStore((s) => s.sales);
  const recordDayDrawerOpen = usePosStore((s) => s.recordDayDrawerOpen);
  const supersedeDayDrawerOpen = usePosStore((s) => s.supersedeDayDrawerOpen);
  const voidDayDrawerOpen = usePosStore((s) => s.voidDayDrawerOpen);

  const todayKey = dateKeyKampala(new Date());
  const active = useMemo(() => activeDayDrawerOpenForDate(dayDrawerOpens, todayKey), [dayDrawerOpens, todayKey]);
  const mutable = isDayDrawerOpenMutable(sales, todayKey);
  const v2 = isFormulaV2(preferences);

  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [voidReason, setVoidReason] = useState("");
  const [msg, setMsg] = useState<string | null>(null);

  if (!canOpen) {
    return <Navigate to="/office" replace />;
  }

  const submitOpen = () => {
    const openingFloatUgx = Math.floor(Number(amount.replace(/\D/g, "")) || 0);
    if (openingFloatUgx <= 0) return;
    const r = active
      ? supersedeDayDrawerOpen({ previousId: active.id, openingFloatUgx, note, reason: note })
      : recordDayDrawerOpen({ openingFloatUgx, note });
    if (r.ok) {
      setAmount("");
      setNote("");
      setMsg(t(lang, "dayOpenRecordBtn"));
    } else {
      setMsg(r.errorKey ?? "saleError");
    }
  };

  const submitVoid = () => {
    if (!active) return;
    const r = voidDayDrawerOpen({ dayOpenId: active.id, reason: voidReason });
    setMsg(r.ok ? t(lang, "dayOpenVoidBtn") : (r.errorKey ?? "saleError"));
  };

  return (
    <div className="space-y-5 pb-16">
      <PageHeader lang={lang} title={t(lang, "dayOpenTitle")} subtitle={t(lang, "dayOpenSub")} backFallback="/office" />

      {!v2 ? (
        <p className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-950">
          Formula v1 — legacy opening float. Enable formula v2 in shop settings when ready.
        </p>
      ) : null}

      {active ? (
        <section className="rounded-3xl border-2 border-sky-200 bg-sky-50 p-5">
          <p className="text-sm font-black uppercase text-sky-800">{t(lang, "dayOpenActiveLabel")}</p>
          <p className="mt-2 text-3xl font-black text-sky-950">UGX {active.openingFloatUgx.toLocaleString()}</p>
          <p className="mt-2 text-sm font-semibold text-sky-900">
            {t(lang, "dayOpenOpenedBy")}: {active.countedByLabel}
          </p>
          {active.firstVerifiedByLabel ? (
            <p className="text-sm font-semibold text-sky-900">
              {t(lang, "dayOpenFirstVerified")}: {active.firstVerifiedByLabel}
            </p>
          ) : null}
          {!mutable ? (
            <p className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm font-bold text-amber-950">
              {t(lang, "dayOpenLockedHint")}
            </p>
          ) : null}
        </section>
      ) : null}

      {mutable ? (
        <section className="rounded-3xl border border-stone-200 bg-white p-5 shadow-waka-sm">
          <label className="block text-sm font-bold text-stone-800">
            {t(lang, "dayOpenAmountLabel")}
            <input
              value={amount}
              onChange={(e) => setAmount(e.target.value.replace(/\D/g, "").slice(0, 12))}
              inputMode="numeric"
              className="mt-2 min-h-[52px] w-full rounded-2xl border-2 border-stone-200 px-4 text-2xl font-black"
            />
          </label>
          <label className="mt-4 block text-sm font-bold text-stone-800">
            {t(lang, "dayOpenNoteLabel")}
            <input
              value={note}
              onChange={(e) => setNote(e.target.value.slice(0, 200))}
              className="mt-2 min-h-[44px] w-full rounded-2xl border-2 border-stone-200 px-4 text-sm font-semibold"
            />
          </label>
          <button
            type="button"
            onClick={submitOpen}
            className="mt-4 min-h-[52px] w-full rounded-2xl bg-waka-600 font-black text-white"
          >
            {active ? t(lang, "dayOpenSupersedeBtn") : t(lang, "dayOpenRecordBtn")}
          </button>
          {active ? (
            <>
              <input
                value={voidReason}
                onChange={(e) => setVoidReason(e.target.value.slice(0, 200))}
                placeholder={t(lang, "shiftFloatOverrideReason")}
                className="mt-3 min-h-[44px] w-full rounded-2xl border-2 border-stone-200 px-4 text-sm"
              />
              <button
                type="button"
                onClick={submitVoid}
                className="mt-2 min-h-[44px] w-full rounded-2xl border-2 border-rose-200 font-bold text-rose-800"
              >
                {t(lang, "dayOpenVoidBtn")}
              </button>
            </>
          ) : null}
        </section>
      ) : null}

      {msg ? <p className="text-sm font-bold text-stone-600">{msg}</p> : null}
    </div>
  );
}
