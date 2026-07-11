import { Link } from "react-router-dom";
import type { Language } from "../../types";
import { t } from "../../lib/i18n";
import type { OwnerInventoryExtended } from "../../lib/ownerCommandCenterBuilders";
import { HistoryListCard } from "../shared/HistoryListCard";

type Props = {
  lang: Language;
  inventory: OwnerInventoryExtended;
};

export function OwnerInventoryRiskSection({ lang, inventory }: Props) {
  return (
    <HistoryListCard isEmpty={false}>
      <div className="border-b border-border px-3 py-2.5 sm:px-4 sm:py-3">
        <h2 className="text-sm font-black text-foreground sm:text-base">{t(lang, "ownerInventoryRiskTitle")}</h2>
      </div>
      <div className="grid grid-cols-2 gap-2 p-3 sm:grid-cols-4 sm:p-4">
        <div className="rounded-xl bg-muted px-2.5 py-2">
          <p className="text-[10px] font-bold uppercase text-muted-foreground">{t(lang, "ownerInventoryValue")}</p>
          <p className="text-sm font-black tabular-nums">UGX {inventory.inventoryValueUgx.toLocaleString()}</p>
        </div>
        <div className={`rounded-xl px-2.5 py-2 ${inventory.negativeStock.length > 0 ? "bg-rose-50" : "bg-muted"}`}>
          <p className="text-[10px] font-bold uppercase text-muted-foreground">{t(lang, "ownerInventoryNegative")}</p>
          <p className="text-lg font-black tabular-nums">{inventory.negativeStock.length}</p>
        </div>
        <div className="rounded-xl bg-muted px-2.5 py-2">
          <p className="text-[10px] font-bold uppercase text-muted-foreground">{t(lang, "ownerInventoryOos")}</p>
          <p className="text-lg font-black tabular-nums">{inventory.outOfStockCount}</p>
        </div>
        <div className="rounded-xl bg-muted px-2.5 py-2">
          <p className="text-[10px] font-bold uppercase text-muted-foreground">{t(lang, "ownerInventoryLow")}</p>
          <p className="text-lg font-black tabular-nums">{inventory.lowStockCount}</p>
        </div>
        <div className="rounded-xl bg-muted px-2.5 py-2">
          <p className="text-[10px] font-bold uppercase text-muted-foreground">{t(lang, "ownerInventoryCountPending")}</p>
          <p className="text-lg font-black tabular-nums">{inventory.pendingCountSessions.length}</p>
        </div>
        <div className="rounded-xl bg-muted px-2.5 py-2">
          <p className="text-[10px] font-bold uppercase text-muted-foreground">{t(lang, "ownerInventoryCountVariance")}</p>
          <p className="text-sm font-black tabular-nums">UGX {inventory.countVarianceCostUgx.toLocaleString()}</p>
        </div>
        <div className="rounded-xl bg-muted px-2.5 py-2">
          <p className="text-[10px] font-bold uppercase text-muted-foreground">{t(lang, "ownerInventoryWriteOff")}</p>
          <p className="text-sm font-black tabular-nums">UGX {inventory.writeOffValueUgx.toLocaleString()}</p>
        </div>
      </div>

      {inventory.fastMovers.length > 0 ? (
        <div className="border-t border-border px-3 py-2 sm:px-4">
          <p className="text-[10px] font-black uppercase text-muted-foreground">{t(lang, "ownerInventoryFastMovers")}</p>
          <ul className="mt-1 text-[11px] font-semibold text-foreground">
            {inventory.fastMovers.map((m) => (
              <li key={m.productId}>{m.name}: {m.qty}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {inventory.slowMovers.length > 0 ? (
        <div className="border-t border-border px-3 py-2 sm:px-4">
          <p className="text-[10px] font-black uppercase text-muted-foreground">{t(lang, "ownerInventorySlowMovers")}</p>
          <ul className="mt-1 text-[11px] font-semibold text-muted-foreground">
            {inventory.slowMovers.map((m) => (
              <li key={m.productId}>{m.name}: {m.qty}</li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="border-t border-border p-3 sm:p-4">
        <Link
          to="/stock"
          className="inline-flex min-h-[40px] w-full items-center justify-center rounded-xl border border-border px-4 text-xs font-black text-foreground sm:text-sm"
        >
          {t(lang, "ownerInventoryViewStock")} →
        </Link>
      </div>
    </HistoryListCard>
  );
}
