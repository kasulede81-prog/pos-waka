import { useCallback, useEffect, useState } from "react";
import { Loader2, RefreshCw } from "lucide-react";
import type { WakaInternalAdminRow } from "../../../../lib/wakaInternalAdmin";
import {
  PRINTER_REQUEST_STATUSES,
  PRINTER_REQUEST_STATUS_LABELS,
  fetchPrinterRequests,
  setPrinterRequestStatus,
  type PrinterCollectionRequest,
  type PrinterRequestStatus,
} from "../../../../lib/printerFulfilment";
import { adminPermissions } from "../adminRoles";
import { statusTokens } from "../../../../lib/statusTokens";

/**
 * Collection requests — the queue the merchants fill.
 *
 * The customer half shipped first, so requests could be created with nothing
 * able to read them. This is the other end of that wire.
 *
 * TWO THINGS IT DELIBERATELY DOES NOT DO.
 *   * It does not allocate anything. Moving a request to "Completed" marks the
 *     REQUEST; the physical printer is still handed over through the Fulfilment
 *     tab, so there is exactly one path to stock and one place a serial is
 *     recorded.
 *   * It never invents state. A request is shown as the server reports it, and
 *     `open_assignment_id` is surfaced so a request that has since been met by a
 *     real allocation is visible as stale rather than quietly "pending".
 */
type Props = {
  adminRow: WakaInternalAdminRow | null;
  previewMode?: boolean;
};

function fmt(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

const CHANNEL_LABELS: Record<string, string> = {
  branch: "Branch collection",
  whatsapp: "WhatsApp",
};

export function PrinterRequestsPanel({ adminRow, previewMode = false }: Props) {
  const perms = adminPermissions(adminRow);
  const canAct = perms.canManagePrinterFulfilment && !previewMode;

  const [rows, setRows] = useState<PrinterCollectionRequest[]>([]);
  const [filter, setFilter] = useState<PrinterRequestStatus | "">("");
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const res = await fetchPrinterRequests({ status: filter || null, limit: 200 });
    if (res.ok) {
      setRows(res.data.requests);
      setLoadError(null);
    } else {
      // Keep the last good queue; a failed read must not read as "no requests".
      setLoadError(res.error);
    }
    setLoading(false);
  }, [filter]);

  useEffect(() => {
    void load();
  }, [load]);

  const move = async (requestId: string, status: PrinterRequestStatus) => {
    setBusyId(requestId);
    setNotice(null);
    const res = await setPrinterRequestStatus({ requestId, status });
    if (res.ok) {
      setNotice(`Request marked ${PRINTER_REQUEST_STATUS_LABELS[res.data.status] ?? res.data.status}.`);
      await load();
    } else {
      setNotice(res.error);
    }
    setBusyId(null);
  };

  const btn =
    "inline-flex min-h-[36px] items-center gap-1.5 rounded-lg border border-border bg-card px-3 text-xs font-bold text-foreground disabled:opacity-50";

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => setFilter("")}
          className={`min-h-[36px] rounded-full px-3 text-xs font-black uppercase ${
            filter === "" ? "bg-waka-600 text-white" : "bg-card text-muted-foreground ring-1 ring-border"
          }`}
        >
          All
        </button>
        {PRINTER_REQUEST_STATUSES.map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => setFilter(s)}
            className={`min-h-[36px] rounded-full px-3 text-xs font-black uppercase ${
              filter === s ? "bg-waka-600 text-white" : "bg-card text-muted-foreground ring-1 ring-border"
            }`}
          >
            {PRINTER_REQUEST_STATUS_LABELS[s]}
          </button>
        ))}
        <button type="button" onClick={() => void load()} className={btn}>
          <RefreshCw className="h-3.5 w-3.5" />
          Refresh
        </button>
      </div>

      {notice ? (
        <p role="status" className="text-xs font-semibold text-waka-800">
          {notice}
        </p>
      ) : null}

      {loadError ? (
        <p role="alert" className={statusTokens.danger.banner}>
          The request queue could not be loaded, so this list may be incomplete. {loadError}
        </p>
      ) : null}

      {loading && rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">Loading requests…</p>
      ) : rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No collection requests{filter ? ` with status “${PRINTER_REQUEST_STATUS_LABELS[filter]}”` : ""}.
        </p>
      ) : (
        <ul className="space-y-2">
          {rows.map((r) => (
            <li key={r.request_id} className="rounded-xl border border-border bg-card p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="text-sm font-black text-foreground">
                    {r.organization_name ?? "Account"} · {r.shop_name ?? "—"}
                    {r.shop_number ? <span className="ml-2 font-mono text-xs text-muted-foreground">{r.shop_number}</span> : null}
                  </p>
                  <p className="mt-0.5 text-xs font-semibold text-muted-foreground">
                    {CHANNEL_LABELS[r.channel] ?? r.channel} · asked {fmt(r.created_at)}
                    {r.contact_phone ? ` · ${r.contact_phone}` : ""}
                  </p>
                </div>
                <span
                  className={`rounded-full px-2.5 py-1 text-[10px] font-black uppercase ${
                    r.status === "fulfilled"
                      ? statusTokens.success.badge
                      : r.status === "cancelled"
                        ? statusTokens.danger.badge
                        : statusTokens.warning.badge
                  }`}
                >
                  {PRINTER_REQUEST_STATUS_LABELS[r.status] ?? r.status}
                </span>
              </div>

              {r.note ? <p className="mt-2 text-xs text-muted-foreground">{r.note}</p> : null}

              {/*
                A request the account has already been given a printer for. Shown
                rather than hidden, so the desk can see it is stale.
              */}
              {r.open_assignment_id ? (
                <p className="mt-2 text-xs font-semibold text-amber-900">
                  This account already holds a printer. Close this request, or check the Fulfilment tab.
                </p>
              ) : null}

              {r.acknowledged_at ? (
                <p className="mt-1 text-[11px] text-muted-foreground">Acknowledged {fmt(r.acknowledged_at)}</p>
              ) : null}
              {r.fulfilled_at ? (
                <p className="mt-1 text-[11px] text-muted-foreground">Completed {fmt(r.fulfilled_at)}</p>
              ) : null}

              {canAct ? (
                <div className="mt-2 flex flex-wrap gap-2">
                  {r.status === "requested" ? (
                    <button type="button" disabled={busyId === r.request_id} className={btn} onClick={() => void move(r.request_id, "acknowledged")}>
                      {busyId === r.request_id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
                      Acknowledge
                    </button>
                  ) : null}
                  {r.status === "acknowledged" ? (
                    <button type="button" disabled={busyId === r.request_id} className={btn} onClick={() => void move(r.request_id, "fulfilled")}>
                      {busyId === r.request_id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
                      Mark completed
                    </button>
                  ) : null}
                  {r.status === "requested" || r.status === "acknowledged" ? (
                    <button
                      type="button"
                      disabled={busyId === r.request_id}
                      className={btn}
                      onClick={() => void move(r.request_id, "cancelled")}
                    >
                      Cancel request
                    </button>
                  ) : null}
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      )}

      <p className="text-[11px] text-muted-foreground">
        A request is not a reservation. Allocate the printer in the Fulfilment tab — that is where the serial number is
        recorded against the account.
      </p>
    </div>
  );
}
