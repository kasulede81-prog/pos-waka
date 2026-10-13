import { useCallback, useEffect, useMemo, useState } from "react";
import { Loader2, RefreshCw, Search } from "lucide-react";
import type { WakaInternalAdminRow } from "../../../../lib/wakaInternalAdmin";
import {
  FULFILMENT_METHOD_LABELS,
  type FulfilmentMethod,
  type HandoverHistory,
  type HandoverRecord,
  fetchHandoverHistory,
} from "../../../../lib/printerFulfilment";
import { statusTokens } from "../../../../lib/statusTokens";
import { adminPermissions } from "../adminRoles";

/**
 * Completed handovers — the settled record.
 *
 * Every name shown here is the SNAPSHOT taken when the printer was handed over,
 * not a live lookup. That is deliberate: the row survives the account being
 * deleted, so an account that no longer exists still shows the name it had when
 * its printer was issued, flagged as deleted rather than appearing blank.
 *
 * READ-ONLY. There is no edit, no cancel and no reassign on this screen, because
 * the backend has no operation for any of them — a completed handover is a
 * historical fact.
 */

const inputCls =
  "w-full rounded-xl border border-border bg-card px-3 py-2.5 text-sm font-semibold text-foreground outline-none focus:border-waka-500 disabled:opacity-60";
const labelCls = "mb-1 block text-xs font-black uppercase tracking-wide text-muted-foreground";
const secondaryBtnCls =
  "inline-flex min-h-[44px] items-center justify-center gap-2 rounded-xl bg-muted px-3 text-sm font-black text-muted-foreground disabled:opacity-60";
const cardCls = "rounded-2xl border border-border bg-card p-4 shadow-sm";

function formatDateTime(iso: string | null): string {
  if (!iso) return "—";
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "—";
  return new Date(t).toLocaleString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function methodLabel(method: string | null): string {
  if (!method) return "—";
  return FULFILMENT_METHOD_LABELS[method as FulfilmentMethod] ?? method;
}

type Props = { adminRow: WakaInternalAdminRow | null; previewMode?: boolean };

export function PrinterHistoryPanel({ adminRow, previewMode = false }: Props) {
  const perms = adminPermissions(adminRow);
  // The RPC is gated on the fulfilment roles, so the screen follows the same
  // rule rather than showing a list that would come back forbidden.
  const canView = perms.canManagePrinterFulfilment || previewMode;

  const [history, setHistory] = useState<HandoverHistory | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [query, setQuery] = useState("");

  const load = useCallback(async (opts?: { silent?: boolean }) => {
    if (!opts?.silent) setLoading(true);
    const res = await fetchHandoverHistory({ limit: 200 });
    if (res.ok) {
      setHistory(res.data);
      setLoadError(null);
    } else {
      setLoadError(res.error);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    if (!canView) return; // the permission branch below renders instead
    void load();
  }, [canView, load]);

  const rows = useMemo(() => history?.handovers ?? [], [history]);
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((h) =>
      [h.serial_number, h.organization_name, h.branch_name, h.received_by_name, h.received_by_phone]
        .filter(Boolean)
        .some((field) => String(field).toLowerCase().includes(q)),
    );
  }, [rows, query]);

  if (!canView) {
    return (
      <div className={cardCls}>
        <p className="text-sm font-bold text-muted-foreground">
          You do not have permission to view handover records.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className={`${cardCls} flex flex-wrap items-end gap-3`}>
        <div className="min-w-[240px] flex-1">
          <label className={labelCls} htmlFor="history-search">
            Search
          </label>
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <input
              id="history-search"
              type="search"
              className={`${inputCls} pl-9`}
              placeholder="Serial, account, branch, recipient or phone"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
        </div>
        <button type="button" className={secondaryBtnCls} onClick={() => void load()} disabled={loading}>
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
          Refresh
        </button>
        {history ? (
          <p className="text-xs font-semibold text-muted-foreground">
            {filtered.length} of {history.total} recorded handover{history.total === 1 ? "" : "s"}
          </p>
        ) : null}
      </div>

      {loadError ? (
        <p className={statusTokens.danger.banner} role="alert">
          {loadError}
        </p>
      ) : null}

      <div className="overflow-x-auto">
        <table className="w-full min-w-[980px] text-left text-sm">
          <thead>
            <tr className="text-xs font-black uppercase tracking-wide text-muted-foreground">
              <th className="py-2">Serial</th>
              <th className="py-2">Account</th>
              <th className="py-2">Branch</th>
              <th className="py-2">Received by</th>
              <th className="py-2">Method</th>
              <th className="py-2">Handed over</th>
              <th className="py-2">Reference</th>
            </tr>
          </thead>
          <tbody>
            {loading && rows.length === 0 ? (
              <tr>
                <td colSpan={7} className="py-8 text-center text-sm font-semibold text-muted-foreground">
                  Loading handover history…
                </td>
              </tr>
            ) : filtered.length === 0 ? (
              <tr>
                <td colSpan={7} className="py-8 text-center text-sm font-semibold text-muted-foreground">
                  {rows.length === 0
                    ? "No printers have been handed over yet. Completed handovers appear here as they are recorded."
                    : "No handovers match that search."}
                </td>
              </tr>
            ) : (
              filtered.map((h: HandoverRecord) => (
                <tr key={h.assignment_id} className="border-t border-border">
                  <td className="py-3 font-black tabular-nums text-foreground">{h.serial_number}</td>
                  <td className="py-3">
                    <span className="font-semibold text-foreground">{h.organization_name ?? "—"}</span>
                    {h.account_deleted ? (
                      <span className="ml-2 rounded-full bg-muted px-2 py-0.5 text-xs font-bold text-muted-foreground">
                        account deleted
                      </span>
                    ) : null}
                  </td>
                  <td className="py-3 font-semibold text-muted-foreground">{h.branch_name ?? "—"}</td>
                  <td className="py-3">
                    <span className="font-semibold text-foreground">{h.received_by_name ?? "—"}</span>
                    {h.received_by_phone ? (
                      <span className="block font-mono text-xs text-muted-foreground">{h.received_by_phone}</span>
                    ) : null}
                  </td>
                  <td className="py-3 font-semibold text-muted-foreground">{methodLabel(h.fulfilment_method)}</td>
                  <td className="py-3 font-semibold text-muted-foreground">{formatDateTime(h.handed_over_at)}</td>
                  <td className="py-3">
                    <span className="font-mono text-xs text-muted-foreground">{h.evidence_reference ?? "—"}</span>
                    {h.note ? <span className="block text-xs font-semibold text-muted-foreground">{h.note}</span> : null}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <p className="text-xs font-semibold leading-relaxed text-muted-foreground">
        Account and branch names are the ones recorded at handover, so a record stays readable after an account is
        closed. Entries are read-only: a completed handover cannot be edited, cancelled or reassigned.
      </p>
    </div>
  );
}
