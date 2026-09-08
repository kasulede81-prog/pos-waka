import { useCallback, useEffect, useState } from "react";
import { ClipboardCopy } from "lucide-react";
import type { Language } from "../types";
import { t } from "../lib/i18n";
import { useSessionActor } from "../context/SessionActorContext";
import { authOperatorRole } from "../lib/sessionActor";
import { canTogglePilotMode } from "../lib/pilotMode";
import {
  formatSyncForensicExport,
  getSyncForensicSnapshot,
  type SyncForensicSnapshot,
} from "../lib/syncForensicSnapshot";

type Props = { lang: Language };

function flag(on: boolean): string {
  return on ? "yes" : "no";
}

export function SyncForensicSnapshotCard({ lang }: Props) {
  const actor = useSessionActor();
  const role = authOperatorRole(actor);
  const allowed = role === "owner" || canTogglePilotMode(role);
  const [snap, setSnap] = useState<SyncForensicSnapshot | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      setSnap(await getSyncForensicSnapshot());
    } catch {
      setError(t(lang, "syncForensicLoadFail"));
    } finally {
      setBusy(false);
    }
  }, [lang]);

  useEffect(() => {
    if (!allowed) return;
    void load();
  }, [allowed, load]);

  if (!allowed) return null;

  const copy = async () => {
    if (!snap) return;
    const body = formatSyncForensicExport(snap);
    try {
      await navigator.clipboard.writeText(body);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      window.prompt(t(lang, "syncForensicCopy"), body);
    }
  };

  const blocker = snap?.blocker;

  return (
    <section className="rounded-2xl border border-slate-300 bg-slate-50 p-4 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-black uppercase tracking-wide text-slate-600">
            {t(lang, "syncForensicKicker")}
          </p>
          <h2 className="mt-1 text-lg font-black text-foreground">{t(lang, "syncForensicTitle")}</h2>
          <p className="mt-1 text-sm text-muted-foreground">{t(lang, "syncForensicSub")}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={() => void load()}
            className="rounded-xl border border-border bg-card px-3 py-2 text-xs font-black text-foreground disabled:opacity-50"
          >
            {busy ? "…" : t(lang, "syncForensicRefresh")}
          </button>
          <button
            type="button"
            disabled={!snap}
            onClick={() => void copy()}
            className="inline-flex items-center gap-1 rounded-xl bg-slate-800 px-3 py-2 text-xs font-black text-white disabled:opacity-50"
          >
            <ClipboardCopy className="h-3.5 w-3.5" aria-hidden />
            {copied ? t(lang, "syncForensicCopied") : t(lang, "syncForensicCopy")}
          </button>
        </div>
      </div>

      {error ? <p className="mt-3 text-sm font-semibold text-rose-800">{error}</p> : null}

      {!snap && !error ? (
        <p className="mt-3 text-sm text-muted-foreground">{t(lang, "syncForensicLoading")}</p>
      ) : null}

      {snap ? (
        <div className="mt-4 space-y-3 text-sm">
          <dl className="grid gap-2 sm:grid-cols-2">
            <div className="rounded-xl bg-card px-3 py-2">
              <dt className="text-xs font-bold uppercase text-muted-foreground">Queue health</dt>
              <dd className="font-black text-foreground">{snap.queue.queueHealth}</dd>
            </div>
            <div className="rounded-xl bg-card px-3 py-2">
              <dt className="text-xs font-bold uppercase text-muted-foreground">Counts</dt>
              <dd className="font-semibold text-foreground">
                total {snap.queue.total} · ready {snap.queue.ready} · backoff {snap.queue.backingOff} ·
                parked {snap.queue.parkedClosedDate} · blocked {snap.queue.blockedBusiness}
              </dd>
            </div>
          </dl>

          <div className="rounded-xl border border-border bg-card px-3 py-2 font-mono text-xs">
            <p className="font-black uppercase text-slate-700">Flags</p>
            <p className="mt-1 text-foreground">
              ready={flag(snap.queue.queueHasReadyWork)} backoff={flag(snap.queue.queueHasBackoff)}{" "}
              closedDatePark={flag(snap.queue.queueHasClosedDatePark)} blockedBusiness=
              {flag(snap.queue.queueHasBlockedBusiness)} malformed=
              {flag(snap.queue.queueHasMalformedRows)} shopMismatch={flag(snap.queue.queueHasShopMismatch)}{" "}
              missingShop={flag(snap.queue.queueHasMissingShop)} unknownKind=
              {flag(snap.queue.queueHasUnknownKind)}
            </p>
          </div>

          {blocker ? (
            <div className="rounded-xl border border-amber-300 bg-amber-50 px-3 py-2">
              <p className="text-xs font-black uppercase text-amber-950">BLOCKER</p>
              <p className="mt-1 font-mono text-xs text-amber-950">
                {blocker.id} · {blocker.kind} · {blocker.classification} · attempts={blocker.attempts}
              </p>
              <p className="mt-1 font-mono text-xs text-amber-900">
                lastError={blocker.lastError ?? "—"} · retryAt={blocker.retryAt ?? "—"} · closedDate=
                {blocker.closedDateKey ?? "—"}
              </p>
              <p className="mt-1 font-mono text-xs text-amber-900">
                shopPresent={flag(blocker.shopIdPresent)} shopMatches={flag(blocker.shopMatchesActive)}{" "}
                createdAt={blocker.createdAt}
              </p>
            </div>
          ) : (
            <p className="text-sm font-semibold text-muted-foreground">{t(lang, "syncForensicEmpty")}</p>
          )}

          {snap.rows.length > 0 ? (
            <div className="overflow-x-auto rounded-xl border border-border bg-card">
              <table className="min-w-full text-left text-xs">
                <thead className="bg-muted text-[10px] font-black uppercase text-muted-foreground">
                  <tr>
                    <th className="px-2 py-2">id</th>
                    <th className="px-2 py-2">kind</th>
                    <th className="px-2 py-2">class</th>
                    <th className="px-2 py-2">attempts</th>
                    <th className="px-2 py-2">retry</th>
                    <th className="px-2 py-2">payload</th>
                  </tr>
                </thead>
                <tbody>
                  {snap.rows.map((row) => (
                    <tr key={row.id || `${row.kind}-${row.createdAt}`} className="border-t border-border">
                      <td className="max-w-[9rem] truncate px-2 py-1.5 font-mono">{row.id}</td>
                      <td className="px-2 py-1.5">{row.kind}</td>
                      <td className="px-2 py-1.5 font-black">{row.classification}</td>
                      <td className="px-2 py-1.5">{row.attempts}</td>
                      <td className="px-2 py-1.5">{row.retryEligible ? "yes" : "no"}</td>
                      <td className="px-2 py-1.5">{row.payloadClass}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
