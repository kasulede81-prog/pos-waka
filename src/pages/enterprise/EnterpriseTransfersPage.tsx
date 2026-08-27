import { Link } from "react-router-dom";
import { useCallback, useEffect, useState } from "react";
import { ArrowLeftRight } from "lucide-react";
import type { Language } from "../../types";
import { t } from "../../lib/i18n";
import { EnterpriseShell } from "../../components/enterprise/EnterpriseShell";
import { getActiveShopId } from "../../offline/shopScope";
import { listTransfersForShopCloud, type CloudTransfer } from "../../lib/enterprise/stockTransferSync";
import { usePosStore } from "../../store/usePosStore";

export function EnterpriseTransfersPage({ lang }: { lang: Language }) {
  const activeShopId = getActiveShopId();
  const shopLabel = usePosStore((s) => s.preferences.shopDisplayName?.trim()) || "Active branch";
  const [inTransit, setInTransit] = useState<CloudTransfer[]>([]);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    if (!activeShopId) {
      setInTransit([]);
      return;
    }
    setLoading(true);
    const rows = await listTransfersForShopCloud(activeShopId, "in_transit");
    setInTransit(rows);
    setLoading(false);
  }, [activeShopId]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <EnterpriseShell lang={lang} title={t(lang, "enterpriseNav_transfers")} subtitle={t(lang, "enterpriseTransfersSub")}>
      <section className="rounded-2xl border border-border bg-card p-5 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-sm font-black text-foreground">{t(lang, "xferPageTitle")}</p>
            <p className="mt-1 text-sm font-semibold text-muted-foreground">
              {lang === "lg" ? `Edduuka eririwo: ${shopLabel}` : `Active branch: ${shopLabel}`}
            </p>
            <p className="mt-2 text-sm text-muted-foreground">
              {lang === "lg"
                ? "Kozesa transfer workspace okusengula sitoka wakati w'amaduuka."
                : "Use the transfer workspace to move stock between branches. Cloud RPCs remain the authority."}
            </p>
          </div>
          <Link
            to="/stock/transfer"
            className="inline-flex min-h-[48px] items-center gap-2 rounded-2xl bg-waka-600 px-5 text-sm font-black text-white"
          >
            <ArrowLeftRight className="h-4 w-4" aria-hidden />
            {lang === "lg" ? "Ggulawo transfer" : "Open transfer workspace"}
          </Link>
        </div>
      </section>

      <section className="mt-4 rounded-2xl border border-border bg-card p-5 shadow-sm">
        <p className="text-sm font-black uppercase tracking-wide text-muted-foreground">
          {lang === "lg" ? "Mu nkola" : "In transit"}
        </p>
        {loading ? (
          <p className="mt-3 text-sm text-muted-foreground">{lang === "lg" ? "Okukola…" : "Loading…"}</p>
        ) : inTransit.length === 0 ? (
          <p className="mt-3 text-sm text-muted-foreground">
            {lang === "lg" ? "Tewali transfer eri mu nkola ku dduuka lino." : "No in-transit transfers for this branch."}
          </p>
        ) : (
          <ul className="mt-3 space-y-2">
            {inTransit.map((tr) => (
              <li key={tr.id} className="rounded-xl border border-border/60 px-4 py-3 text-sm">
                <p className="font-black text-foreground">{tr.id.slice(0, 8)}… · {tr.status}</p>
                <p className="mt-1 font-semibold text-muted-foreground">
                  {tr.lines.length} {lang === "lg" ? "layini" : "lines"} ·{" "}
                  {lang === "lg" ? "Okuva" : "From"} {tr.fromShopId.slice(0, 8)}… → {tr.toShopId.slice(0, 8)}…
                </p>
              </li>
            ))}
          </ul>
        )}
        <Link to="/stock/transfer" className="mt-4 inline-flex text-sm font-black text-waka-700 underline-offset-2 hover:underline">
          {lang === "lg" ? "Genda ku receive / dispatch →" : "Go to receive / dispatch →"}
        </Link>
      </section>
    </EnterpriseShell>
  );
}
