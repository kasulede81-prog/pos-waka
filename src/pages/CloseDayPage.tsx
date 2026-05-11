import { useMemo, useState } from "react";
import type { FormEvent } from "react";
import type { Language } from "../types";
import { t } from "../lib/i18n";
import { usePosStore } from "../store/usePosStore";
import { dateKeyKampala } from "../lib/datesUg";
import { Link } from "react-router-dom";
import { useSessionActor } from "../context/SessionActorContext";
import { hasPermission } from "../lib/permissions";

export function CloseDayPage({ lang }: { lang: Language }) {
  const actor = useSessionActor();
  const sales = usePosStore((s) => s.sales);
  const products = usePosStore((s) => s.products);
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
    const profit = daySales.reduce((a, s) => a + s.estimatedProfitUgx, 0);
    const total = daySales.reduce((a, s) => a + s.totalUgx, 0);
    const items = new Map<string, number>();
    for (const s of daySales) {
      for (const l of s.lines) {
        items.set(l.name, (items.get(l.name) ?? 0) + l.quantity);
      }
    }
    return { daySales, cash, debt, profit, total, items: [...items.entries()] };
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
        <Link to="/" className="inline-block text-base font-bold text-waka-700">
          ← {t(lang, "backHome")}
        </Link>
        <p className="text-lg text-slate-700">{t(lang, "noPermission")}</p>
      </div>
    );
  }

  return (
    <div className="space-y-6 pb-8">
      <Link to="/" className="inline-block text-base font-bold text-waka-700">
        ← {t(lang, "backHome")}
      </Link>
      <h1 className="text-4xl font-black text-slate-900">{t(lang, "closeDay")}</h1>
      <p className="text-lg text-slate-600">{t(lang, "closeDaySimpleHelp")}</p>

      <section className="space-y-4 rounded-3xl border-2 border-slate-100 bg-white p-6 shadow-sm">
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <p className="text-sm font-bold uppercase text-slate-500">{t(lang, "closeSimpleCashSalesToday")}</p>
            <p className="text-3xl font-black text-slate-900">UGX {summary.cash.toLocaleString()}</p>
          </div>
          <div>
            <p className="text-sm font-bold uppercase text-slate-500">{t(lang, "closeSimpleCreditToday")}</p>
            <p className="text-3xl font-black text-amber-800">UGX {summary.debt.toLocaleString()}</p>
          </div>
          <div>
            <p className="text-sm font-bold uppercase text-slate-500">{t(lang, "closeSimpleEstimatedProfit")}</p>
            <p className={`text-3xl font-black ${summary.profit < 0 ? "text-slate-600" : "text-waka-700"}`}>
              UGX {summary.profit.toLocaleString()}
            </p>
            <p className="mt-1 text-xs font-medium text-slate-500">
              {summary.profit < 0 ? t(lang, "estimatedProfitNegativeHint") : t(lang, "estimatedProfitHint")}
            </p>
          </div>
          <div>
            <p className="text-sm font-bold uppercase text-slate-500">{t(lang, "closeSimpleItemsSold")}</p>
            <p className="text-3xl font-black text-slate-900">{summary.daySales.reduce((a, s) => a + s.lines.length, 0)}</p>
          </div>
        </div>

        <div>
          <p className="text-lg font-black text-slate-900">{t(lang, "closeSimpleTopSelling")}</p>
          <ul className="mt-2 space-y-2">
            {summary.items.length === 0 ? (
              <li className="text-slate-500">{t(lang, "noSalesYet")}</li>
            ) : (
              summary.items.slice(0, 5).map(([name, qty]) => (
                <li key={name} className="flex justify-between text-lg font-semibold text-slate-800">
                  <span>{name}</span>
                  <span>{qty}</span>
                </li>
              ))
            )}
          </ul>
        </div>

        <div>
          <p className="text-lg font-black text-slate-900">{t(lang, "closeSimpleLowStock")}</p>
          <ul className="mt-2 space-y-2">
            {products
              .filter((p) => p.minimumStockAlert > 0 && p.stockOnHand <= p.minimumStockAlert)
              .map((p) => (
                <li key={p.id} className="text-lg font-bold text-rose-800">
                  {p.name} — {p.stockOnHand} {p.baseUnit}
                </li>
              ))}
          </ul>
        </div>
      </section>

      <form onSubmit={submit} className="rounded-3xl border-2 border-waka-200 bg-waka-50/50 p-6">
        <label className="block text-xl font-black text-waka-950">{t(lang, "closeCountedCash")}</label>
        <input
          value={counted}
          onChange={(e) => setCounted(e.target.value.replace(/\D/g, "").slice(0, 12))}
          inputMode="numeric"
          className="mt-3 w-full rounded-2xl border-2 border-waka-300 bg-white px-4 py-4 text-3xl font-black"
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
