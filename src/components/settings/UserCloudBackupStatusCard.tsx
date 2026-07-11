import { useEffect, useState } from "react";
import type { Language } from "../../types";
import { t } from "../../lib/i18n";
import { fetchProductionMigrationHealth } from "../../lib/migrationHealth";

export function UserCloudBackupStatusCard({ lang }: { lang: Language }) {
  const [loading, setLoading] = useState(true);
  const [ok, setOk] = useState<boolean | null>(null);
  const [offline, setOffline] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void fetchProductionMigrationHealth().then((report) => {
      if (cancelled) return;
      setOk(report.ok);
      setOffline(report.offline);
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <article className="rounded-2xl border border-border/90 bg-card p-4 shadow-sm">
      <p className="text-base font-black text-foreground">{t(lang, "userCloudBackupTitle")}</p>
      <p className="mt-1 text-sm text-muted-foreground">{t(lang, "userCloudBackupSub")}</p>
      {loading ? (
        <p className="mt-3 text-sm font-semibold text-muted-foreground">{t(lang, "systemHealthLoading")}</p>
      ) : offline ? (
        <p className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm font-bold text-amber-950">
          {t(lang, "userCloudBackupOffline")}
        </p>
      ) : ok ? (
        <p className="mt-3 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm font-bold text-emerald-950">
          {t(lang, "userCloudBackupOk")}
        </p>
      ) : (
        <p className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm font-bold text-amber-950">
          {t(lang, "userCloudBackupNeedsAttention")}
        </p>
      )}
    </article>
  );
}
