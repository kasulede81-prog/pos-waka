import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, Loader2, MessageCircle, RefreshCw, Search, X } from "lucide-react";
import type { RecentShopRow, WakaInternalAdminRow } from "../../../../lib/wakaInternalAdmin";
import { fetchInternalOpsSearchShops } from "../../../../lib/wakaInternalAdmin";
import { wakaSupportWhatsAppUrl } from "../../../../config/company";
import {
  ASSIGNMENT_STATUS_LABELS,
  FULFILMENT_METHODS,
  FULFILMENT_METHOD_LABELS,
  type FulfilmentMethod,
  type OpenAssignment,
  type PrinterInventory,
  ELIGIBILITY_REASON_LABELS,
  type EligibilityPreview,
  assignPrinter,
  cancelPrinterAssignment,
  daysUntil,
  fetchPrinterEligibility,
  fetchPrinterInventory,
  markAssignmentReady,
  recordHandover,
} from "../../../../lib/printerFulfilment";
import { statusTokens } from "../../../../lib/statusTokens";
import { adminPermissions } from "../adminRoles";

/**
 * Fulfilment: claim a printer for an eligible account, then record the real
 * handover.
 *
 * ELIGIBILITY IS NEVER DECIDED HERE. The operator picks the ACCOUNT; the server
 * resolves it to an organization, reads that organization's subscription and
 * decides. A refusal comes back as `not_eligible` with an explanation.
 *
 * HANDOVER HISTORY lives on its own tab. `internal_ops_printer_inventory` returns
 * OPEN assignments only (reserved / ready_for_collection); the completed
 * handovers — recipient, branch and timestamp — are read through
 * `internal_ops_printer_handover_history`, added in
 * 20261013110000_printer_read_rpcs.sql, which is what the History panel renders.
 * Neither screen reads `waka_printer_assignments` directly: those tables are
 * RLS-closed with no policies precisely so that access goes through an
 * authorized RPC.
 */

const inputCls =
  "w-full rounded-xl border border-border bg-card px-3 py-2.5 text-sm font-semibold text-foreground outline-none focus:border-waka-500 disabled:opacity-60";
const labelCls = "mb-1 block text-xs font-black uppercase tracking-wide text-muted-foreground";
const primaryBtnCls =
  "inline-flex min-h-[44px] items-center justify-center gap-2 rounded-xl bg-waka-600 px-4 text-sm font-black text-white hover:bg-waka-700 disabled:opacity-60";
const secondaryBtnCls =
  "inline-flex min-h-[44px] items-center justify-center gap-2 rounded-xl bg-muted px-3 text-sm font-black text-muted-foreground disabled:opacity-60";
const dangerBtnCls =
  "inline-flex min-h-[44px] items-center justify-center gap-2 rounded-xl border border-danger/30 bg-danger-muted px-4 text-sm font-black text-danger disabled:opacity-60";
const cardCls = "rounded-2xl border border-border bg-card p-4 shadow-sm";

function assignmentBadge(status: string) {
  if (status === "reserved") return statusTokens.warning.badge;
  if (status === "ready_for_collection") return statusTokens.info.badge;
  if (status === "handed_over") return statusTokens.success.badge;
  return statusTokens.draft.badge;
}

/** A lease that has already lapsed is flagged, not silently shown as live. */
function LeaseCell({ until }: { until: string | null }) {
  const days = daysUntil(until);
  if (!until || days === null) return <span className="font-semibold text-muted-foreground">—</span>;
  const date = new Date(until).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
  if (days < 0) {
    return (
      <span className={statusTokens.danger.badge} title="The server reclaims this on the next list or claim.">
        Lapsed {date}
      </span>
    );
  }
  return (
    <span className={days <= 3 ? statusTokens.warning.badge : "font-semibold text-muted-foreground"}>
      {date} · {days}d left
    </span>
  );
}

type Props = { adminRow: WakaInternalAdminRow | null; previewMode?: boolean };

