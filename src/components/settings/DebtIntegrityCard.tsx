import { useMemo, useState } from "react";
import type { Language } from "../../types";
import { t } from "../../lib/i18n";
import { verifyCustomerDebtIntegrity } from "../../lib/customerDebtIntegrity";
import { canSafelyHealCustomerDebt } from "../../lib/debtSyncState";
import { usePosStore } from "../../store/usePosStore";
import { hasPermission } from "../../lib/permissions";
import { useSessionActor } from "../../context/SessionActorContext";

export function DebtIntegrityCard({ lang }: { lang: Language }) {
  const actor = useSessionActor();
  const customers = usePosStore((s) => s.customers);
  const sales = usePosStore((s) => s.sales);
  const debtPayments = usePosStore((s) => s.debtPayments);
  const repair = usePosStore((s) => s.repairCustomerDebtIntegrity);
  const [repairMsg, setRepairMsg] = useState<string | null>(null);

  const status = useMemo(
    () => verifyCustomerDebtIntegrity(customers, sales, debtPayments, { heal: false }),
    [customers, sales, debtPayments],
  );

  const healSafety = canSafelyHealCustomerDebt();
  const canRepair = hasPermission(actor.role, "owner.dashboard") && healSafety.ok;

  const runRepair = () => {
    const result = repair();
    if (!result.ok && result.errorKey) {
      setRepairMsg(t(lang, result.errorKey));
      window.setTimeout(() => setRepairMsg(null), 5000);
      return;
    }
    setRepairMsg(
      t(lang, "debtIntegrityRepairResult")
        .replace("{healed}", String(result.healedCount))
        .replace("{remaining}", String(result.mismatchCount)),
    );
    window.setTimeout(() => setRepairMsg(null), 4000);
  };

  const healthy = status.ok;
  const warn = !healthy && status.mismatches.length > 0;

  return (
    <article className="rounded-2xl border border-stone-200/90 bg-white p-4 shadow-sm">
      <p className="text-base font-black text-stone-900">{t(lang, "debtIntegrityTitle")}</p>
      <p className="mt-1 text-sm text-stone-600">{t(lang, "debtIntegritySub")}</p>

      <p
        className={`mt-3 rounded-xl px-3 py-2 text-sm font-bold ${
          healthy
            ? "border border-emerald-200 bg-emerald-50 text-emerald-950"
            : warn
              ? "border border-amber-200 bg-amber-50 text-amber-950"
              : "border border-red-200 bg-red-50 text-red-950"
        }`}
      >
        {healthy
          ? t(lang, "debtIntegrityHealthy")
          : t(lang, "debtIntegrityWarning").replace("{count}", String(status.mismatches.length))}
      </p>

      {!healSafety.ok ? (
        <p className="mt-2 text-xs font-semibold text-amber-900">{t(lang, healSafety.reasonKey)}</p>
      ) : null}

      {canRepair ? (
        <button
          type="button"
          onClick={runRepair}
          className="mt-4 min-h-[44px] w-full rounded-2xl border-2 border-stone-300 bg-white font-bold text-stone-900"
        >
          {t(lang, "debtIntegrityRepairButton")}
        </button>
      ) : null}
      {repairMsg ? <p className="mt-2 text-center text-sm font-bold text-stone-700">{repairMsg}</p> : null}
    </article>
  );
}
