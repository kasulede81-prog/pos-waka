import { Link } from "react-router-dom";
import type { Language } from "../../types";
import { t } from "../../lib/i18n";
import type { OwnerCashExtended } from "../../lib/ownerCommandCenterBuilders";

type Props = {
  lang: Language;
  cash: OwnerCashExtended;
};

function formatTs(iso: string, lang: Language): string {
  try {
    return new Date(iso).toLocaleString(lang === "lg" ? "lg-UG" : "en-UG", {
      day: "numeric",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

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

      <dl className="mt-3 grid gap-2 sm:grid-cols-3">
        <div className="rounded-xl bg-stone-50 px-2.5 py-2">
          <dt className="text-[10px] font-bold uppercase text-stone-500">{t(lang, "ownerCashExpected")}</dt>
          <dd className="mt-0.5 text-sm font-black tabular-nums">UGX {cash.periodExpectedCashUgx.toLocaleString()}</dd>
        </div>
        <div className="rounded-xl bg-stone-50 px-2.5 py-2">
          <dt className="text-[10px] font-bold uppercase text-stone-500">{t(lang, "ownerCashCounted")}</dt>
          <dd className="mt-0.5 text-sm font-black tabular-nums">
            {cash.latestCountedCashUgx != null ? `UGX ${cash.latestCountedCashUgx.toLocaleString()}` : "—"}
          </dd>
        </div>
        <div className="rounded-xl bg-stone-50 px-2.5 py-2">
          <dt className="text-[10px] font-bold uppercase text-stone-500">{t(lang, "ownerCashDayVariance")}</dt>
          <dd
            className={`mt-0.5 text-sm font-black tabular-nums ${
              cash.latestDayVarianceUgx != null && cash.latestDayVarianceUgx < 0 ? "text-rose-700" : "text-stone-900"
            }`}
          >
            {cash.latestDayVarianceUgx != null ? `UGX ${cash.latestDayVarianceUgx.toLocaleString()}` : "—"}
          </dd>
        </div>
      </dl>

      <dl className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <div className="rounded-lg bg-stone-50 px-2 py-1.5 text-[11px]">
          <dt className="font-semibold text-stone-500">{t(lang, "ownerCashOwnerInjection")}</dt>
          <dd className="font-black tabular-nums">UGX {cash.ownerInjectionsUgx.toLocaleString()}</dd>
        </div>
        <div className="rounded-lg bg-stone-50 px-2 py-1.5 text-[11px]">
          <dt className="font-semibold text-stone-500">{t(lang, "ownerCashOwnerWithdrawal")}</dt>
          <dd className="font-black tabular-nums text-rose-700">UGX {cash.ownerWithdrawalsUgx.toLocaleString()}</dd>
        </div>
        <div className="rounded-lg bg-stone-50 px-2 py-1.5 text-[11px]">
          <dt className="font-semibold text-stone-500">{t(lang, "ownerCashBankDeposit")}</dt>
          <dd className="font-black tabular-nums">UGX {cash.bankDepositsUgx.toLocaleString()}</dd>
        </div>
        <div className="rounded-lg bg-stone-50 px-2 py-1.5 text-[11px]">
          <dt className="font-semibold text-stone-500">{t(lang, "ownerCashSafeTransfer")}</dt>
          <dd className="font-black tabular-nums">
            +{cash.safeTransfersInUgx.toLocaleString()} / −{cash.safeTransfersOutUgx.toLocaleString()}
          </dd>
        </div>
        <div className="rounded-lg bg-stone-50 px-2 py-1.5 text-[11px]">
          <dt className="font-semibold text-stone-500">{t(lang, "ownerCashExpenses")}</dt>
          <dd className="font-black tabular-nums">UGX {cash.cashExpensesUgx.toLocaleString()}</dd>
        </div>
      </dl>

      {cash.topCashierShortages.length > 0 ? (
        <div className="mt-3">
          <p className="text-[10px] font-black uppercase tracking-wide text-stone-500">{t(lang, "ownerCashTopShortages")}</p>
          <ul className="mt-1 space-y-1">
            {cash.topCashierShortages.map((row) => (
              <li key={row.userId} className="flex justify-between text-xs font-bold text-rose-900">
                <span>{row.label}</span>
                <span className="tabular-nums">UGX {row.shortageUgx.toLocaleString()}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {cash.shortageShiftCount > 0 || cash.overageShiftCount > 0 || cash.floatMismatchCount > 0 ? (
        <p className="mt-3 text-xs font-semibold text-stone-600">
          {t(lang, "ownerCashSummary")}: {cash.shortageShiftCount} {t(lang, "ownerCashShortages")} ·{" "}
          {cash.overageShiftCount} {t(lang, "ownerCashOverages")} · {cash.floatMismatchCount}{" "}
          {t(lang, "ownerCashFloatChecks")}
        </p>
      ) : null}

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

      {cash.adjustmentFeed.length > 0 ? (
        <div className="mt-4">
          <p className="text-xs font-black uppercase tracking-wide text-stone-500">{t(lang, "ownerCashAdjustmentFeed")}</p>
          <ul className="mt-2 space-y-1">
            {cash.adjustmentFeed.map((row) => (
              <li key={row.id} className="rounded-lg border border-stone-100 px-3 py-2 text-xs">
                <div className="flex justify-between gap-2">
                  <span className="font-bold text-stone-900">{row.actorLabel}</span>
                  <span
                    className={`font-black tabular-nums ${row.direction === "out" ? "text-rose-700" : "text-emerald-700"}`}
                  >
                    {row.direction === "out" ? "−" : "+"}UGX {row.amountUgx.toLocaleString()}
                  </span>
                </div>
                <p className="mt-0.5 font-semibold text-stone-600">
                  {row.type} · {formatTs(row.occurredAt, lang)}
                </p>
                {row.note ? <p className="mt-0.5 text-stone-500">{row.note}</p> : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {cash.floatVerificationFeed.length > 0 ? (
        <div className="mt-4">
          <p className="text-xs font-black uppercase tracking-wide text-stone-500">{t(lang, "ownerCashFloatFeed")}</p>
          <ul className="mt-2 space-y-1">
            {cash.floatVerificationFeed.map((row) => (
              <li key={row.shiftId} className="rounded-lg border border-rose-100 bg-rose-50 px-3 py-2 text-xs">
                <div className="flex justify-between gap-2">
                  <span className="font-bold text-rose-950">{row.cashierLabel}</span>
                  <span className="font-black tabular-nums text-rose-800">
                    UGX {row.varianceUgx.toLocaleString()}
                  </span>
                </div>
                <p className="mt-0.5 font-semibold text-rose-900">
                  {t(lang, "ownerCashFloatVerifier")}: {row.verifierLabel ?? "—"}
                </p>
                <p className="text-rose-800">
                  {t(lang, "ownerCashFloatExpected")}:{" "}
                  {row.expectedUgx != null ? `UGX ${row.expectedUgx.toLocaleString()}` : "—"} ·{" "}
                  {t(lang, "ownerCashFloatCounted")}:{" "}
                  {row.countedUgx != null ? `UGX ${row.countedUgx.toLocaleString()}` : "—"}
                </p>
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
