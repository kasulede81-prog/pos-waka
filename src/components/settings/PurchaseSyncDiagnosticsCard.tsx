import { useMemo, useState } from "react";
import { actorHasPermission } from "../../lib/actorAuthorization";
import type { Language } from "../../types";
import { t } from "../../lib/i18n";
import { usePosStore } from "../../store/usePosStore";

import { useSessionActor } from "../../context/SessionActorContext";
import {
  buildPurchaseSyncDiagnosticSnapshot,
  filterPurchaseSyncRows,
  type PurchaseSyncDiagnosticFilter,
  type PurchaseSyncIssueRow,
} from "../../lib/purchaseSyncDiagnostics";

const FILTERS: PurchaseSyncDiagnosticFilter[] = [
  "all",
  "unsynced_voids",
  "missing_stock",
  "base_unit",
  "conflicts",
];

function filterLabel(lang: Language, filter: PurchaseSyncDiagnosticFilter): string {
  switch (filter) {
    case "unsynced_voids":
      return t(lang, "purchaseSyncFilterUnsyncedVoids");
    case "missing_stock":
      return t(lang, "purchaseSyncFilterMissingStock");
    case "base_unit":
      return t(lang, "purchaseSyncFilterBaseUnit");
    case "conflicts":
      return t(lang, "purchaseSyncFilterConflicts");
    default:
      return t(lang, "purchaseSyncFilterAll");
  }
}

function statusLabel(lang: Language, status: "healthy" | "warning" | "critical"): string {
  if (status === "healthy") return t(lang, "purchaseSyncStatusHealthy");
  if (status === "critical") return t(lang, "purchaseSyncStatusCritical");
  return t(lang, "purchaseSyncStatusWarning");
}

function kindLabel(lang: Language, kind: PurchaseSyncIssueRow["kind"]): string {
  switch (kind) {
    case "unsynced_void":
      return t(lang, "purchaseSyncKindUnsyncedVoid");
    case "missing_stock_reversal":
      return t(lang, "purchaseSyncKindMissingStock");
    case "base_unit_warning":
      return t(lang, "purchaseSyncKindBaseUnit");
    case "supplier_conflict":
      return t(lang, "purchaseSyncKindConflict");
  }
}

