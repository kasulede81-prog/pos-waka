import { Link } from "react-router-dom";
import type { Language } from "../../types";
import { t } from "../../lib/i18n";
import type { OwnerInventoryRiskSnapshot } from "../../lib/ownerCommandCenter";
import { HistoryListCard } from "../shared/HistoryListCard";

type Props = {
  lang: Language;
  inventory: OwnerInventoryRiskSnapshot;
};

export function OwnerInventoryRiskSection({ lang, inventory }: Props) {
  return (
    <HistoryListCard isEmpty={false}>
      <div className="border-b border-stone-100 px-4 py-3">
        <h2 className="text-base font-black text-slate-950">{t(lang, "ownerInventoryRiskTitle")}</h2>
      </div>
      <div className="grid grid-cols-2 gap-2 p-4 sm:grid-cols-4">
        <div className={`rounded-xl px-3 py-2 ${inventory.negativeStock.length > 0 ? "bg-rose-50" : "bg-stone-50"}`}>
          <p className="text-xs font-semibold text-stone-600">{t(lang, "ownerInventoryNegative")}</p>
          <p className="text-xl font-black tabular-nums text-stone-950">{inventory.negativeStock.length}</p>
        </div>
        <div className="rounded-xl bg-stone-50 px-3 py-2">
          <p className="text-xs font-semibold text-stone-600">{t(lang, "ownerInventoryOos")}</p>
          <p className="text-xl font-black tabular-nums text-stone-950">{inventory.outOfStockCount}</p>
        </div>
        <div className="rounded-xl bg-stone-50 px-3 py-2">
          <p className="text-xs font-semibold text-stone-600">{t(lang, "ownerInventoryLow")}</p>
          <p className="text-xl font-black tabular-nums text-stone-950">{inventory.lowStockCount}</p>
        </div>
        <div className="rounded-xl bg-stone-50 px-3 py-2">
          <p className="text-xs font-semibold text-stone-600">{t(lang, "ownerInventoryCountPending")}</p>
          <p className="text-xl font-black tabular-nums text-stone-950">{inventory.pendingCountSessions.length}</p>
        </div>
      </div>
      {inventory.expiringCount > 0 ? (
        <p className="border-t border-stone-100 px-4 py-2 text-sm font-bold text-amber-800">
          {t(lang, "ownerInventoryExpiring")}: {inventory.expiringCount}
        </p>
      ) : null}
      {inventory.topNegative.length > 0 ? (
        <ul className="border-t border-stone-100 px-4 py-2 text-xs font-semibold text-rose-900">
          {inventory.topNegative.map((p) => (
            <li key={p.id}>
              {p.name}: {p.stockOnHand}
            </li>
          ))}
        </ul>
      ) : null}
      <div className="border-t border-stone-100 p-4">
        <Link
          to="/stock"
          className="inline-flex min-h-[44px] w-full items-center justify-center rounded-2xl border-2 border-stone-200 px-4 text-sm font-black text-stone-900"
        >
          {t(lang, "ownerInventoryViewStock")} →
        </Link>
      </div>
    </HistoryListCard>
  );
}
