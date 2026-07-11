import { useCallback, useEffect, useRef, useState } from "react";
import type { Language } from "../types";
import { t } from "../lib/i18n";
import { buildSyncHealthDashboardSnapshot, type SyncHealthDashboardSnapshot } from "../lib/syncHealthDashboard";

function fmt(iso: string | null, lang: Language): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString(lang === "lg" ? "lg-UG" : "en-UG", {
      day: "numeric",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return "—";
  }
}

function Row({ label, value, warn }: { label: string; value: string; warn?: boolean }) {
  return (
    <div className={`flex flex-wrap justify-between gap-2 rounded-xl px-3 py-2 ${warn ? "bg-amber-50" : "bg-muted"}`}>
      <dt className="font-semibold text-muted-foreground">{label}</dt>
      <dd className={`text-right font-black ${warn ? "text-amber-950" : "text-foreground"}`}>{value}</dd>
    </div>
  );
}

type Props = {
  lang: Language;
  /** When true, load snapshot only after user expands the section. */
  lazy?: boolean;
  defaultExpanded?: boolean;
};

export function SyncHealthDashboard({ lang, lazy = false, defaultExpanded = !lazy }: Props) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const [snap, setSnap] = useState<SyncHealthDashboardSnapshot | null>(null);
  const [busy, setBusy] = useState(false);
  const loadedRef = useRef(false);

  const refresh = useCallback(async () => {
    setBusy(true);
    try {
      setSnap(await buildSyncHealthDashboardSnapshot());
      loadedRef.current = true;
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    if (!expanded || (lazy && loadedRef.current)) return;
    void refresh();
  }, [expanded, lazy, refresh]);

  useEffect(() => {
    if (!expanded || lazy) return;
    const id = window.setInterval(() => void refresh(), 60_000);
    return () => window.clearInterval(id);
  }, [expanded, lazy, refresh]);

  const entityErrors = snap ? Object.entries(snap.entityPullErrors) : [];

  if (lazy && !expanded) {
    return (
      <section className="rounded-3xl border border-border bg-card p-5 shadow-waka-sm">
        <button
          type="button"
          onClick={() => setExpanded(true)}
          className="flex w-full items-center justify-between gap-3 text-left"
        >
          <div>
            <h2 className="text-lg font-black text-foreground">{t(lang, "syncDiagnosticsTitle")}</h2>
            <p className="mt-1 text-sm text-muted-foreground">Tap to load queue and pull diagnostics.</p>
          </div>
          <span className="text-xs font-black uppercase text-waka-700">{t(lang, "systemHealthSectionShow")}</span>
        </button>
      </section>
    );
  }

  return (
    <section className="rounded-3xl border border-border bg-card p-5 shadow-waka-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-black text-foreground">{t(lang, "syncDiagnosticsTitle")}</h2>
          <p className="mt-1 text-sm text-muted-foreground">Queue, inventory, audit, recovery, and pull diagnostics.</p>
        </div>
        <button
          type="button"
          disabled={busy}
          onClick={() => void refresh()}
          className="rounded-xl border border-border px-3 py-2 text-xs font-black text-foreground disabled:opacity-50"
        >
          {busy ? "…" : "Refresh"}
        </button>
      </div>

      {!snap ? (
        <p className="mt-4 text-sm text-muted-foreground">Loading…</p>
      ) : (
        <dl className="mt-4 space-y-2 text-sm">
          <Row label="Queue size" value={String(snap.queueSize)} warn={snap.queueSize > 0} />
          <Row label="Oldest pending" value={fmt(snap.oldestPendingAt, lang)} />
          <Row label="Failed operations" value={String(snap.failedOperations)} warn={snap.failedOperations > 0} />
          <Row
            label="Retry wait"
            value={snap.retryWaitMs != null ? `${Math.ceil(snap.retryWaitMs / 1000)}s` : "—"}
          />
          <Row label="Queue health" value={snap.queueHealth} warn={snap.queueHealth !== "healthy"} />
          <Row
            label="Inventory integrity"
            value={
              snap.inventoryIntegrityOk
                ? "OK"
                : `${snap.inventoryMismatchCount} mismatch(es) (${snap.inventoryIntegrityStatus})`
            }
            warn={snap.inventoryIntegrityStatus !== "healthy"}
          />
          {snap.inventoryMismatches.length > 0 ? (
            <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs">
              <p className="font-black uppercase text-amber-950">Inventory mismatches</p>
              <ul className="mt-1 space-y-1 font-medium text-amber-900">
                {snap.inventoryMismatches.slice(0, 5).map((m) => (
                  <li key={m.productId}>
                    {m.productName}: recorded {m.recordedStock}, expected {m.expectedFromMovements} (Δ{" "}
                    {m.delta > 0 ? "+" : ""}
                    {m.delta})
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          <Row label="Inventory conflicts (recent)" value={String(snap.inventoryConflictCount)} warn={snap.inventoryConflictCount > 0} />
          <Row label="Audit pending upload" value={String(snap.auditPendingOps)} warn={!snap.auditSyncOk} />
          <Row label="Recovery status" value={snap.recoveryStatus ?? "idle"} />
          <Row label="Bootstrap complete" value={snap.bootstrapComplete ? "yes" : "no"} warn={!snap.bootstrapComplete} />
          <Row label="Last successful pull" value={fmt(snap.lastSuccessfulPull, lang)} />
          <Row label="Last successful push" value={fmt(snap.lastSuccessfulPush, lang)} />
          <Row label="Last sync attempt" value={fmt(snap.lastSyncAttempt, lang)} />
          <Row label="Last issue" value={snap.lastIssueCode} warn={snap.lastIssueCode !== "none"} />
          <Row label="POS uploads attempted" value={String(snap.posPushAttempts)} />
          <Row label="POS uploads successful" value={String(snap.posPushSuccesses)} />
          <Row
            label="POS uploads failed"
            value={String(snap.posPushFailures)}
            warn={snap.posPushFailures > 0}
          />
          <Row label="Last POS upload" value={fmt(snap.lastPosPushAt, lang)} />
        </dl>
      )}

      {entityErrors.length > 0 ? (
        <div className="mt-4 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2">
          <p className="text-xs font-black uppercase text-rose-900">Partial pull errors</p>
          <ul className="mt-1 space-y-1 text-xs font-medium text-rose-800">
            {entityErrors.map(([entity, msg]) => (
              <li key={entity}>
                <span className="font-black">{entity}</span>: {msg}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}
