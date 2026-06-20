import { useMemo, useState } from "react";
import type { Language } from "../types";
import { t } from "../lib/i18n";
import { PageBackBar } from "../components/layout/PageBackBar";
import {
  acknowledgeSyncConflict,
  clearAcknowledgedSyncConflicts,
  listSyncConflicts,
  type SyncConflictEntry,
} from "../lib/syncConflictLog";

type Props = { lang: Language };

function domainLabel(lang: Language, domain: SyncConflictEntry["domain"]): string {
  const key = `syncConflictDomain_${domain}` as const;
  return t(lang, key);
}

export function SyncConflictCenterPage({ lang }: Props) {
  const [refreshKey, setRefreshKey] = useState(0);
  const conflicts = useMemo(() => listSyncConflicts(), [refreshKey]);

  const handleAck = (id: string) => {
    acknowledgeSyncConflict(id);
    setRefreshKey((k) => k + 1);
  };

  const handleClear = () => {
    clearAcknowledgedSyncConflicts();
    setRefreshKey((k) => k + 1);
  };

  return (
    <div className="space-y-6 pb-8">
      <PageBackBar lang={lang} fallbackTo="/settings/health" label={t(lang, "systemHealthPageTitle")} />
      <div>
        <h1 className="text-2xl font-black text-stone-950">{t(lang, "syncConflictCenterTitle")}</h1>
        <p className="mt-1 text-sm font-medium text-stone-500">{t(lang, "syncConflictCenterSub")}</p>
      </div>

      {conflicts.length === 0 ? (
        <p className="rounded-2xl border border-stone-200 bg-white p-4 text-sm font-medium text-stone-600">
          {t(lang, "syncConflictCenterEmpty")}
        </p>
      ) : (
        <ul className="space-y-3">
          {conflicts.map((row) => (
            <li key={row.id} className="rounded-2xl border border-stone-200 bg-white p-4 shadow-sm">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <p className="text-xs font-bold uppercase tracking-wide text-stone-500">
                    {domainLabel(lang, row.domain)}
                  </p>
                  <p className="mt-1 text-sm font-bold text-stone-900">{row.summary}</p>
                  <p className="mt-1 text-xs font-medium text-stone-500">
                    {new Date(row.at).toLocaleString()} · {row.resolution}
                  </p>
                </div>
                {!row.acknowledged ? (
                  <button
                    type="button"
                    onClick={() => handleAck(row.id)}
                    className="min-h-[40px] rounded-xl bg-stone-900 px-4 text-sm font-bold text-white"
                  >
                    {t(lang, "syncConflictAcknowledge")}
                  </button>
                ) : (
                  <span className="rounded-full bg-stone-100 px-2 py-0.5 text-xs font-bold text-stone-600">
                    {t(lang, "syncConflictAcknowledged")}
                  </span>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      <button
        type="button"
        onClick={handleClear}
        className="text-sm font-bold text-stone-500 underline"
      >
        {t(lang, "syncConflictClearAcknowledged")}
      </button>
    </div>
  );
}
