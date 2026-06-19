import { Link } from "react-router-dom";
import type { Language } from "../../types";
import { t } from "../../lib/i18n";
import type { OwnerFinancialSnapshot } from "../../lib/ownerCommandCenter";

type Props = {
  lang: Language;
  financial: OwnerFinancialSnapshot;
  periodLabel: string;
};

export function OwnerFinancialControlSection({ lang, financial, periodLabel }: Props) {
  const mix = financial.paymentMix;
  const mixTotal =
    mix.cashUgx + mix.mobileMoneyUgx + mix.atmUgx + mix.creditUgx + mix.mixedUgx + mix.otherUgx;

  return (
    <section className="rounded-2xl border border-stone-200/90 bg-white p-4 shadow-sm">
      <h2 className="text-base font-black text-slate-950">{t(lang, "ownerFinancialTitle")}</h2>
      <p className="text-xs font-semibold text-slate-500">{periodLabel}</p>

      <dl className="mt-4 grid gap-3 sm:grid-cols-2">
        <div className="rounded-xl bg-stone-50 px-3 py-2">
          <dt className="text-xs font-semibold text-stone-500">{t(lang, "ownerFinancialDebtCollected")}</dt>
          <dd className="mt-0.5 text-sm font-black tabular-nums">UGX {financial.debtCollectedUgx.toLocaleString()}</dd>
        </div>
        <div className="rounded-xl bg-stone-50 px-3 py-2">
          <dt className="text-xs font-semibold text-stone-500">{t(lang, "ownerFinancialReceivables")}</dt>
          <dd className="mt-0.5 text-sm font-black tabular-nums">UGX {financial.receivablesUgx.toLocaleString()}</dd>
        </div>
        <div className="rounded-xl bg-stone-50 px-3 py-2">
          <dt className="text-xs font-semibold text-stone-500">{t(lang, "ownerFinancialPayables")}</dt>
          <dd className="mt-0.5 text-sm font-black tabular-nums">UGX {financial.payablesUgx.toLocaleString()}</dd>
        </div>
      </dl>

      {mixTotal > 0 ? (
        <div className="mt-4">
          <p className="text-xs font-black uppercase tracking-wide text-stone-500">{t(lang, "ownerFinancialPaymentMix")}</p>
          <ul className="mt-2 space-y-1 text-xs font-semibold text-stone-700">
            {mix.cashUgx > 0 ? (
              <li className="flex justify-between">
                <span>{t(lang, "ownerFinancialCash")}</span>
                <span className="font-black tabular-nums">UGX {mix.cashUgx.toLocaleString()}</span>
              </li>
            ) : null}
            {mix.mobileMoneyUgx > 0 ? (
              <li className="flex justify-between">
                <span>{t(lang, "ownerFinancialMobile")}</span>
                <span className="font-black tabular-nums">UGX {mix.mobileMoneyUgx.toLocaleString()}</span>
              </li>
            ) : null}
            {mix.atmUgx > 0 ? (
              <li className="flex justify-between">
                <span>{t(lang, "ownerFinancialAtm")}</span>
                <span className="font-black tabular-nums">UGX {mix.atmUgx.toLocaleString()}</span>
              </li>
            ) : null}
            {mix.creditUgx > 0 ? (
              <li className="flex justify-between">
                <span>{t(lang, "ownerFinancialCredit")}</span>
                <span className="font-black tabular-nums">UGX {mix.creditUgx.toLocaleString()}</span>
              </li>
            ) : null}
            {mix.mixedUgx > 0 ? (
              <li className="flex justify-between">
                <span>{t(lang, "ownerFinancialMixed")}</span>
                <span className="font-black tabular-nums">UGX {mix.mixedUgx.toLocaleString()}</span>
              </li>
            ) : null}
          </ul>
        </div>
      ) : null}

      <div className="mt-4 grid gap-2 sm:grid-cols-2">
        <Link
          to="/customers"
          className="inline-flex min-h-[44px] items-center justify-center rounded-2xl border-2 border-stone-200 px-4 text-sm font-black text-stone-900"
        >
          {t(lang, "ownerFinancialViewDebts")}
        </Link>
        <Link
          to="/suppliers"
          className="inline-flex min-h-[44px] items-center justify-center rounded-2xl border-2 border-stone-200 px-4 text-sm font-black text-stone-900"
        >
          {t(lang, "ownerFinancialViewSuppliers")}
        </Link>
      </div>
    </section>
  );
}
