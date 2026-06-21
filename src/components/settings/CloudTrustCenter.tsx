import { useCallback, useEffect, useState } from "react";
import type { Language } from "../../types";
import { t } from "../../lib/i18n";
import {
  buildProductionCertificationReport,
  formatProductionCertificationMarkdown,
  type ProductionCertificationReport,
} from "../../lib/productionCertification";
import { getRecoveryCertification, readLastCloudRecoveryDiagnostics, recordRecoveryCertification } from "../../lib/cloudRecoverySession";
import { readSyncCheckpoints } from "../../lib/syncCheckpoints";

type Props = {
  lang: Language;
};

export function CloudTrustCenter({ lang }: Props) {
  const [report, setReport] = useState<ProductionCertificationReport | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const runCertification = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const next = await buildProductionCertificationReport({ requireCloudParity: true, largeShopMode: true });
      recordRecoveryCertification(next);
      setReport(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : "certification_failed");
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    const last = getRecoveryCertification() ?? readLastCloudRecoveryDiagnostics()?.certification ?? null;
    if (last) setReport(last as ProductionCertificationReport);
  }, []);

  const exportJson = useCallback(() => {
    if (!report) return;
    const blob = new Blob([JSON.stringify(report, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `waka-production-certification-${report.checkedAt.slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }, [report]);

  const exportMarkdown = useCallback(() => {
    if (!report) return;
    const blob = new Blob([formatProductionCertificationMarkdown(report)], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `waka-production-certification-${report.checkedAt.slice(0, 10)}.md`;
    a.click();
    URL.revokeObjectURL(url);
  }, [report]);

  const cp = readSyncCheckpoints();

  return (
    <section className="rounded-3xl border border-stone-200 bg-white p-5 shadow-waka-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-base font-black text-stone-900">{t(lang, "cloudTrustCenterTitle")}</p>
          <p className="mt-1 text-sm font-medium text-stone-500">{t(lang, "cloudTrustCenterSub")}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {report ? (
            <>
              <button
                type="button"
                onClick={exportJson}
                className="rounded-xl border border-stone-200 bg-white px-4 py-2 text-sm font-bold text-stone-800 shadow-waka-sm"
              >
                {t(lang, "cloudTrustExportJson")}
              </button>
              <button
                type="button"
                onClick={exportMarkdown}
                className="rounded-xl border border-stone-200 bg-white px-4 py-2 text-sm font-bold text-stone-800 shadow-waka-sm"
              >
                {t(lang, "cloudTrustExportReport")}
              </button>
            </>
          ) : null}
          <button
            type="button"
            disabled={busy}
            onClick={() => void runCertification()}
            className="rounded-xl bg-waka-600 px-4 py-2 text-sm font-bold text-white shadow-waka-sm disabled:opacity-60"
          >
            {busy ? t(lang, "cloudTrustRunning") : t(lang, "cloudTrustRunCertification")}
          </button>
        </div>
      </div>

      {error ? (
        <p className="mt-3 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm font-semibold text-rose-950">
          {error}
        </p>
      ) : null}

      <div className="mt-4 grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
        <div className="rounded-xl bg-stone-50 px-3 py-2">
          <p className="font-bold text-stone-500">{t(lang, "cloudTrustBootstrap")}</p>
          <p className="mt-0.5 text-sm font-black text-stone-900">
            {cp.bootstrapComplete ? t(lang, "diagnosticsSupported") : t(lang, "diagnosticsNotSupported")}
          </p>
        </div>
        <div className="rounded-xl bg-stone-50 px-3 py-2">
          <p className="font-bold text-stone-500">{t(lang, "cloudTrustVerdict")}</p>
          <p className="mt-0.5 text-sm font-black text-stone-900">
            {report ? (report.verdict === "PASS" ? t(lang, "cloudTrustPass") : t(lang, "cloudTrustFail")) : "—"}
          </p>
        </div>
        <div className="rounded-xl bg-stone-50 px-3 py-2">
          <p className="font-bold text-stone-500">{t(lang, "cloudTrustInventory")}</p>
          <p className="mt-0.5 text-sm font-black text-stone-900">
            {report
              ? report.inventoryIntegrityStatus === "healthy"
                ? t(lang, "cloudTrustPass")
                : report.inventoryIntegrityStatus === "warning"
                  ? t(lang, "recoveryStatusWarning")
                  : t(lang, "cloudTrustFail")
              : "—"}
          </p>
        </div>
        <div className="rounded-xl bg-stone-50 px-3 py-2">
          <p className="font-bold text-stone-500">{t(lang, "cloudTrustInvariant")}</p>
          <p className="mt-0.5 text-sm font-black text-stone-900">
            {report ? (report.recoveryInvariantPassed ? t(lang, "cloudTrustPass") : t(lang, "cloudTrustFail")) : "—"}
          </p>
        </div>
        <div className="rounded-xl bg-stone-50 px-3 py-2">
          <p className="font-bold text-stone-500">{t(lang, "cloudTrustPendingSync")}</p>
          <p className="mt-0.5 text-sm font-black text-stone-900">
            {report ? report.pendingSync.totalPending : "—"}
          </p>
        </div>
        <div className="rounded-xl bg-stone-50 px-3 py-2">
          <p className="font-bold text-stone-500">{t(lang, "cloudTrustFingerprint")}</p>
          <p className="mt-0.5 text-xs font-black tabular-nums text-stone-900">
            {report ? report.operationalFingerprint.hash : "—"}
          </p>
        </div>
      </div>

      {report ? (
        <>
          <div className="mt-4 overflow-x-auto rounded-2xl border border-stone-100">
            <table className="min-w-full text-left text-xs">
              <thead className="bg-stone-50 text-[10px] font-black uppercase tracking-wide text-stone-500">
                <tr>
                  <th className="px-3 py-2">{t(lang, "cloudTrustEntity")}</th>
                  <th className="px-3 py-2">{t(lang, "cloudTrustCloudCount")}</th>
                  <th className="px-3 py-2">{t(lang, "cloudTrustLocalCount")}</th>
                  <th className="px-3 py-2">{t(lang, "cloudTrustMatch")}</th>
                </tr>
              </thead>
              <tbody>
                {report.rows.map((row) => (
                  <tr key={row.id} className="border-t border-stone-100">
                    <td className="px-3 py-2 font-semibold text-stone-800">{t(lang, row.labelKey)}</td>
                    <td className="px-3 py-2 tabular-nums text-stone-700">
                      {row.cloudCount ?? (row.cloudError ? "!" : "—")}
                    </td>
                    <td className="px-3 py-2 tabular-nums text-stone-900">{row.localCount}</td>
                    <td className="px-3 py-2 font-bold">
                      {row.match ? (
                        <span className="text-emerald-700">{t(lang, "cloudTrustPass")}</span>
                      ) : (
                        <span className="text-rose-700">{t(lang, "cloudTrustFail")}</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="mt-4 grid grid-cols-2 gap-2 text-xs sm:grid-cols-3">
            <div className="rounded-xl bg-stone-50 px-3 py-2">
              <p className="font-bold text-stone-500">{t(lang, "cloudTrustRevenue")}</p>
              <p className="mt-0.5 font-black tabular-nums text-stone-900">
                {report.financial.revenueUgx.toLocaleString()}
              </p>
            </div>
            <div className="rounded-xl bg-stone-50 px-3 py-2">
              <p className="font-bold text-stone-500">{t(lang, "cloudTrustProfit")}</p>
              <p className="mt-0.5 font-black tabular-nums text-stone-900">
                {report.financial.profitUgx.toLocaleString()}
              </p>
            </div>
            <div className="rounded-xl bg-stone-50 px-3 py-2">
              <p className="font-bold text-stone-500">{t(lang, "cloudTrustExpectedCash")}</p>
              <p className="mt-0.5 font-black tabular-nums text-stone-900">
                {report.financial.expectedCashTodayUgx.toLocaleString()}
              </p>
            </div>
            <div className="rounded-xl bg-stone-50 px-3 py-2">
              <p className="font-bold text-stone-500">{t(lang, "cloudTrustInventoryValue")}</p>
              <p className="mt-0.5 font-black tabular-nums text-stone-900">
                {report.financial.inventoryValueUgx.toLocaleString()}
              </p>
            </div>
            <div className="rounded-xl bg-stone-50 px-3 py-2">
              <p className="font-bold text-stone-500">{t(lang, "cloudTrustStockQty")}</p>
              <p className="mt-0.5 font-black tabular-nums text-stone-900">
                {report.financial.totalStockQuantity.toLocaleString()}
              </p>
            </div>
            <div className="rounded-xl bg-stone-50 px-3 py-2">
              <p className="font-bold text-stone-500">{t(lang, "cloudTrustDebt")}</p>
              <p className="mt-0.5 font-black tabular-nums text-stone-900">
                {report.financial.totalCustomerDebtUgx.toLocaleString()}
              </p>
            </div>
            <div className="rounded-xl bg-stone-50 px-3 py-2">
              <p className="font-bold text-stone-500">{t(lang, "cloudTrustSupplierBalance")}</p>
              <p className="mt-0.5 font-black tabular-nums text-stone-900">
                {report.financial.totalSupplierBalanceUgx.toLocaleString()}
              </p>
            </div>
            <div className="rounded-xl bg-stone-50 px-3 py-2">
              <p className="font-bold text-stone-500">{t(lang, "cloudTrustMovements")}</p>
              <p className="mt-0.5 font-black tabular-nums text-stone-900">{report.stockMovementCount}</p>
            </div>
          </div>

          {report.recoveryValidation && report.recoveryValidation.failures.length > 0 ? (
            <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2">
              <p className="text-xs font-black uppercase tracking-wide text-amber-900">
                {t(lang, "cloudTrustRecoveryValidation")}
              </p>
              <ul className="mt-1 space-y-1 text-xs font-semibold text-amber-950">
                {report.recoveryValidation.failures.map((f) => (
                  <li key={f.code}>{f.code}: {f.message}</li>
                ))}
              </ul>
            </div>
          ) : null}

          {report.failures.length > 0 ? (
            <ul className="mt-4 space-y-1 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-950">
              {report.failures.map((f) => (
                <li key={f}>{f}</li>
              ))}
            </ul>
          ) : null}
        </>
      ) : (
        <p className="mt-4 text-sm font-medium text-stone-500">{t(lang, "cloudTrustNoReport")}</p>
      )}
    </section>
  );
}
