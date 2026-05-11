import { useMemo } from "react";
import { Link } from "react-router-dom";
import type { Language } from "../types";
import { t } from "../lib/i18n";
import { usePosStore } from "../store/usePosStore";
import { buildGroupedActivityTimeline } from "../lib/activityNarrative";

const PAGE = 120;

export function StaffActivityPage({ lang }: { lang: Language }) {
  const auditLogs = usePosStore((s) => s.auditLogs);
  const products = usePosStore((s) => s.products);
  const customers = usePosStore((s) => s.customers);

  const productById = useMemo(() => new Map(products.map((p) => [p.id, p])), [products]);
  const customerById = useMemo(() => new Map(customers.map((c) => [c.id, c])), [customers]);

  const trimmed = useMemo(() => auditLogs.slice(0, PAGE), [auditLogs]);

  const groups = useMemo(
    () => buildGroupedActivityTimeline(lang, trimmed, productById, customerById, { maxGroups: 20 }),
    [lang, trimmed, productById, customerById],
  );

  const sections = useMemo(() => {
    const order: Array<typeof groups[number]["bucketKey"]> = ["lastHour", "todayEarlier", "older"];
    const map = new Map<string, typeof groups>();
    for (const g of groups) {
      const cur = map.get(g.bucketKey) ?? [];
      cur.push(g);
      map.set(g.bucketKey, cur);
    }
    return order.flatMap((k) => {
      const rows = map.get(k);
      return rows?.length ? [{ key: k, label: rows[0]!.bucketLabel, rows }] : [];
    });
  }, [groups]);

  return (
    <div className="space-y-6 pb-12">
      <Link to="/owner" className="inline-block text-sm font-bold text-waka-700">
        ← {t(lang, "ownerDashboardTitle")}
      </Link>
      <div>
        <h1 className="text-3xl font-black text-slate-900">{t(lang, "staffActivityTitle")}</h1>
        <p className="mt-1 text-slate-600">{t(lang, "staffActivitySub")}</p>
      </div>

      {groups.length === 0 ? (
        <p className="rounded-[1.5rem] border border-slate-200 bg-white p-6 text-slate-600">{t(lang, "staffActivityEmpty")}</p>
      ) : (
        <div className="space-y-8">
          {sections.map((sec) => (
            <section key={sec.key}>
              <h2 className="text-xs font-black uppercase tracking-widest text-slate-500">{sec.label}</h2>
              <ul className="mt-3 space-y-3">
                {sec.rows.map((g) => (
                  <li
                    key={g.id}
                    className="rounded-[1.25rem] border border-slate-100 bg-white p-4 shadow-sm ring-1 ring-slate-100/80"
                  >
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <p className="font-black text-slate-900">{g.actorLabel}</p>
                      <time className="text-xs font-semibold text-slate-500" dateTime={g.at}>
                        {new Date(g.at).toLocaleString([], {
                          month: "short",
                          day: "numeric",
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </time>
                    </div>
                    <ul className="mt-2 space-y-1.5 text-sm font-medium text-slate-800">
                      {g.lines.map((line, i) => (
                        <li key={i} className="flex gap-2">
                          <span className="text-waka-600">·</span>
                          <span>{line}</span>
                        </li>
                      ))}
                    </ul>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
