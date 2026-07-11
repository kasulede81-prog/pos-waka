import { useEffect, useMemo, useState } from "react";
import { actorHasPermission } from "../../lib/actorAuthorization";
import type { Language } from "../../types";
import { t } from "../../lib/i18n";
import { usePosStore } from "../../store/usePosStore";

import { useSessionActor } from "../../context/SessionActorContext";
import {
  buildDebtSyncDiagnosticSnapshot,
  filterDebtSyncRows,
  type DebtSyncDiagnosticFilter,
} from "../../lib/debtSyncDiagnostics";
import { useSystemHealthDiagnostics } from "./SystemHealthDiagnosticsProvider";

const FILTERS: DebtSyncDiagnosticFilter[] = ["all", "mismatched", "missing_payments", "unsynced"];

function filterLabel(lang: Language, filter: DebtSyncDiagnosticFilter): string {
  switch (filter) {
    case "mismatched":
      return t(lang, "debtSyncFilterMismatched");
    case "missing_payments":
      return t(lang, "debtSyncFilterMissingPayments");
    case "unsynced":
      return t(lang, "debtSyncFilterUnsynced");
    default:
      return t(lang, "debtSyncFilterAll");
  }
}

function statusLabel(lang: Language, status: "healthy" | "warning" | "critical"): string {
  if (status === "healthy") return t(lang, "debtSyncStatusHealthy");
  if (status === "critical") return t(lang, "debtSyncStatusCritical");
  return t(lang, "debtSyncStatusWarning");
}

export function DebtSyncDiagnosticsCard({ lang, lazy = false }: { lang: Language; lazy?: boolean }) {
  const actor = useSessionActor();
  const customers = usePosStore((s) => s.customers);
  const sales = usePosStore((s) => s.sales);
  const debtPayments = usePosStore((s) => s.debtPayments);
  const [filter, setFilter] = useState<DebtSyncDiagnosticFilter>("all");
  const { shared, ensureShared } = useSystemHealthDiagnostics();

  useEffect(() => {
    if (lazy) void ensureShared();
  }, [lazy, ensureShared]);

  const canView = actorHasPermission(actor, "owner.dashboard");

  const snapshot = useMemo(() => {
    if (shared?.debtSync) return shared.debtSync;
    return buildDebtSyncDiagnosticSnapshot({ customers, sales, debtPayments });
  }, [shared, customers, sales, debtPayments]);

  const rows = useMemo(
    () => filterDebtSyncRows(snapshot.rows, filter, snapshot.hydration),
    [snapshot, filter],
  );

  if (!canView) return null;

  const overallStatus =
    !snapshot.hydration.paymentsHydrated && snapshot.hydration.syncKnown === false
      ? "warning"
      : snapshot.mismatchCount === 0
        ? "healthy"
        : snapshot.rows.some((r) => r.status === "critical")
          ? "critical"
          : "warning";

  return (
    <article className="rounded-2xl border border-border/90 bg-card p-4 shadow-sm">
      <p className="text-base font-black text-foreground">{t(lang, "debtSyncDiagnosticsTitle")}</p>
      <p className="mt-1 text-sm text-muted-foreground">{t(lang, "debtSyncDiagnosticsSub")}</p>

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
        {snapshot.mismatchCount > 0
          ? ` · ${t(lang, "debtSyncMismatchCount").replace("{count}", String(snapshot.mismatchCount))}`
          : null}
      </p>

      {!snapshot.hydration.paymentsHydrated ? (
        <p className="mt-2 text-xs font-semibold text-amber-900">{t(lang, "debtSyncPaymentsNotHydrated")}</p>
      ) : null}

      <p className="mt-2 text-xs text-muted-foreground">
        {t(lang, "debtSyncLastChecked")}: {new Date(snapshot.checkedAt).toLocaleString()}
        {snapshot.lastSyncAt ? ` · ${t(lang, "debtSyncLastSync")}: ${new Date(snapshot.lastSyncAt).toLocaleString()}` : null}
      </p>

      <div className="mt-3 flex flex-wrap gap-2">
        {FILTERS.map((f) => (
          <button
            key={f}
            type="button"
            onClick={() => setFilter(f)}
            className={`rounded-full px-3 py-1 text-xs font-bold ${
              filter === f ? "bg-foreground text-background" : "border border-border bg-muted text-muted-foreground"
            }`}
          >
            {filterLabel(lang, f)}
          </button>
        ))}
      </div>

      {rows.length === 0 ? (
        <p className="mt-4 text-sm text-muted-foreground">{t(lang, "debtSyncNoRows")}</p>
      ) : (
        <>
          <div className="mt-4 space-y-2 md:hidden">
            {rows.slice(0, 50).map((row) => (
              <div key={row.customerId} className="rounded-xl border border-border bg-muted p-3 text-xs">
                <p className="font-black text-foreground">{row.customerName}</p>
                <dl className="mt-2 grid grid-cols-2 gap-x-2 gap-y-1">
                  <dt className="text-muted-foreground">{t(lang, "debtSyncColStored")}</dt>
                  <dd className="text-right tabular-nums font-semibold">UGX {row.actual.toLocaleString()}</dd>
                  <dt className="text-muted-foreground">{t(lang, "debtSyncColExpected")}</dt>
                  <dd className="text-right tabular-nums font-semibold">UGX {row.expected.toLocaleString()}</dd>
                  <dt className="text-muted-foreground">{t(lang, "debtSyncColDifference")}</dt>
                  <dd className="text-right tabular-nums font-semibold">
                    {row.delta >= 0 ? "+" : ""}
                    {row.delta.toLocaleString()}
                  </dd>
                  <dt className="text-muted-foreground">{t(lang, "debtSyncColStatus")}</dt>
                  <dd className="text-right font-bold">{statusLabel(lang, row.status)}</dd>
                </dl>
              </div>
            ))}
          </div>
          <div className="mt-4 hidden md:block">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-border text-muted-foreground">
                  <th className="py-2 pr-2 font-bold">{t(lang, "debtSyncColCustomer")}</th>
                  <th className="py-2 pr-2 font-bold">{t(lang, "debtSyncColStored")}</th>
                  <th className="py-2 pr-2 font-bold">{t(lang, "debtSyncColExpected")}</th>
                  <th className="py-2 pr-2 font-bold">{t(lang, "debtSyncColDifference")}</th>
                  <th className="py-2 font-bold">{t(lang, "debtSyncColStatus")}</th>
                </tr>
              </thead>
              <tbody>
                {rows.slice(0, 50).map((row) => (
                  <tr key={row.customerId} className="border-b border-border">
                    <td className="py-2 pr-2 font-semibold text-foreground">{row.customerName}</td>
                    <td className="py-2 pr-2 tabular-nums">UGX {row.actual.toLocaleString()}</td>
                    <td className="py-2 pr-2 tabular-nums">UGX {row.expected.toLocaleString()}</td>
                    <td className="py-2 pr-2 tabular-nums">{row.delta >= 0 ? "+" : ""}{row.delta.toLocaleString()}</td>
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
