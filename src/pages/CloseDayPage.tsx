import { useMemo, useState } from "react";
import type { FormEvent } from "react";
import type { Language } from "../types";
import { t } from "../lib/i18n";
import { usePosStore } from "../store/usePosStore";
import { dateKeyKampala } from "../lib/datesUg";
import { PageHeader } from "../components/layout/PageHeader";
import { useSessionActor } from "../context/SessionActorContext";
import { hasPermission } from "../lib/permissions";

export function CloseDayPage({ lang }: { lang: Language }) {
  const actor = useSessionActor();
  const sales = usePosStore((s) => s.sales);
  const dayCloses = usePosStore((s) => s.dayCloses);
  const preferences = usePosStore((s) => s.preferences);
  const recordDayClose = usePosStore((s) => s.recordDayClose);

  const todayKey = dateKeyKampala(new Date());
  const [counted, setCounted] = useState("");
  const [doneMsg, setDoneMsg] = useState(false);

  const summary = useMemo(() => {
    const daySales = sales.filter((s) => dateKeyKampala(s.createdAt) === todayKey);
    const cash = daySales.reduce((a, s) => a + s.cashPaidUgx, 0);
    const debt = daySales.reduce((a, s) => a + s.debtUgx, 0);
    const total = daySales.reduce((a, s) => a + s.totalUgx, 0);
    return { daySales, cash, debt, total };
  }, [sales, todayKey]);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const n = Math.max(0, Math.floor(Number(counted.replace(/\D/g, "")) || 0));
    recordDayClose({ dateKey: todayKey, countedCashUgx: n });
    setCounted("");
    setDoneMsg(true);
    window.setTimeout(() => setDoneMsg(false), 3000);
  };

  const last = dayCloses[0];

  const pct = preferences.cashVarianceThresholdPct ?? 5;
  const fixed = preferences.cashVarianceThresholdUgxFixed ?? 10_000;

  const closeVarianceFlag = (expected: number, diff: number) => {
    const exp = Math.max(1, expected);
    const absDiff = Math.abs(diff);
    return absDiff > Math.max((pct / 100) * exp, fixed);
  };

  if (!hasPermission(actor.role, "day.close")) {
    return (
      <div className="space-y-4 pb-8">
        <PageHeader lang={lang} title={t(lang, "closeDay")} backLabel={t(lang, "officeBackToHub")} />
        <p className="text-lg text-slate-700">{t(lang, "noPermission")}</p>
      </div>
    );
  }

  return (
    <div className="space-y-4 pb-8">
      <PageHeader
        lang={lang}
        title={t(lang, "closeDay")}
        subtitle={t(lang, "closeDaySimpleHelp")}
        backLabel={t(lang, "officeBackToHub")}
      />

      <section className="rounded-3xl border border-slate-200 bg-white p-4 shadow-waka-sm">
        <div className="grid grid-cols-2 gap-3">
          <div className="rounded-2xl bg-stone-50 px-3 py-3">
            <p className="text-[11px] font-black uppercase text-slate-500">{t(lang, "totalSales")}</p>
            <p className="mt-1 text-xl font-black text-slate-950">UGX {summary.total.toLocaleString()}</p>
          </div>
          <div>
            <div className="rounded-2xl bg-stone-50 px-3 py-3">
              <p className="text-[11px] font-black uppercase text-slate-500">{t(lang, "closeSimpleCashSalesToday")}</p>
              <p className="mt-1 text-xl font-black text-slate-950">UGX {summary.cash.toLocaleString()}</p>
            </div>
          </div>
          <div className="rounded-2xl bg-amber-50 px-3 py-3">
            <p className="text-[11px] font-black uppercase text-amber-700">{t(lang, "closeSimpleCreditToday")}</p>
            <p className="mt-1 text-xl font-black text-amber-900">UGX {summary.debt.toLocaleString()}</p>
          </div>
          <div className="rounded-2xl bg-waka-50 px-3 py-3">
            <p className="text-[11px] font-black uppercase text-waka-800">{t(lang, "closeSalesCount")}</p>
            <p className="mt-1 text-xl font-black text-waka-950">{summary.daySales.length}</p>
          </div>
        </div>
      </section>

      <form onSubmit={submit} className="rounded-3xl border border-waka-200 bg-waka-50/70 p-4">
        <label className="block text-base font-black text-waka-950">{t(lang, "closeCountedCash")}</label>
        <input
          value={counted}
          onChange={(e) => setCounted(e.target.value.replace(/\D/g, "").slice(0, 12))}
          inputMode="numeric"
          className="mt-2 w-full rounded-2xl border-2 border-waka-300 bg-white px-4 py-4 text-3xl font-black"
          placeholder="0"
        />
        <button type="submit" className="mt-5 w-full rounded-3xl bg-waka-600 py-4 text-xl font-black text-white">
          {t(lang, "closeConfirm")}
        </button>
      </form>

      {doneMsg && (
        <p className="rounded-2xl bg-slate-900 px-4 py-3 text-center text-lg font-bold text-white">{t(lang, "closeSaved")}</p>
      )}

      {last && last.dateKey === todayKey ? (
        <section className="rounded-3xl border-2 border-slate-200 bg-slate-50 p-5">
          <p className="text-lg font-black text-slate-900">{t(lang, "closeLastDiff")}</p>
          <p className="mt-2 text-3xl font-black text-slate-800">
            UGX {last.differenceUgx.toLocaleString()}
            <span className="ml-2 text-lg font-semibold text-slate-600">
              {last.differenceUgx === 0 ? t(lang, "closeMatch") : last.differenceUgx > 0 ? t(lang, "closeExtra") : t(lang, "closeShort")}
            </span>
          </p>
          {closeVarianceFlag(last.expectedCashUgx, last.differenceUgx) ? (
            <p className="mt-3 rounded-xl bg-rose-100 px-3 py-2 text-sm font-bold text-rose-900">{t(lang, "ownerVarianceFlag")}</p>
          ) : null}
        </section>
      ) : null}

      {hasPermission(actor.role, "owner.cash_history") ? (
        <section className="rounded-3xl border-2 border-slate-100 bg-white p-5 shadow-sm">
          <h2 className="text-xl font-black text-slate-900">{t(lang, "closeHistoryTitle")}</h2>
          <ul className="mt-3 space-y-3">
            {dayCloses.slice(0, 20).map((d) => {
              const flag = closeVarianceFlag(d.expectedCashUgx, d.differenceUgx);
              return (
                <li key={d.id} className="rounded-2xl border border-slate-100 bg-slate-50 px-4 py-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-black text-slate-900">{d.dateKey}</span>
                    {flag ? (
                      <span className="rounded-full bg-rose-100 px-2 py-0.5 text-xs font-bold text-rose-900">!</span>
                    ) : null}
                  </div>
                  <p className="mt-1 text-sm text-slate-600">
                    {t(lang, "ownerExpectedVsCounted")}: UGX {d.expectedCashUgx.toLocaleString()} / UGX {d.countedCashUgx.toLocaleString()}
                  </p>
                  <p className="text-sm font-bold text-slate-800">
                    Δ UGX {d.differenceUgx.toLocaleString()} · {t(lang, "estimatedProfit")} UGX {d.profitEstimateUgx.toLocaleString()}
                  </p>
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
