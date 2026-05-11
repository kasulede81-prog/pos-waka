import { useState } from "react";
import type { Language } from "../types";
import { t } from "../lib/i18n";
import { useSyncStatus } from "../hooks/useSyncStatus";
import { useOfflineStatus } from "../hooks/useOfflineStatus";

type Props = { lang: Language };

function fmtShort(iso: string | null, lang: Language): string {
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

export function SyncHealthCard({ lang }: Props) {
  const { isOnline } = useOfflineStatus();
  const sync = useSyncStatus();
  const [msg, setMsg] = useState<string | null>(null);
  const h = sync.health;

  const needsAttention = isOnline && (h.lastIssueCode === "error" || (h.lastIssueCode === "partial" && sync.pendingCount > 5));

  return (
    <article className="rounded-3xl border border-stone-200/90 bg-white p-5 shadow-waka-sm">
      <p className="text-xl font-black text-stone-900">{t(lang, "syncDiagnosticsTitle")}</p>
      <p className="mt-1 text-sm text-stone-600">{t(lang, "syncDiagnosticsSub")}</p>

      {needsAttention ? (
        <p className="mt-3 rounded-2xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm font-bold text-amber-950">
          {t(lang, "syncNeedsReview")}
        </p>
      ) : null}

      <dl className="mt-4 grid gap-3 text-sm">
        <div className="flex justify-between gap-2 rounded-2xl bg-stone-50 px-3 py-2">
          <dt className="font-semibold text-stone-600">{t(lang, "syncQueueLabel")}</dt>
          <dd className="font-black text-stone-900">{sync.pendingCount}</dd>
        </div>
        <div className="flex justify-between gap-2 rounded-2xl bg-stone-50 px-3 py-2">
          <dt className="font-semibold text-stone-600">{t(lang, "syncLastTry")}</dt>
          <dd className="text-right font-medium text-stone-800">{fmtShort(h.lastAttemptAt, lang)}</dd>
        </div>
        <div className="flex justify-between gap-2 rounded-2xl bg-stone-50 px-3 py-2">
          <dt className="font-semibold text-stone-600">{t(lang, "syncLastOk")}</dt>
          <dd className="text-right font-medium text-stone-800">{fmtShort(h.lastSuccessAt, lang)}</dd>
        </div>
      </dl>

      {msg ? <p className="mt-3 text-sm font-semibold text-waka-800">{msg}</p> : null}

      <button
        type="button"
        disabled={!isOnline || sync.syncing}
        onClick={async () => {
          setMsg(null);
          await sync.flush();
          setMsg(t(lang, "syncRetryDone"));
          window.setTimeout(() => setMsg(null), 4000);
        }}
        className="mt-4 w-full rounded-2xl bg-waka-600 py-3.5 text-base font-black text-white shadow-waka-sm transition-waka active:scale-[0.99] disabled:opacity-50 motion-reduce:active:scale-100"
      >
        {sync.syncing ? t(lang, "syncingShort") : t(lang, "syncRetryNow")}
      </button>
    </article>
  );
}
