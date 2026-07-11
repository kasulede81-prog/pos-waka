import { useEffect, useState } from "react";
import { fetchCrashSummary, type CrashSummary } from "../../../lib/internalOpsHardening";
import { internalAdminShopHref } from "../../../lib/internalAdminPreview";
import { Link } from "react-router-dom";

type Props = { previewMode?: boolean };

export function AdminCrashSummaryPanel({ previewMode = false }: Props) {
  const [summary, setSummary] = useState<CrashSummary | null>(null);

  useEffect(() => {
    void fetchCrashSummary().then(setSummary);
  }, []);

  if (!summary) {
    return (
      <section className="rounded-2xl border border-border bg-card p-4 text-sm text-muted-foreground">
        Loading crash summary… (apply migration 079 for cloud crash log)
      </section>
    );
  }

  return (
    <section className="rounded-2xl border border-border bg-card p-4 shadow-sm">
      <h2 className="text-sm font-black text-foreground">Crash monitoring</h2>
      <p className="mt-0.5 text-xs text-muted-foreground">Read-only · complements Sentry · from app reports.</p>
      <p className="mt-2 font-mono text-2xl font-black text-foreground">{summary.crashes_today}</p>
      <p className="text-xs font-semibold text-muted-foreground">Crashes today (Kampala)</p>

      {summary.by_version.length > 0 ? (
        <div className="mt-3">
          <p className="text-xs font-black text-muted-foreground">By version</p>
          <ul className="mt-1 space-y-1 text-xs">
            {summary.by_version.map((v) => (
              <li key={v.version} className="flex justify-between rounded-lg bg-muted px-2 py-1">
                <span>{v.version}</span>
                <span className="font-black">{v.count}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {summary.by_shop.length > 0 ? (
        <div className="mt-3">
          <p className="text-xs font-black text-muted-foreground">Affected shops</p>
          <ul className="mt-1 space-y-1 text-xs">
            {summary.by_shop.map((s) => (
              <li key={s.shop_id} className="flex justify-between gap-2 rounded-lg bg-muted px-2 py-1">
                <Link to={internalAdminShopHref(s.shop_id, previewMode)} className="truncate font-semibold text-waka-700 underline">
                  {s.shop_name}
                </Link>
                <span className="shrink-0 font-black">{s.count}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}
