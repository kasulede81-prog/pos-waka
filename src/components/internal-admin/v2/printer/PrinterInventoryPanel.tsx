import { useCallback, useEffect, useMemo, useState } from "react";
import { Loader2, Plus, RefreshCw, Search, Undo2 } from "lucide-react";
import type { WakaInternalAdminRow } from "../../../../lib/wakaInternalAdmin";
import {
  PRINTER_CONDITIONS,
  PRINTER_STATUSES,
  PRINTER_STATUS_LABELS,
  type PrinterCondition,
  type PrinterInventory,
  type PrinterUnit,
  batchCodeFromSerial,
  fetchPrinterInventory,
  registerPrinterUnit,
  retirePrinterUnit,
  serialShapeError,
  updatePrinterUnit,
} from "../../../../lib/printerFulfilment";
import { statusTokens } from "../../../../lib/statusTokens";
import { adminPermissions } from "../adminRoles";

/**
 * The physical printer register.
 *
 * Stock actions are gated on `canManagePrinterStock`, which mirrors the server's
 * `_printer_require_stock_admin()` (`super_admin | operations_admin`) — a
 * subscriptions_admin can see the register but not write to it. Hiding the
 * controls is a courtesy; the server refuses regardless.
 *
 * Nothing here generates a serial. The operator types what is printed on the
 * label, and the batch code must agree with it.
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

function statusBadge(status: string) {
  if (status === "available") return statusTokens.success.badge;
  if (status === "reserved") return statusTokens.warning.badge;
  if (status === "assigned") return statusTokens.info.badge;
  return statusTokens.draft.badge;
}

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "—";
  return new Date(t).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

type Props = { adminRow: WakaInternalAdminRow | null; previewMode?: boolean };

export function PrinterInventoryPanel({ adminRow, previewMode = false }: Props) {
  const perms = adminPermissions(adminRow);
  const canEdit = perms.canManagePrinterStock && !previewMode;

  const [inventory, setInventory] = useState<PrinterInventory | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");

  // ---- register form ----
  const [showRegister, setShowRegister] = useState(false);
  const [serial, setSerial] = useState("");
  const [batchCode, setBatchCode] = useState("");
  const [notes, setNotes] = useState("");
  const [registering, setRegistering] = useState(false);
  const [serialError, setSerialError] = useState<string | null>(null);

  // ---- edit form ----
  const [editing, setEditing] = useState<PrinterUnit | null>(null);
  const [editCondition, setEditCondition] = useState<PrinterCondition>("new");
  const [editNotes, setEditNotes] = useState("");
  const [editReason, setEditReason] = useState("");
  const [savingEdit, setSavingEdit] = useState(false);

  const [retiring, setRetiring] = useState<PrinterUnit | null>(null);
  const [retireReason, setRetireReason] = useState("");
  const [savingRetire, setSavingRetire] = useState(false);

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

  // Memoised so the empty-array fallback does not change identity every render
  // and invalidate the filter below on every keystroke.
  const units = useMemo(() => inventory?.units ?? [], [inventory]);
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return units.filter((u) => {
      if (statusFilter !== "all" && u.status !== statusFilter) return false;
      if (!q) return true;
      return (
        u.serial_number.toLowerCase().includes(q) ||
        (u.batch_code ?? "").toLowerCase().includes(q) ||
        (u.notes ?? "").toLowerCase().includes(q)
      );
    });
  }, [units, query, statusFilter]);

  const counts = inventory?.counts ?? {};
  const countOf = (s: string) => counts[s as keyof typeof counts] ?? 0;

  const expectedBatch = batchCodeFromSerial(serial);

  const onRegister = async () => {
    if (!canEdit || registering) return;
    const shape = serialShapeError(serial);
    setSerialError(shape);
    if (shape) return;
    // The RPC is the authority; this only catches the obvious case early.
    if (expectedBatch && batchCode.trim() !== expectedBatch) {
      setSerialError(`The batch code must be ${expectedBatch} for serial ${serial.trim().toUpperCase()}.`);
      return;
    }

    setRegistering(true);
    setError(null);
    try {
      const res = await registerPrinterUnit({ serialNumber: serial, batchCode, notes });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setNotice(`Registered ${res.data.serial_number}.`);
      setSerial("");
      setBatchCode("");
      setNotes("");
      setShowRegister(false);
      await load({ silent: true });
    } finally {
      setRegistering(false);
    }
  };

  const onSaveEdit = async () => {
    if (!canEdit || !editing || savingEdit) return;
    if (editReason.trim().length < 3) {
      setError("Give a reason of at least 3 characters. It is kept in the audit trail.");
      return;
    }
    setSavingEdit(true);
    setError(null);
    try {
      const res = await updatePrinterUnit({
        unitId: editing.unit_id,
        reason: editReason,
        condition: editCondition,
        batchCode: editing.batch_code,
        heldAtShopId: editing.held_at_shop_id,
        notes: editNotes,
      });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setNotice(`Updated ${editing.serial_number}.`);
      setEditing(null);
      setEditReason("");
      await load({ silent: true });
    } finally {
      setSavingEdit(false);
    }
  };

  const onRetire = async () => {
    if (!canEdit || !retiring || savingRetire) return;
    if (retireReason.trim().length < 3) {
      setError("Give a reason of at least 3 characters. It is kept in the audit trail.");
      return;
    }
    setSavingRetire(true);
    setError(null);
    try {
      const res = await retirePrinterUnit({ unitId: retiring.unit_id, reason: retireReason });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      // The RPC answers `idempotent: true` when the unit was ALREADY retired —
      // e.g. another operator retired it after this list was loaded. Saying
      // "retired." then would claim this click caused something it did not.
      setNotice(
        res.data.idempotent
          ? `${retiring.serial_number} was already retired. Nothing changed.`
          : `${retiring.serial_number} retired.`,
      );
      setRetiring(null);
      setRetireReason("");
      await load({ silent: true });
    } finally {
      setSavingRetire(false);
    }
  };

  return (
    <div className="space-y-4">
      {/* ---------------------------------------------------------- counts */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        {PRINTER_STATUSES.map((s) => (
          <div key={s} className={cardCls}>
            <p className="text-xs font-black uppercase tracking-wide text-muted-foreground">
              {PRINTER_STATUS_LABELS[s]}
            </p>
            <p className="mt-1 text-2xl font-black tabular-nums text-foreground">
              {loading ? "…" : countOf(s)}
            </p>
          </div>
        ))}
      </div>

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

      {/* --------------------------------------------------------- toolbar */}
      <div className={`${cardCls} flex flex-wrap items-end gap-3`}>
        <div className="min-w-[220px] flex-1">
          <label className={labelCls} htmlFor="printer-search">
            Search
          </label>
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <input
              id="printer-search"
              type="search"
              className={`${inputCls} pl-9`}
              placeholder="Serial, batch or note"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
        </div>

        <div>
          <label className={labelCls} htmlFor="printer-status-filter">
            Status
          </label>
          <select
            id="printer-status-filter"
            className={inputCls}
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
          >
            <option value="all">All statuses</option>
            {PRINTER_STATUSES.map((s) => (
              <option key={s} value={s}>
                {PRINTER_STATUS_LABELS[s]}
              </option>
            ))}
          </select>
        </div>

        <button type="button" className={secondaryBtnCls} onClick={() => void load()} disabled={loading}>
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
          Refresh
        </button>

        {canEdit ? (
          <button type="button" className={primaryBtnCls} onClick={() => setShowRegister((v) => !v)}>
            <Plus className="h-4 w-4" />
            Register a printer
          </button>
        ) : null}
      </div>

      {/* -------------------------------------------------------- register */}
      {canEdit && showRegister ? (
        <div className={cardCls}>
          <h3 className="text-sm font-black text-foreground">Register a physical printer</h3>
          <p className="mt-1 text-xs font-semibold text-muted-foreground">
            Type the serial exactly as printed on the unit's label. Serial numbers are never generated, and a serial
            can only be registered once.
          </p>

          <div className="mt-4 grid gap-3 sm:grid-cols-3">
            <div>
              <label className={labelCls} htmlFor="printer-serial">
                Serial on the label
              </label>
              <input
                id="printer-serial"
                className={inputCls}
                placeholder="WP58-2609-001"
                value={serial}
                onChange={(e) => {
                  setSerial(e.target.value);
                  setSerialError(null);
                  const b = batchCodeFromSerial(e.target.value);
                  if (b) setBatchCode(b);
                }}
                aria-invalid={Boolean(serialError)}
              />
              {serialError ? (
                <p className="mt-1 text-xs font-bold text-danger" role="alert">
                  {serialError}
                </p>
              ) : (
                <p className="mt-1 text-xs font-semibold text-muted-foreground">
                  Uppercase letters, digits and hyphens.
                </p>
              )}
            </div>

            <div>
              <label className={labelCls} htmlFor="printer-batch">
                Batch code
              </label>
              <input
                id="printer-batch"
                className={inputCls}
                placeholder="2609"
                value={batchCode}
                onChange={(e) => setBatchCode(e.target.value)}
              />
              <p className="mt-1 text-xs font-semibold text-muted-foreground">
                {expectedBatch
                  ? `Must match the serial's batch segment (${expectedBatch}).`
                  : "Leave blank for a serial format we have not confirmed."}
              </p>
            </div>

            <div>
              <label className={labelCls} htmlFor="printer-notes">
                Notes (optional)
              </label>
              <input
                id="printer-notes"
                className={inputCls}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
              />
            </div>
          </div>

          <div className="mt-4 flex flex-wrap gap-2">
            <button type="button" className={primaryBtnCls} onClick={() => void onRegister()} disabled={registering}>
              {registering ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              Register printer
            </button>
            <button type="button" className={secondaryBtnCls} onClick={() => setShowRegister(false)}>
              Cancel
            </button>
          </div>
        </div>
      ) : null}

      {!canEdit ? (
        <p className="text-xs font-semibold text-muted-foreground">
          You can view the register but not change it. Registering, correcting and retiring stock is limited to super
          admins and operations admins.
        </p>
      ) : null}

      {/* ------------------------------------------------------------ list */}
      {loadError ? (
        <p className={statusTokens.danger.banner} role="alert">
          {loadError}
        </p>
      ) : null}

      <div className="overflow-x-auto">
        <table className="w-full min-w-[820px] text-left text-sm">
          <thead>
            <tr className="text-xs font-black uppercase tracking-wide text-muted-foreground">
              <th className="py-2">Serial</th>
              <th className="py-2">Batch</th>
              <th className="py-2">Condition</th>
              <th className="py-2">Status</th>
              <th className="py-2">Held at</th>
              <th className="py-2">Registered</th>
              <th className="py-2" />
            </tr>
          </thead>
          <tbody>
            {loading && units.length === 0 ? (
              <tr>
                <td colSpan={7} className="py-8 text-center text-sm font-semibold text-muted-foreground">
                  Loading the register…
                </td>
              </tr>
            ) : filtered.length === 0 ? (
              <tr>
                <td colSpan={7} className="py-8 text-center text-sm font-semibold text-muted-foreground">
                  {units.length === 0
                    ? "No printers registered yet. Register the first unit using the serial on its label."
                    : "No printers match that search or filter."}
                </td>
              </tr>
            ) : (
              filtered.map((u) => (
                <tr key={u.unit_id} className="border-t border-border">
                  <td className="py-3 font-black tabular-nums text-foreground">{u.serial_number}</td>
                  <td className="py-3 font-semibold text-muted-foreground">{u.batch_code ?? "—"}</td>
                  <td className="py-3 font-semibold capitalize text-muted-foreground">{u.condition}</td>
                  <td className="py-3">
                    <span className={statusBadge(u.status)}>
                      {PRINTER_STATUS_LABELS[u.status as keyof typeof PRINTER_STATUS_LABELS] ?? u.status}
                    </span>
                  </td>
                  <td className="py-3 font-mono text-xs text-muted-foreground">
                    {u.held_at_shop_id ? u.held_at_shop_id.slice(0, 8) : "—"}
                  </td>
                  <td className="py-3 font-semibold text-muted-foreground">{formatDate(u.created_at)}</td>
                  <td className="py-3 text-right">
                    {canEdit ? (
                      <div className="flex flex-wrap justify-end gap-2">
                        <button
                          type="button"
                          className={secondaryBtnCls}
                          disabled={u.status === "assigned"}
                          onClick={() => {
                            setEditing(u);
                            setEditCondition(
                              (PRINTER_CONDITIONS as readonly string[]).includes(u.condition)
                                ? (u.condition as PrinterCondition)
                                : "new",
                            );
                            setEditNotes(u.notes ?? "");
                            setEditReason("");
                          }}
                        >
                          Correct
                        </button>
                        <button
                          type="button"
                          className={dangerBtnCls}
                          disabled={u.status === "retired"}
                          onClick={() => {
                            setRetiring(u);
                            setRetireReason("");
                          }}
                        >
                          <Undo2 className="h-4 w-4" />
                          Retire
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

      {/* ------------------------------------------------------------ edit */}
      {editing ? (
        <div className={cardCls}>
          <h3 className="text-sm font-black text-foreground">
            Correct {editing.serial_number}
            <span className="ml-2 text-xs font-semibold text-muted-foreground">
              the serial itself cannot be changed
            </span>
          </h3>
          <div className="mt-4 grid gap-3 sm:grid-cols-3">
            <div>
              <label className={labelCls} htmlFor="edit-condition">
                Condition
              </label>
              <select
                id="edit-condition"
                className={inputCls}
                value={editCondition}
                onChange={(e) => setEditCondition(e.target.value as PrinterCondition)}
              >
                {PRINTER_CONDITIONS.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className={labelCls} htmlFor="edit-notes">
                Notes
              </label>
              <input
                id="edit-notes"
                className={inputCls}
                value={editNotes}
                onChange={(e) => setEditNotes(e.target.value)}
              />
            </div>
            <div>
              <label className={labelCls} htmlFor="edit-reason">
                Reason (required)
              </label>
              <input
                id="edit-reason"
                className={inputCls}
                value={editReason}
                onChange={(e) => setEditReason(e.target.value)}
              />
            </div>
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            <button type="button" className={primaryBtnCls} onClick={() => void onSaveEdit()} disabled={savingEdit}>
              {savingEdit ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              Save correction
            </button>
            <button type="button" className={secondaryBtnCls} onClick={() => setEditing(null)}>
              Cancel
            </button>
          </div>
        </div>
      ) : null}

      {/* ---------------------------------------------------------- retire */}
      {retiring ? (
        <div className={cardCls}>
          <h3 className="text-sm font-black text-foreground">Retire {retiring.serial_number}?</h3>
          <p className="mt-1 text-xs font-semibold text-muted-foreground">
            A retired printer leaves the pool and can never be issued again. This cannot be undone from this screen.
            A unit that is reserved or already handed over must be resolved first.
          </p>
          <div className="mt-3">
            <label className={labelCls} htmlFor="retire-reason">
              Reason (required)
            </label>
            <input
              id="retire-reason"
              className={inputCls}
              placeholder="e.g. screen cracked in transit"
              value={retireReason}
              onChange={(e) => setRetireReason(e.target.value)}
            />
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            <button type="button" className={dangerBtnCls} onClick={() => void onRetire()} disabled={savingRetire}>
              {savingRetire ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              Retire this printer
            </button>
            <button type="button" className={secondaryBtnCls} onClick={() => setRetiring(null)}>
              Keep it
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
