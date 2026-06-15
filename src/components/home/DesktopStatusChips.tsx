import { Link } from "react-router-dom";
import type { Language } from "../../types";
import { t, tTemplate } from "../../lib/i18n";
import { useOwnerRiskCards } from "../../hooks/useOwnerRiskCards";
import { usePosStore } from "../../store/usePosStore";
import { isLowStock } from "../../lib/sellingEngine";
import { useSyncStatus } from "../../hooks/useSyncStatus";
import { countSalesWithSyncErrors } from "../../offline/cloudSync";
import { useMemo } from "react";
import { useSubscription } from "../../context/SubscriptionContext";
import { resolveEffectivePlanTier, maxProductsForTier } from "../../lib/subscriptionEntitlements";
import { lockedProductIds } from "../../lib/productPlanLock";
import { hasPermission } from "../../lib/permissions";
import { useSessionActor } from "../../context/SessionActorContext";

type Props = { lang: Language };

export function DesktopStatusChips({ lang }: Props) {
  const actor = useSessionActor();
  const { totalCount: riskCount } = useOwnerRiskCards(lang, false);
  const products = usePosStore((s) => s.products);
  const { snapshot } = useSubscription();
  const sync = useSyncStatus();
  const syncErrors = countSalesWithSyncErrors();
  const pending = sync.pendingCount;
  const synced = pending === 0 && syncErrors === 0;

  const tier = resolveEffectivePlanTier(snapshot);
  const productLimit = maxProductsForTier(tier);
  const lockedIds = useMemo(
    () => lockedProductIds(products, productLimit),
    [products, productLimit],
  );
  const unlockedProducts = useMemo(
    () => (productLimit === null ? products : products.filter((p) => !lockedIds.has(p.id))),
    [products, productLimit, lockedIds],
  );
  const lowStockCount = useMemo(
    () => unlockedProducts.filter((p) => isLowStock(p)).length,
    [unlockedProducts],
  );

  const showRisks = hasPermission(actor.role, "owner.activity") && riskCount > 0;
  const showLowStock = hasPermission(actor.role, "stock.view") && lowStockCount > 0;

  return (
    <div className="mb-3 flex flex-wrap items-center justify-center gap-2">
      {showRisks ? (
        <Link
          to="/office/audit-center"
          className="inline-flex min-h-[36px] items-center gap-2 rounded-full border border-rose-200 bg-rose-50 px-4 py-1.5 text-sm font-bold text-rose-900 transition-colors hover:bg-rose-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-400 focus-visible:ring-offset-2"
        >
          <span aria-hidden>🔴</span>
          {tTemplate(lang, "desktopHomeStatusRisks", { count: String(riskCount) })}
        </Link>
      ) : null}
      {showLowStock ? (
        <Link
          to="/stock"
          className="inline-flex min-h-[36px] items-center gap-2 rounded-full border border-amber-200 bg-amber-50 px-4 py-1.5 text-sm font-bold text-amber-950 transition-colors hover:bg-amber-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400 focus-visible:ring-offset-2"
        >
          <span aria-hidden>🟠</span>
          {tTemplate(lang, "desktopHomeStatusLowStock", { count: String(lowStockCount) })}
        </Link>
      ) : null}
      <Link
        to="/office/backup"
        className={`inline-flex min-h-[36px] items-center gap-2 rounded-full border px-4 py-1.5 text-sm font-bold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 ${
          synced
            ? "border-emerald-200 bg-emerald-50 text-emerald-900 hover:bg-emerald-100 focus-visible:ring-emerald-400"
            : "border-amber-200 bg-amber-50 text-amber-950 hover:bg-amber-100 focus-visible:ring-amber-400"
        }`}
      >
        <span aria-hidden>{synced ? "🟢" : "🟠"}</span>
        {synced ? t(lang, "desktopHomeStatusSynced") : t(lang, "desktopHomeStatusSyncPending")}
      </Link>
    </div>
  );
}
