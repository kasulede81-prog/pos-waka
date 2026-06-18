import { useCallback, useEffect, useState } from "react";
import type { Language } from "../../types";
import { t } from "../../lib/i18n";
import {
  runProductionReadinessSelfTest,
  type ReadinessCheck,
  type ReadinessStatus,
  type ReleaseChecklistItem,
} from "../../lib/productionReadiness";
import { usePosStore } from "../../store/usePosStore";
import { useSystemHealthDiagnostics } from "./SystemHealthDiagnosticsProvider";

function statusLabel(lang: Language, status: ReadinessStatus): string {
  if (status === "pass") return t(lang, "readinessPass");
  if (status === "warning") return t(lang, "readinessWarning");
  return t(lang, "readinessFail");
}

function statusClass(status: ReadinessStatus): string {
  if (status === "pass") return "text-emerald-700";
  if (status === "warning") return "text-amber-800";
  return "text-red-700";
}

function CheckRow({ lang, check }: { lang: Language; check: ReadinessCheck }) {
  return (
    <li className="flex items-start justify-between gap-2 rounded-xl bg-stone-50 px-3 py-2 text-sm">
      <span className="font-semibold text-stone-800">{check.label}</span>
      <span className={`font-black ${statusClass(check.status)}`}>{statusLabel(lang, check.status)}</span>
    </li>
  );
}

export function ProductionReadinessCard({ lang, lazy = false }: { lang: Language; lazy?: boolean }) {
  const customers = usePosStore((s) => s.customers);
  const sales = usePosStore((s) => s.sales);
  const debtPayments = usePosStore((s) => s.debtPayments);
  const products = usePosStore((s) => s.products);
  const stockMovements = usePosStore((s) => s.stockMovements);
  const auditLogs = usePosStore((s) => s.auditLogs);
  const { queue, refreshQueue } = useSystemHealthDiagnostics();

  const [loading, setLoading] = useState(true);
  const [overall, setOverall] = useState<ReadinessStatus>("pass");
  const [certificationState, setCertificationState] = useState<"PASS" | "WARNING" | "FAIL">("PASS");
  const [checks, setChecks] = useState<ReadinessCheck[]>([]);
  const [releaseChecklist, setReleaseChecklist] = useState<ReleaseChecklistItem[]>([]);

  const runTest = useCallback(() => {
    setLoading(true);
    void (async () => {
      const snap = queue ?? (await refreshQueue());
      const report = await runProductionReadinessSelfTest({
        customers,
        sales,
        debtPayments,
        products,
        stockMovements,
        auditLogs,
        syncQueue: snap.rawQueue,
      });
      setOverall(report.overall);
      setCertificationState(report.certificationState);
      setChecks(report.checks);
      setReleaseChecklist(report.releaseChecklist);
      setLoading(false);
    })();
  }, [
    queue,
    refreshQueue,
    customers,
    sales,
    debtPayments,
    products,
    stockMovements,
    auditLogs,
  ]);

  useEffect(() => {
    if (lazy && !queue) return;
    runTest();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- lazy: run once when queue ready; non-lazy: store-driven
  }, lazy ? [queue?.checkedAt] : [customers, sales, debtPayments, products, stockMovements, auditLogs, queue?.checkedAt]);

  return (
    <article className="rounded-2xl border border-stone-200/90 bg-white p-4 shadow-sm">
      <p className="text-base font-black text-stone-900">{t(lang, "productionReadinessTitle")}</p>
      <p className="mt-1 text-sm text-stone-600">{t(lang, "productionReadinessSub")}</p>

      {loading ? (
        <p className="mt-3 text-sm font-semibold text-stone-500">{t(lang, "systemHealthLoading")}</p>
      ) : (
        <div
          data-certification-state={certificationState}
          className={`mt-3 rounded-xl border px-3 py-2 text-sm font-bold ${
            overall === "pass"
              ? "border-emerald-200 bg-emerald-50 text-emerald-950"
              : overall === "warning"
                ? "border-amber-200 bg-amber-50 text-amber-950"
                : "border-red-200 bg-red-50 text-red-950"
          }`}
        >
          <p>{t(lang, "productionReadinessOverall").replace("{status}", statusLabel(lang, overall))}</p>
          <p className="mt-1 text-xs font-black tracking-wide">
            {t(lang, "productionCertificationState").replace("{state}", certificationState)}
          </p>
        </div>
      )}

      <ul className="mt-3 space-y-2">
        {checks.map((c) => (
          <CheckRow key={c.id} lang={lang} check={c} />
        ))}
      </ul>
      <div className="mt-4 rounded-xl border border-stone-200 bg-stone-50/70 p-3">
        <p className="text-xs font-black uppercase tracking-wide text-stone-700">{t(lang, "releaseChecklistTitle")}</p>
        <ul className="mt-2 space-y-2">
          {releaseChecklist.map((item) => (
            <li key={item.id} className="flex items-start justify-between gap-2 text-sm">
              <span className="font-semibold text-stone-800">{item.id}</span>
              <span className={item.passed ? "font-black text-emerald-700" : "font-black text-red-700"}>
                {item.passed ? t(lang, "systemHealthPass") : t(lang, "systemHealthFail")}
              </span>
            </li>
          ))}
        </ul>
      </div>

      <button
        type="button"
        onClick={runTest}
        className="mt-4 min-h-[44px] w-full rounded-2xl border-2 border-stone-300 bg-white font-bold text-stone-900"
      >
        {t(lang, "productionReadinessRerun")}
      </button>
    </article>
  );
}
