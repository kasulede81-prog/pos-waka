import { useEffect, useState } from "react";
import type { Language } from "../../types";
import { t } from "../../lib/i18n";
import { fetchProductionMigrationHealth, type MigrationCheckResult } from "../../lib/migrationHealth";

export function SystemHealthCard({ lang }: { lang: Language }) {
  const [loading, setLoading] = useState(true);
  const [checks, setChecks] = useState<MigrationCheckResult[]>([]);
  const [allPass, setAllPass] = useState(false);
  const [offline, setOffline] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void fetchProductionMigrationHealth().then((report) => {
      if (cancelled) return;
      setChecks(report.checks);
      setAllPass(report.ok);
      setOffline(report.offline);
      setError(report.error ?? null);
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <article className="rounded-2xl border border-stone-200/90 bg-white p-4 shadow-sm">
      <p className="text-base font-black text-stone-900">{t(lang, "systemHealthTitle")}</p>
      <p className="mt-1 text-sm text-stone-600">{t(lang, "systemHealthSub")}</p>

      {loading ? (
        <p className="mt-3 text-sm font-semibold text-stone-500">{t(lang, "systemHealthLoading")}</p>
      ) : offline ? (
        <p className="mt-3 text-sm font-bold text-amber-900">{t(lang, "systemHealthOffline")}</p>
      ) : error ? (
        <p className="mt-3 text-sm font-bold text-red-800">{error}</p>
      ) : (
        <p
          className={`mt-3 rounded-xl px-3 py-2 text-sm font-bold ${
            allPass ? "border border-emerald-200 bg-emerald-50 text-emerald-950" : "border border-red-200 bg-red-50 text-red-950"
          }`}
        >
          {allPass ? t(lang, "systemHealthAllPass") : t(lang, "systemHealthSomeFail")}
        </p>
      )}

      <ul className="mt-3 space-y-2">
        {checks.map((c) => (
          <li
            key={c.id}
            className="flex items-start justify-between gap-2 rounded-xl bg-stone-50 px-3 py-2 text-sm"
          >
            <span className="font-mono font-bold text-stone-800">{c.id}</span>
            <span className={c.pass ? "font-black text-emerald-700" : "font-black text-red-700"}>
              {c.pass ? t(lang, "systemHealthPass") : t(lang, "systemHealthFail")}
            </span>
          </li>
        ))}
      </ul>
      {!loading && checks.length > 0 ? (
        <ul className="mt-2 space-y-1 text-xs font-medium text-stone-500">
          {checks.map((c) => (
            <li key={`${c.id}-detail`}>{c.detail}</li>
          ))}
        </ul>
      ) : null}
    </article>
  );
}
