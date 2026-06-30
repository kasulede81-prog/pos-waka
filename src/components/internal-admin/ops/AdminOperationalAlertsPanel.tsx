import { useEffect, useState } from "react";
import { fetchOperationalAlerts, type OperationalAlert } from "../../../lib/internalOpsHardening";
import { internalAdminShopHref } from "../../../lib/internalAdminPreview";
import { Link } from "react-router-dom";

type Props = { previewMode?: boolean };

const SEV_CLS: Record<string, string> = {
  high: "border-rose-200 bg-rose-50",
  medium: "border-amber-200 bg-amber-50",
  low: "border-stone-200 bg-stone-50",
};

export function AdminOperationalAlertsPanel({ previewMode = false }: Props) {
  const [alerts, setAlerts] = useState<OperationalAlert[]>([]);

  useEffect(() => {
    void fetchOperationalAlerts().then(setAlerts);
    const id = window.setInterval(() => void fetchOperationalAlerts().then(setAlerts), 60_000);
    return () => window.clearInterval(id);
  }, []);

  return (
    <section className="rounded-2xl border border-waka-200 bg-waka-50/40 p-4">
      <h2 className="text-sm font-black text-stone-900">Operational alerts</h2>
      <p className="mt-0.5 text-xs text-stone-600">Pilot cohort · auto-refreshes every 60s</p>
      <ul className="mt-3 max-h-64 space-y-2 overflow-y-auto">
        {alerts.length === 0 ? (
          <li className="text-sm font-semibold text-stone-600">No active alerts.</li>
        ) : (
          alerts.map((a, i) => (
            <li
              key={`${a.kind}-${a.shop_id ?? "global"}-${i}`}
              className={`rounded-xl border px-3 py-2 text-xs ${SEV_CLS[a.severity] ?? SEV_CLS.low}`}
            >
              <p className="font-black uppercase text-stone-700">{a.kind.replace(/_/g, " ")}</p>
              <p className="mt-0.5 font-semibold text-stone-900">{a.message}</p>
              {a.shop_id ? (
                <Link
                  to={internalAdminShopHref(a.shop_id, previewMode)}
                  className="mt-1 inline-block font-black text-waka-700 underline"
                >
                  {a.shop_name ?? "Open shop"}
                </Link>
              ) : null}
            </li>
          ))
        )}
      </ul>
    </section>
  );
}