export function PurchaseSyncDiagnosticsCard({ lang }: { lang: Language }) {
  const actor = useSessionActor();
  const purchases = usePosStore((s) => s.purchases);
  const suppliers = usePosStore((s) => s.suppliers);
  const supplierPayments = usePosStore((s) => s.supplierPayments);
  const products = usePosStore((s) => s.products);
  const stockMovements = usePosStore((s) => s.stockMovements);
  const [filter, setFilter] = useState<PurchaseSyncDiagnosticFilter>("all");

  const canView = actorHasPermission(actor, "owner.dashboard");

  const snapshot = useMemo(
    () =>
      buildPurchaseSyncDiagnosticSnapshot({
        purchases,
        suppliers,
        supplierPayments,
        products,
        stockMovements,
      }),
    [purchases, suppliers, supplierPayments, products, stockMovements],
  );

  const rows = useMemo(() => filterPurchaseSyncRows(snapshot.rows, filter), [snapshot.rows, filter]);

  if (!canView) return null;

  const overallStatus =
    snapshot.issueCount === 0
      ? "healthy"
      : snapshot.rows.some((r) => r.status === "critical")
        ? "critical"
        : "warning";

  return (
    <article className="rounded-2xl border border-stone-200/90 bg-white p-4 shadow-sm">
      <p className="text-base font-black text-stone-900">{t(lang, "purchaseSyncDiagnosticsTitle")}</p>
      <p className="mt-1 text-sm text-stone-600">{t(lang, "purchaseSyncDiagnosticsSub")}</p>

      <p
        className={`mt-3 rounded-xl px-3 py-2 text-sm font-bold ${
          overallStatus === "healthy"
            ? "border border-emerald-200 bg-emerald-50 text-emerald-950"
            : overallStatus === "critical"
              ? "border border-red-200 bg-red-50 text-red-950"
              : "border border-amber-200 bg-amber-50 text-amber-950"
        }`}
      >
        {statusLabel(lang, overallStatus)}
        {snapshot.issueCount > 0
          ? ` · ${t(lang, "purchaseSyncIssueCount").replace("{count}", String(snapshot.issueCount))}`
          : null}
      </p>

      <div className="mt-2 grid grid-cols-2 gap-2 text-xs text-stone-600 sm:grid-cols-4">
        <span>{t(lang, "purchaseSyncUnsyncedVoids")}: {snapshot.unsyncedVoidCount}</span>
        <span>{t(lang, "purchaseSyncMissingStock")}: {snapshot.missingStockReversalCount}</span>
        <span>{t(lang, "purchaseSyncBaseUnitWarnings")}: {snapshot.baseUnitWarningCount}</span>
        <span>{t(lang, "purchaseSyncConflicts")}: {snapshot.supplierConflictCount}</span>
      </div>

      <p className="mt-2 text-xs text-stone-500">
        {t(lang, "purchaseSyncLastChecked")}: {new Date(snapshot.checkedAt).toLocaleString()}
        {snapshot.lastSyncAt
          ? ` · ${t(lang, "purchaseSyncLastSync")}: ${new Date(snapshot.lastSyncAt).toLocaleString()}`
          : null}
      </p>

      <div className="mt-3 flex flex-wrap gap-2">
        {FILTERS.map((f) => (
          <button
            key={f}
            type="button"
            onClick={() => setFilter(f)}
            className={`rounded-full px-3 py-1 text-xs font-bold ${
              filter === f ? "bg-stone-900 text-white" : "border border-stone-200 bg-stone-50 text-stone-700"
            }`}
          >
            {filterLabel(lang, f)}
          </button>
        ))}
      </div>

      {rows.length === 0 ? (
        <p className="mt-4 text-sm text-stone-500">{t(lang, "purchaseSyncNoRows")}</p>
      ) : (
        <>
          <div className="mt-4 space-y-2 md:hidden">
            {rows.slice(0, 50).map((row, idx) => (
              <div key={`${row.purchaseId}-${row.kind}-${idx}`} className="rounded-xl border border-stone-200 bg-stone-50 p-3 text-xs">
                <p className="font-black text-stone-900">{kindLabel(lang, row.kind)}</p>
                <p className="mt-1 font-mono text-[10px] text-stone-600">{row.purchaseId.slice(0, 8)}…</p>
                <p className="mt-1 font-semibold text-stone-800">{row.supplierName}</p>
                {row.detail ? <p className="mt-1 text-stone-600">{row.detail}</p> : null}
                <p className="mt-2 font-bold">{statusLabel(lang, row.status)}</p>
              </div>
            ))}
          </div>
          <div className="mt-4 hidden md:block">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-stone-200 text-stone-500">
                  <th className="py-2 pr-2 font-bold">{t(lang, "purchaseSyncColKind")}</th>
                  <th className="py-2 pr-2 font-bold">{t(lang, "purchaseSyncColPurchase")}</th>
                  <th className="py-2 pr-2 font-bold">{t(lang, "purchaseSyncColSupplier")}</th>
                  <th className="py-2 pr-2 font-bold">{t(lang, "purchaseSyncColDetail")}</th>
                  <th className="py-2 font-bold">{t(lang, "purchaseSyncColStatus")}</th>
                </tr>
              </thead>
              <tbody>
                {rows.slice(0, 50).map((row, idx) => (
                  <tr key={`${row.purchaseId}-${row.kind}-${idx}`} className="border-b border-stone-100">
                    <td className="py-2 pr-2 font-semibold text-stone-900">{kindLabel(lang, row.kind)}</td>
                    <td className="py-2 pr-2 font-mono text-[10px] text-stone-600">{row.purchaseId.slice(0, 8)}…</td>
                    <td className="py-2 pr-2">{row.supplierName}</td>
                    <td className="py-2 pr-2 text-stone-600">{row.detail || "—"}</td>
                    <td className="py-2 font-bold">{statusLabel(lang, row.status)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </article>
  );
}
