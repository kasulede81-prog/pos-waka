import { useEffect, useState } from "react";
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
    <div className={`flex flex-wrap justify-between gap-2 rounded-xl px-3 py-2 ${warn ? "bg-amber-50" : "bg-stone-50"}`}>
      <dt className="font-semibold text-stone-600">{label}</dt>
      <dd className={`text-right font-black ${warn ? "text-amber-950" : "text-stone-900"}`}>{value}</dd>
    </div>
  );
}

export function SyncHealthDashboard({ lang }: { lang: Language }) {
  const [snap, setSnap] = useState<SyncHealthDashboardSnapshot | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = async () => {
    setBusy(true);
    try {
      setSnap(await buildSyncHealthDashboardSnapshot());
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    void refresh();
    const id = window.setInterval(() => void refresh(), 30_000);
    return () => window.clearInterval(id);
  }, []);

  const entityErrors = snap ? Object.entries(snap.entityPullErrors) : [];

  return (
    <section className="rounded-3xl border border-stone-200 bg-white p-5 shadow-waka-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-black text-stone-950">{t(lang, "syncDiagnosticsTitle")}</h2>
          <p className="mt-1 text-sm text-stone-500">Queue, inventory, audit, recovery, and pull diagnostics.</p>
        </div>
        <button
          type="button"
          disabled={busy}
          onClick={() => void refresh()}
          className="rounded-xl border border-stone-300 px-3 py-2 text-xs font-black text-stone-800 disabled:opacity-50"
        >
          {busy ? "…" : "Refresh"}
        </button>
      </div>

      {!snap ? (
        <p className="mt-4 text-sm text-stone-500">Loading…</p>
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
            value={snap.inventoryIntegrityOk ? "OK" : `${snap.inventoryMismatchCount} mismatch(es)`}
            warn={!snap.inventoryIntegrityOk}
          />
          <Row label="Inventory conflicts (recent)" value={String(snap.inventoryConflictCount)} warn={snap.inventoryConflictCount > 0} />
          <Row label="Audit pending upload" value={String(snap.auditPendingOps)} warn={!snap.auditSyncOk} />
          <Row label="Recovery status" value={snap.recoveryStatus ?? "idle"} />
          <Row label="Bootstrap complete" value={snap.bootstrapComplete ? "yes" : "no"} warn={!snap.bootstrapComplete} />
          <Row label="Last successful pull" value={fmt(snap.lastSuccessfulPull, lang)} />
          <Row label="Last successful push" value={fmt(snap.lastSuccessfulPush, lang)} />
          <Row label="Last sync attempt" value={fmt(snap.lastSyncAttempt, lang)} />
          <Row label="Last issue" value={snap.lastIssueCode} warn={snap.lastIssueCode !== "none"} />
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
