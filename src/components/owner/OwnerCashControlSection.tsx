import { Link } from "react-router-dom";
import type { Language } from "../../types";
import { t } from "../../lib/i18n";
import type { OwnerCashControlSnapshot } from "../../lib/ownerCommandCenter";

type Props = {
  lang: Language;
  cash: OwnerCashControlSnapshot;
};

export function OwnerCashControlSection({ lang, cash }: Props) {
  return (
    <section className="rounded-2xl border border-stone-200/90 bg-white p-4 shadow-sm">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h2 className="text-base font-black text-slate-950">{t(lang, "ownerCashTitle")}</h2>
          <p className="text-xs font-semibold text-slate-500">{t(lang, "ownerCashSub")}</p>
        </div>
        {cash.hasUnresolvedVariance ? (
          <span className="rounded-full bg-rose-100 px-2.5 py-0.5 text-[10px] font-black uppercase text-rose-800">
            {t(lang, "ownerCashUnresolved")}
          </span>
        ) : null}
      </div>

      <dl className="mt-4 grid gap-3 sm:grid-cols-2">
        <div className="rounded-xl bg-stone-50 px-3 py-2">
          <dt className="text-xs font-semibold text-stone-500">{t(lang, "ownerCashDrawerOpen")}</dt>
          <dd className="mt-0.5 text-sm font-black text-stone-900">
            {cash.drawerOpen
              ? t(lang, "ownerCashDrawerOpenYes")
              : t(lang, "ownerCashDrawerOpenNo")}
          </dd>
          {cash.openedByLabel ? (
            <dd className="text-xs font-semibold text-stone-600">
              {cash.openedByLabel} · UGX {(cash.openingFloatUgx ?? 0).toLocaleString()}
            </dd>
          ) : null}
        </div>
        <div className="rounded-xl bg-stone-50 px-3 py-2">
          <dt className="text-xs font-semibold text-stone-500">{t(lang, "ownerCashExpected")}</dt>
          <dd className="mt-0.5 text-sm font-black tabular-nums text-stone-900">
            UGX {cash.expectedCashUgx.toLocaleString()}
          </dd>
        </div>
        <div className="rounded-xl bg-stone-50 px-3 py-2">
          <dt className="text-xs font-semibold text-stone-500">{t(lang, "ownerCashCounted")}</dt>
          <dd className="mt-0.5 text-sm font-black tabular-nums text-stone-900">
            {cash.countedCashUgx != null ? `UGX ${cash.countedCashUgx.toLocaleString()}` : "—"}
          </dd>
        </div>
        <div className="rounded-xl bg-stone-50 px-3 py-2">
          <dt className="text-xs font-semibold text-stone-500">{t(lang, "ownerCashDayVariance")}</dt>
          <dd
            className={`mt-0.5 text-sm font-black tabular-nums ${
              cash.dayVarianceUgx != null && cash.dayVarianceUgx < 0 ? "text-rose-700" : "text-stone-900"
            }`}
          >
            {cash.dayVarianceUgx != null ? `UGX ${cash.dayVarianceUgx.toLocaleString()}` : "—"}
          </dd>
        </div>
      </dl>

      {cash.shiftVariances.length > 0 ? (
        <div className="mt-4">
          <p className="text-xs font-black uppercase tracking-wide text-stone-500">{t(lang, "ownerCashShiftVariances")}</p>
          <ul className="mt-2 space-y-1">
            {cash.shiftVariances.map((sv) => (
              <li
                key={sv.shiftId}
                className="flex justify-between rounded-lg border border-stone-100 px-3 py-2 text-xs"
              >
                <span className="font-semibold text-stone-800">{sv.label}</span>
                <span
                  className={`font-black tabular-nums ${sv.kind === "shortage" ? "text-rose-700" : "text-emerald-700"}`}
                >
                  UGX {sv.diffUgx.toLocaleString()}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {cash.floatMismatches.length > 0 ? (
        <div className="mt-4">
          <p className="text-xs font-black uppercase tracking-wide text-rose-600">{t(lang, "ownerCashFloatMismatches")}</p>
          <ul className="mt-2 space-y-1">
            {cash.floatMismatches.map((fm) => (
              <li key={fm.shiftId} className="rounded-lg border border-rose-100 bg-rose-50 px-3 py-2 text-xs">
                <span className="font-bold text-rose-950">{fm.label}</span>
                <span className="ml-2 font-black tabular-nums">UGX {fm.varianceUgx.toLocaleString()}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <p className="mt-4 text-xs font-semibold text-stone-600">
        {t(lang, "ownerCashAdjustments")}: {cash.adjustmentsInPeriod.count} · +UGX{" "}
        {cash.adjustmentsInPeriod.inflowUgx.toLocaleString()} / −UGX{" "}
        {cash.adjustmentsInPeriod.outflowUgx.toLocaleString()}
      </p>

      <div className="mt-4 grid gap-2 sm:grid-cols-2">
        <Link
          to="/office/cash-position"
          className="inline-flex min-h-[44px] items-center justify-center rounded-2xl bg-waka-600 px-4 text-sm font-black text-white"
        >
          {t(lang, "ownerCashViewPosition")}
        </Link>
        <Link
          to="/close-day"
          className="inline-flex min-h-[44px] items-center justify-center rounded-2xl border-2 border-stone-200 px-4 text-sm font-black text-stone-900"
        >
          {t(lang, "ownerCashViewClose")}
        </Link>
      </div>
    </section>
  );
}
