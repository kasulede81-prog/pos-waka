import { useEffect, useState } from "react";
import type { Language } from "../../types";
import { t } from "../../lib/i18n";
import { fetchProductionMigrationHealth, type MigrationCheckResult } from "../../lib/migrationHealth";
import { usePosStore } from "../../store/usePosStore";
import { runProductionReadinessSelfTest } from "../../lib/productionReadiness";
import { useSystemHealthDiagnostics } from "./SystemHealthDiagnosticsProvider";

export function SystemHealthCard({ lang, lazy = false }: { lang: Language; lazy?: boolean }) {
  const [loading, setLoading] = useState(true);
  const [checks, setChecks] = useState<MigrationCheckResult[]>([]);
  const [allPass, setAllPass] = useState(false);
  const [offline, setOffline] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [certificationState, setCertificationState] = useState<"PASS" | "WARNING" | "FAIL" | null>(null);
  const customers = usePosStore((s) => s.customers);
  const sales = usePosStore((s) => s.sales);
  const debtPayments = usePosStore((s) => s.debtPayments);
  const products = usePosStore((s) => s.products);
  const stockMovements = usePosStore((s) => s.stockMovements);
  const auditLogs = usePosStore((s) => s.auditLogs);
  const { queue, refreshQueue } = useSystemHealthDiagnostics();

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

  useEffect(() => {
    if (lazy && !queue) return;
    let cancelled = false;
    void (async () => {
      const snap = queue ?? (await refreshQueue());
      const report = await runProductionReadinessSelfTest({
        customers,
        sales,
        debtPayments,
        products,
        stockMovements,
        auditLogs,
        syncQueue: snap.rawQueue,
      });
      if (cancelled) return;
      setCertificationState(report.certificationState);
    })().catch(() => {
      if (cancelled) return;
      setCertificationState("FAIL");
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- lazy: once per queue; non-lazy: store-driven
  }, lazy ? [queue?.checkedAt] : [customers, sales, debtPayments, products, stockMovements, auditLogs, queue?.checkedAt]);

  return (
    <article className="rounded-2xl border border-border/90 bg-card p-4 shadow-sm">
      <p className="text-base font-black text-foreground">{t(lang, "systemHealthTitle")}</p>
      <p className="mt-1 text-sm text-muted-foreground">{t(lang, "systemHealthSub")}</p>

      {loading ? (
        <p className="mt-3 text-sm font-semibold text-muted-foreground">{t(lang, "systemHealthLoading")}</p>
      ) : offline ? (
        <p className="mt-3 text-sm font-bold text-amber-900">{t(lang, "systemHealthOffline")}</p>
      ) : error ? (
        <p className="mt-3 text-sm font-bold text-red-800">{error}</p>
      ) : (
        <div
          className={`mt-3 rounded-xl px-3 py-2 text-sm font-bold ${
            allPass ? "border border-emerald-200 bg-emerald-50 text-emerald-950" : "border border-red-200 bg-red-50 text-red-950"
          }`}
        >
          <p>{allPass ? t(lang, "systemHealthAllPass") : t(lang, "systemHealthSomeFail")}</p>
          {certificationState ? (
            <p className="mt-1 text-xs font-black uppercase tracking-wide">
              {t(lang, "productionCertificationState").replace("{state}", certificationState)}
            </p>
          ) : null}
        </div>
      )}

      <ul className="mt-3 space-y-2">
        {checks.map((c) => (
          <li
            key={c.id}
            className="flex items-start justify-between gap-2 rounded-xl bg-muted px-3 py-2 text-sm"
          >
            <span className="font-mono font-bold text-foreground">{c.id}</span>
            <span className={c.pass ? "font-black text-emerald-700" : "font-black text-red-700"}>
              {c.pass ? t(lang, "systemHealthPass") : t(lang, "systemHealthFail")}
            </span>
          </li>
        ))}
      </ul>
      {!loading && checks.length > 0 ? (
        <ul className="mt-2 space-y-1 text-xs font-medium text-muted-foreground">
          {checks.map((c) => (
            <li key={`${c.id}-detail`}>{c.detail}</li>
          ))}
        </ul>
      ) : null}
    </article>
  );
}
