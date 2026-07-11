import { useEffect, useMemo } from "react";
import {
  buildRescueHealthSummary,
  exportRescueSupportLogs,
  filterRescueAuditEvents,
  mapOpsAuditToRescueEvents,
} from "../../../../../lib/rescueConsoleIntel";
import { logRescueSupportAction } from "../../../../../lib/rescueSupportActions";
import { RescueActionButton, RescueSection } from "../../../rescue/RescuePrimitives";
import { ResponsiveDataTable } from "../../../../shared/ResponsiveDataTable";
import type { ShopConsoleState } from "../useShopConsoleState";

type Props = { ctx: ShopConsoleState };

function fmtTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("en-GB");
}

export function ShopConsoleAuditTab({ ctx }: Props) {
  const { detail, adminRow, rescue, loadRescueData, setRescueField } = ctx;

  useEffect(() => {
    void loadRescueData();
  }, [loadRescueData]);

  const healthBundle = useMemo(() => {
    if (!detail) return null;
    return buildRescueHealthSummary(detail, rescue.diagnostics);
  }, [detail, rescue.diagnostics]);

  const auditEvents = useMemo(() => {
    const adminEmails = new Map<string, string>();
    if (adminRow?.email) adminEmails.set(adminRow.id, adminRow.email);
    return mapOpsAuditToRescueEvents(rescue.auditRows, adminEmails);
  }, [rescue.auditRows, adminRow]);

  const filteredAudit = useMemo(
    () => filterRescueAuditEvents(auditEvents, rescue.auditFilters),
    [auditEvents, rescue.auditFilters],
  );

  if (!detail) return null;

  const { auditFilters } = rescue;

  return (
    <RescueSection id="audit" title="Audit Timeline" summary="Searchable support and admin actions">
      <div className="mb-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        <input
          type="search"
          placeholder="Search events…"
          value={auditFilters.query}
          onChange={(e) => setRescueField("auditFilters", { ...auditFilters, query: e.target.value })}
          className="min-h-[44px] rounded-xl border border-border px-3 text-sm"
        />
        <input
          type="date"
          value={auditFilters.dateFrom}
          onChange={(e) => setRescueField("auditFilters", { ...auditFilters, dateFrom: e.target.value })}
          className="min-h-[44px] rounded-xl border border-border px-3 text-sm"
        />
        <input
          type="date"
          value={auditFilters.dateTo}
          onChange={(e) => setRescueField("auditFilters", { ...auditFilters, dateTo: e.target.value })}
          className="min-h-[44px] rounded-xl border border-border px-3 text-sm"
        />
        <select
          value={auditFilters.category}
          onChange={(e) => setRescueField("auditFilters", { ...auditFilters, category: e.target.value })}
          className="min-h-[44px] rounded-xl border border-border px-3 text-sm"
        >
          <option value="all">All categories</option>
          {["account", "sync", "billing", "support", "shop", "admin"].map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
        <select
          value={auditFilters.severity}
          onChange={(e) => setRescueField("auditFilters", { ...auditFilters, severity: e.target.value })}
          className="min-h-[44px] rounded-xl border border-border px-3 text-sm"
        >
          <option value="all">All severity</option>
          {["info", "warning", "critical"].map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      </div>
      {filteredAudit.length === 0 ? (
        <p className="text-sm font-semibold text-muted-foreground">No audit events match filters.</p>
      ) : (
        <ResponsiveDataTable minWidthPx={640}>
          <thead>
            <tr>
              <th>When</th>
              <th>User</th>
              <th>Category</th>
              <th>Severity</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            {filteredAudit.map((e) => (
              <tr key={e.id}>
                <td>{fmtTime(e.at)}</td>
                <td>{e.user}</td>
                <td>{e.category}</td>
                <td>{e.severity}</td>
                <td className="max-w-[240px] truncate" title={e.summary}>
                  {e.summary}
                </td>
              </tr>
            ))}
          </tbody>
        </ResponsiveDataTable>
      )}
      <RescueActionButton
        variant="secondary"
        disabled={!healthBundle}
        onClick={() => {
          if (!healthBundle) return;
          const blob = exportRescueSupportLogs({
            shopId: detail.shop.id,
            shopName: detail.shop.name,
            events: filteredAudit,
            health: healthBundle.summary,
            diagnostics: rescue.diagnostics,
          });
          const url = URL.createObjectURL(new Blob([blob], { type: "application/json" }));
          const a = document.createElement("a");
          a.href = url;
          a.download = `waka-rescue-${detail.shop.id.slice(0, 8)}-${Date.now()}.json`;
          a.click();
          URL.revokeObjectURL(url);
          void logRescueSupportAction({
            shopId: detail.shop.id,
            action: "rescue_export_logs",
            result: "ok",
          });
        }}
      >
        Export support logs
      </RescueActionButton>
    </RescueSection>
  );
}