export function PrinterFulfilmentPanel({ adminRow, previewMode = false }: Props) {
  const perms = adminPermissions(adminRow);
  const canAct = perms.canManagePrinterFulfilment && !previewMode;

  const [inventory, setInventory] = useState<PrinterInventory | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  // ---- assign ----
  const [shopQuery, setShopQuery] = useState("");
  const [shopRows, setShopRows] = useState<RecentShopRow[]>([]);
  const [shopSearching, setShopSearching] = useState(false);
  const [selectedShop, setSelectedShop] = useState<RecentShopRow | null>(null);
  const [assigning, setAssigning] = useState(false);
  // Read-only eligibility preview for the selected account. The VERDICT comes
  // from the server; nothing here decides it.
  const [preview, setPreview] = useState<EligibilityPreview | null>(null);
  const [previewing, setPreviewing] = useState(false);
  // A verdict that never ARRIVED is not the same as one that said "no". Tracked
  // separately because `preview === null` also means "not asked yet".
  const [previewError, setPreviewError] = useState<string | null>(null);

  // ---- handover ----
  const [handoverFor, setHandoverFor] = useState<OpenAssignment | null>(null);
  const [branchName, setBranchName] = useState<string | null>(null);
  const [branchSearch, setBranchSearch] = useState("");
  const [branchRows, setBranchRows] = useState<RecentShopRow[]>([]);
  const [collectionShopId, setCollectionShopId] = useState("");
  const [recipient, setRecipient] = useState("");
  const [recipientPhone, setRecipientPhone] = useState("");
  const [method, setMethod] = useState<FulfilmentMethod>("branch_collection");
  const [evidence, setEvidence] = useState("");
  const [handoverNote, setHandoverNote] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [savingHandover, setSavingHandover] = useState(false);

  // ---- cancel ----
  const [cancelFor, setCancelFor] = useState<OpenAssignment | null>(null);
  const [cancelReason, setCancelReason] = useState("");
  const [savingCancel, setSavingCancel] = useState(false);

  const load = useCallback(async (opts?: { silent?: boolean }) => {
    if (!opts?.silent) setLoading(true);
    const res = await fetchPrinterInventory();
    if (res.ok) {
      setInventory(res.data);
      setLoadError(null);
    } else {
      setLoadError(res.error);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!notice) return;
    const t = window.setTimeout(() => setNotice(null), 5000);
    return () => window.clearTimeout(t);
  }, [notice]);

  // Shop search for the account being claimed for.
  useEffect(() => {
    const q = shopQuery.trim();
    if (q.length < 2) {
      setShopRows([]);
      return;
    }
    let cancelled = false;
    setShopSearching(true);
    const timer = window.setTimeout(() => {
      void fetchInternalOpsSearchShops({ query: q, limit: 8 }).then((res) => {
        if (cancelled) return;
        setShopRows(res.rows);
        setShopSearching(false);
      });
    }, 300);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [shopQuery]);

  // Ask the server whether the selected account qualifies, before the operator
  // commits to a reservation. Debounced like the search it follows.
  useEffect(() => {
    if (!selectedShop) {
      setPreview(null);
      setPreviewError(null);
      return;
    }
    let cancelled = false;
    setPreviewing(true);
    setPreviewError(null);
    const timer = window.setTimeout(() => {
      void fetchPrinterEligibility({ shopId: selectedShop.id }).then((res) => {
        if (cancelled) return;
        setPreview(res.ok ? res.data : null);
        // A FAILED preview is surfaced, never swallowed into `null`. Silently
        // leaving no verdict on screen let an operator reserve blind.
        setPreviewError(res.ok ? null : res.error);
        setPreviewing(false);
      });
    }, 200);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [selectedShop]);

  // Branch search inside the handover dialog only.
  useEffect(() => {
    const q = branchSearch.trim();
    if (q.length < 2) {
      setBranchRows([]);
      return;
    }
    let cancelled = false;
    const timer = window.setTimeout(() => {
      void fetchInternalOpsSearchShops({ query: q, limit: 8 }).then((res) => {
        if (!cancelled) setBranchRows(res.rows);
      });
    }, 300);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [branchSearch]);

  const assignments = inventory?.openAssignments ?? [];
  const availableUnits = useMemo(
    () => (inventory?.units ?? []).filter((u) => u.status === "available"),
    [inventory],
  );

  const openHandover = useCallback(async (a: OpenAssignment) => {
    setHandoverFor(a);
    setConfirming(false);
    setRecipient("");
    setRecipientPhone("");
    setMethod("branch_collection");
    setEvidence("");
    setHandoverNote("");
    setBranchSearch("");
    setBranchRows([]);
    setCollectionShopId(a.shop_id ?? "");
    // The branch name arrives WITH the claim since 20261013110000, so the
    // dialog no longer has to resolve an id on its own.
    setBranchName(a.shop_name ?? null);
  }, []);

  const onAssign = async () => {
    if (!canAct || !selectedShop || assigning) return;
    // The same rule the button enforces, restated where the write actually
    // starts: with no verdict on screen there is nothing to reserve against.
    if (!preview || preview.can_reserve === false) return;
    setAssigning(true);
    setError(null);
    try {
      const res = await assignPrinter({ shopId: selectedShop.id });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setNotice(`Printer reserved for ${selectedShop.name}. Collect before the reservation lapses.`);
      setSelectedShop(null);
      setShopQuery("");
      await load({ silent: true });
    } finally {
      setAssigning(false);
    }
  };

  const onMarkReady = async (a: OpenAssignment) => {
    if (!canAct) return;
    setBusyId(a.assignment_id);
    setError(null);
    try {
      const res = await markAssignmentReady({ assignmentId: a.assignment_id, shopId: a.shop_id });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setNotice(`${a.serial_number} is marked ready for collection.`);
      await load({ silent: true });
    } finally {
      setBusyId(null);
    }
  };

  const onCancel = async () => {
    if (!canAct || !cancelFor || savingCancel) return;
    if (cancelReason.trim().length < 3) {
      setError("Give a reason of at least 3 characters. It is kept in the audit trail.");
      return;
    }
    setSavingCancel(true);
    setError(null);
    try {
      const res = await cancelPrinterAssignment({ assignmentId: cancelFor.assignment_id, reason: cancelReason });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setNotice(
        res.data.unit_released
          ? `Claim cancelled. ${cancelFor.serial_number} is back in the pool.`
          : "Claim cancelled.",
      );
      setCancelFor(null);
      setCancelReason("");
      await load({ silent: true });
    } finally {
      setSavingCancel(false);
    }
  };

  const onHandover = async () => {
    if (!canAct || !handoverFor || savingHandover) return;
    if (!collectionShopId) {
      setError("Choose the branch the customer is collecting from.");
      return;
    }
    if (!recipient.trim()) {
      setError("Enter the name of the person receiving the printer.");
      return;
    }
    setSavingHandover(true);
    setError(null);
    try {
      const res = await recordHandover({
        assignmentId: handoverFor.assignment_id,
        collectionShopId,
        receivedByName: recipient,
        fulfilmentMethod: method,
        receivedByPhone: recipientPhone,
        evidenceReference: evidence,
        note: handoverNote,
      });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setNotice(`${handoverFor.serial_number} handed over to ${recipient.trim()}.`);
      setHandoverFor(null);
      setConfirming(false);
      await load({ silent: true });
    } finally {
      setSavingHandover(false);
    }
  };

  return (
    <div className="space-y-4">
      {notice ? (
        <p className={statusTokens.success.banner} role="status">
          {notice}
        </p>
      ) : null}
      {error ? (
        <p className={statusTokens.danger.banner} role="alert">
          {error}
        </p>
      ) : null}

      {/* ----------------------------------------------------------- assign */}
      <div className={cardCls}>
        <h3 className="text-sm font-black text-foreground">Reserve a printer for an account</h3>
        <p className="mt-1 text-xs font-semibold text-muted-foreground">
          The server checks that the account holds an <strong>active Business subscription billed yearly</strong> with
          time left on it. Monthly plans, trials and promotional grants do not qualify. One printer per account per
          promotion.
        </p>

        {availableUnits.length === 0 && !loading ? (
          <p className="mt-3 text-xs font-bold text-muted-foreground">
            No printers are available to reserve. Register a unit on the Inventory tab first.
          </p>
        ) : null}

        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <div>
            <label className={labelCls} htmlFor="fulfilment-shop-search">
              Find the account's shop
            </label>
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <input
                id="fulfilment-shop-search"
                type="search"
                className={`${inputCls} pl-9`}
                placeholder="Shop name, number, email or ID"
                value={shopQuery}
                disabled={!canAct}
                onChange={(e) => {
                  setShopQuery(e.target.value);
                  setSelectedShop(null);
                }}
              />
            </div>
            {shopSearching ? (
              <p className="mt-1 text-xs font-semibold text-muted-foreground">Searching…</p>
            ) : null}
            {shopRows.length > 0 && !selectedShop ? (
              <ul className="mt-2 max-h-56 overflow-y-auto rounded-xl border border-border">
                {shopRows.map((row) => (
                  <li key={row.id}>
                    <button
                      type="button"
                      className="w-full px-3 py-2 text-left text-sm font-semibold hover:bg-muted"
                      onClick={() => {
                        setSelectedShop(row);
                        setShopQuery(`${row.name} (${row.shop_number ?? row.id.slice(0, 8)})`);
                      }}
                    >
                      {row.name}
                      <span className="text-muted-foreground"> · {row.shop_number ?? row.id.slice(0, 8)}</span>
                      {row.plan_code ? <span className="text-muted-foreground"> · {row.plan_code}</span> : null}
                      {row.trial_days_left !== null && row.trial_days_left !== undefined ? (
                        <span className="text-muted-foreground"> · trial {row.trial_days_left}d</span>
                      ) : null}
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>

          <div className="flex flex-col items-start gap-2">
            <button
              type="button"
              className={primaryBtnCls}
              onClick={() => void onAssign()}
              disabled={
                !canAct ||
                !selectedShop ||
                assigning ||
                previewing ||
                // NO VERDICT ON SCREEN, NO RESERVATION. `!preview` also covers a
                // preview call that failed, so the operator cannot commit before
                // the server has answered. The server stays the authority — this
                // only stops the form submitting ahead of it.
                !preview ||
                preview?.can_reserve === false
              }
            >
              {assigning ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              Reserve for this account
            </button>

            {/*
              The verdict is the server's, shown before the operator commits.
              `preview.eligible` is authoritative; `reason` only explains it. A
              refusal is stated plainly rather than discovered on submit.
            */}
            {selectedShop && previewing && !preview ? (
              <p className="text-xs font-semibold text-muted-foreground">Checking eligibility…</p>
            ) : null}
            {selectedShop && previewError && !previewing ? (
              <p className={statusTokens.danger.banner} role="alert">
                Eligibility could not be checked, so this printer cannot be reserved yet. {previewError}
              </p>
            ) : null}
            {preview ? (
              preview.eligible ? (
                <div className="space-y-1">
                  <p className={statusTokens.success.badge}>Eligible · {preview.plan_code} billed {preview.billing_interval}ly</p>
                  {preview.open_claim ? (
                    <p className="text-xs font-bold text-muted-foreground">
                      Already holds {preview.open_claim.serial_number} ({ASSIGNMENT_STATUS_LABELS[preview.open_claim.status] ?? preview.open_claim.status}).
                      One printer per account per promotion.
                    </p>
                  ) : null}
                </div>
              ) : (
                <div className="space-y-1">
                  <p className={statusTokens.danger.badge}>Not eligible</p>
                  <p className="max-w-sm text-xs font-bold text-muted-foreground">
                    {preview.reason ? (ELIGIBILITY_REASON_LABELS[preview.reason] ?? preview.reason) : "The account does not qualify."}
                    {preview.plan_code ? ` Currently on ${preview.plan_code}` : ""}
                    {preview.subscription_status ? ` (${preview.subscription_status}${preview.billing_interval ? `, ${preview.billing_interval}ly` : ""})` : ""}
                    .
                  </p>
                </div>
              )
            ) : null}
          </div>
        </div>

        {!canAct ? (
          <p className="mt-3 text-xs font-semibold text-muted-foreground">
            You can view fulfilment but not act on it. Reserving, ready-for-collection, handover and cancellation are
            limited to super admins, subscriptions admins and operations admins.
          </p>
        ) : null}
      </div>

      {/* ------------------------------------------------------ assignments */}
      <div className="flex flex-wrap items-center gap-3">
        <h3 className="text-sm font-black text-foreground">Open claims</h3>
        <button type="button" className={secondaryBtnCls} onClick={() => void load()} disabled={loading}>
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
          Refresh
        </button>
      </div>

      {loadError ? (
        <p className={statusTokens.danger.banner} role="alert">
          {loadError}
        </p>
      ) : null}

      <div className="overflow-x-auto">
        <table className="w-full min-w-[860px] text-left text-sm">
          <thead>
            <tr className="text-xs font-black uppercase tracking-wide text-muted-foreground">
              <th className="py-2">Serial</th>
              <th className="py-2">Status</th>
              <th className="py-2">Reservation</th>
              <th className="py-2">Account</th>
              <th className="py-2">Branch</th>
              <th className="py-2" />
            </tr>
          </thead>
          <tbody>
            {loading && assignments.length === 0 ? (
              <tr>
                <td colSpan={6} className="py-8 text-center text-sm font-semibold text-muted-foreground">
                  Loading claims…
                </td>
              </tr>
            ) : assignments.length === 0 ? (
              <tr>
                <td colSpan={6} className="py-8 text-center text-sm font-semibold text-muted-foreground">
                  No open claims. Reserved printers appear here until they are handed over or the reservation lapses.
                </td>
              </tr>
            ) : (
              assignments.map((a) => (
                <tr key={a.assignment_id} className="border-t border-border">
                  <td className="py-3 font-black tabular-nums text-foreground">{a.serial_number}</td>
                  <td className="py-3">
                    <span className={assignmentBadge(a.status)}>
                      {ASSIGNMENT_STATUS_LABELS[a.status] ?? a.status}
                    </span>
                  </td>
                  <td className="py-3">
                    <LeaseCell until={a.reserved_until} />
                  </td>
                  <td className="py-3 font-semibold text-muted-foreground">
                    {a.organization_name ?? <span className="font-mono text-xs">{a.organization_id.slice(0, 8)}</span>}
                  </td>
                  <td className="py-3 font-semibold text-muted-foreground">
                    {a.shop_name ?? (a.shop_id ? <span className="font-mono text-xs">{a.shop_id.slice(0, 8)}</span> : "—")}
                  </td>
                  <td className="py-3 text-right">
                    {canAct ? (
                      <div className="flex flex-wrap justify-end gap-2">
                        {a.status === "reserved" ? (
                          <button
                            type="button"
                            className={secondaryBtnCls}
                            disabled={busyId === a.assignment_id}
                            onClick={() => void onMarkReady(a)}
                          >
                            {busyId === a.assignment_id ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                            Ready
                          </button>
                        ) : null}
                        <button
                          type="button"
                          className={primaryBtnCls}
                          disabled={busyId === a.assignment_id}
                          onClick={() => void openHandover(a)}
                        >
                          <CheckCircle2 className="h-4 w-4" />
                          Record handover
                        </button>
                        <button
                          type="button"
                          className={dangerBtnCls}
                          onClick={() => {
                            setCancelFor(a);
                            setCancelReason("");
                          }}
                        >
                          <X className="h-4 w-4" />
                          Cancel
                        </button>
                      </div>
                    ) : null}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* --------------------------------------------------------- handover */}
      {handoverFor ? (
        <div className={cardCls}>
          <h3 className="text-sm font-black text-foreground">
            Hand over {handoverFor.serial_number}
          </h3>
          <p className="mt-1 text-xs font-semibold text-muted-foreground">
            Recorded once, at the counter: who received the printer, where, and how. A completed handover cannot be
            edited or cancelled.
          </p>

          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <label className={labelCls} htmlFor="handover-branch">
                Collection branch (must belong to the customer's account)
              </label>

              {/* Default: the branch recorded on the claim. */}
              {collectionShopId && !branchSearch ? (
                <div className="flex flex-wrap items-center gap-2">
                  <span className="rounded-xl bg-muted px-3 py-2.5 text-sm font-bold text-foreground">
                    {branchName ?? collectionShopId.slice(0, 8)}
                  </span>
                  <button
                    type="button"
                    className={secondaryBtnCls}
                    onClick={() => {
                      setBranchSearch(" ");
                      setCollectionShopId("");
                      setBranchName(null);
                    }}
                  >
                    Change branch
                  </button>
                </div>
              ) : (
                <>
                  <input
                    id="handover-branch"
                    type="search"
                    className={inputCls}
                    placeholder="Search the branch this customer collects from"
                    value={branchSearch.trim()}
                    onChange={(e) => setBranchSearch(e.target.value)}
                  />
                  {branchRows.length > 0 ? (
                    <ul className="mt-2 max-h-48 overflow-y-auto rounded-xl border border-border">
                      {branchRows.map((row) => (
                        <li key={row.id}>
                          <button
                            type="button"
                            className="w-full px-3 py-2 text-left text-sm font-semibold hover:bg-muted"
                            onClick={() => {
                              setCollectionShopId(row.id);
                              setBranchName(row.name);
                              setBranchSearch("");
                              setBranchRows([]);
                            }}
                          >
                            {row.name}
                            <span className="text-muted-foreground"> · {row.shop_number ?? row.id.slice(0, 8)}</span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                  <p className="mt-1 text-xs font-semibold text-muted-foreground">
                    The server refuses a branch that belongs to a different account.
                  </p>
                </>
              )}
            </div>

            <div>
              <label className={labelCls} htmlFor="handover-recipient">
                Received by (name)
              </label>
              <input
                id="handover-recipient"
                className={inputCls}
                value={recipient}
                onChange={(e) => setRecipient(e.target.value)}
              />
            </div>

            <div>
              <label className={labelCls} htmlFor="handover-phone">
                Contact number (optional)
              </label>
              <input
                id="handover-phone"
                className={inputCls}
                placeholder="+256…"
                value={recipientPhone}
                onChange={(e) => setRecipientPhone(e.target.value)}
              />
            </div>

            <div>
              <label className={labelCls} htmlFor="handover-method">
                How it is being handed over
              </label>
              <select
                id="handover-method"
                className={inputCls}
                value={method}
                onChange={(e) => setMethod(e.target.value as FulfilmentMethod)}
              >
                {FULFILMENT_METHODS.map((m) => (
                  <option key={m} value={m}>
                    {FULFILMENT_METHOD_LABELS[m]}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className={labelCls} htmlFor="handover-evidence">
                Evidence reference (optional)
              </label>
              <input
                id="handover-evidence"
                className={inputCls}
                placeholder="e.g. handover-photo-1042.jpg"
                value={evidence}
                onChange={(e) => setEvidence(e.target.value)}
              />
            </div>

            <div className="sm:col-span-2">
              <label className={labelCls} htmlFor="handover-note">
                Note (optional)
              </label>
              <input
                id="handover-note"
                className={inputCls}
                value={handoverNote}
                onChange={(e) => setHandoverNote(e.target.value)}
              />
            </div>
          </div>

          {/*
            WhatsApp is a real, separate contact channel — this does NOT mark the
            handover. Saying so plainly is the point: nothing here claims a
            message was sent, because nothing here sends one.
          */}
          {method === "whatsapp_request" ? (
            <div className="mt-4 rounded-xl bg-muted p-3">
              <p className="text-xs font-bold text-foreground">
                Arranged over WhatsApp. Opening the chat does not record anything — complete this form once the
                customer has the printer.
              </p>
              <a
                href={wakaSupportWhatsAppUrl(
                  `Hello DKASU, this is about the free WP-58 printer (serial ${handoverFor.serial_number}).`,
                )}
                target="_blank"
                rel="noreferrer"
                className="mt-2 inline-flex items-center gap-2 text-xs font-black text-waka-700 underline dark:text-waka-400"
              >
                <MessageCircle className="h-4 w-4" aria-hidden="true" />
                Open the DKASU support chat
              </a>
            </div>
          ) : null}

          {confirming ? (
            <div className="mt-4 rounded-xl border border-waka-500/40 bg-waka-50 p-3 dark:bg-waka-950/40">
              <p className="flex items-start gap-2 text-sm font-bold text-foreground">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-waka-600" aria-hidden="true" />
                Record {handoverFor.serial_number} as handed to {recipient.trim() || "(no name)"} at{" "}
                {branchName ?? collectionShopId.slice(0, 8)}?
                <br />
                This is final — a completed handover cannot be cancelled.
              </p>
            </div>
          ) : null}

          <div className="mt-4 flex flex-wrap gap-2">
            {confirming ? (
              <button
                type="button"
                className={primaryBtnCls}
                onClick={() => void onHandover()}
                disabled={savingHandover}
              >
                {savingHandover ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                Yes, record the handover
              </button>
            ) : (
              <button type="button" className={primaryBtnCls} onClick={() => setConfirming(true)}>
                Review and confirm
              </button>
            )}
            <button
              type="button"
              className={secondaryBtnCls}
              onClick={() => {
                setHandoverFor(null);
                setConfirming(false);
              }}
            >
              Back
            </button>
          </div>
        </div>
      ) : null}

      {/* ----------------------------------------------------------- cancel */}
      {cancelFor ? (
        <div className={cardCls}>
          <h3 className="text-sm font-black text-foreground">Cancel the claim on {cancelFor.serial_number}?</h3>
          <p className="mt-1 text-xs font-semibold text-muted-foreground">
            The printer returns to the pool only if it has not left the shop. The claim itself stays on the record as
            cancelled.
          </p>
          <div className="mt-3">
            <label className={labelCls} htmlFor="cancel-reason">
              Reason (required)
            </label>
            <input
              id="cancel-reason"
              className={inputCls}
              placeholder="e.g. customer withdrew"
              value={cancelReason}
              onChange={(e) => setCancelReason(e.target.value)}
            />
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            <button type="button" className={dangerBtnCls} onClick={() => void onCancel()} disabled={savingCancel}>
              {savingCancel ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              Cancel the claim
            </button>
            <button type="button" className={secondaryBtnCls} onClick={() => setCancelFor(null)}>
              Keep it
            </button>
          </div>
        </div>
      ) : null}

      {/* ------------------------------------------------ history pointer */}
      <div className="rounded-2xl border border-dashed border-border p-4">
        <h3 className="text-sm font-black text-foreground">Completed handovers</h3>
        <p className="mt-1 text-xs font-semibold leading-relaxed text-muted-foreground">
          Settled handovers are not mixed in with open claims. They live on the <strong>History</strong> tab, with the
          recipient, the branch and the time each printer changed hands.
        </p>
      </div>
    </div>
  );
}
