import { Link } from "react-router-dom";
import { actorHasEffectivePermission } from "../../lib/actorAuthorization";
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
import { useSessionActor } from "../../context/SessionActorContext";

type Props = { lang: Language };

export function DesktopStatusChips({ lang }: Props) {
  const actor = useSessionActor();
  const { snapshot, authMode } = useSubscription();
  const { unseenCount: riskCount } = useOwnerRiskCards(lang, false);
  const products = usePosStore((s) => s.products);
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

  const showRisks =
    actorHasEffectivePermission(actor, "owner.activity", snapshot, authMode) && riskCount > 0;
  const showLowStock =
    actorHasEffectivePermission(actor, "stock.view", snapshot, authMode) && lowStockCount > 0;

  const chipClass =
    "inline-flex min-h-[40px] touch-manipulation items-center gap-2 rounded-full border px-4 py-2 text-sm font-bold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-waka-500 focus-visible:ring-offset-2 focus-visible:ring-offset-white";

  return (
    <div className="mb-3 flex flex-wrap items-center justify-center gap-2">
      {showRisks ? (
        <Link
          to="/office/audit-center"
          className={`${chipClass} border-rose-200 bg-white text-rose-800 shadow-sm hover:border-rose-300 hover:bg-rose-50`}
        >
          <span aria-hidden>🔴</span>
          {tTemplate(lang, "desktopHomeStatusRisks", { count: String(riskCount) })}
        </Link>
      ) : null}
      {showLowStock ? (
        <Link
          to="/stock"
          className={`${chipClass} border-waka-300 bg-waka-50 text-waka-900 shadow-sm hover:border-waka-400 hover:bg-waka-100`}
        >
          <span aria-hidden>🟠</span>
          {tTemplate(lang, "desktopHomeStatusLowStock", { count: String(lowStockCount) })}
        </Link>
      ) : null}
      <Link
        to="/office/backup"
        className={`${chipClass} ${
          synced
            ? "border-emerald-200 bg-emerald-50 text-emerald-900 shadow-sm hover:border-emerald-300 hover:bg-emerald-100"
            : "border-waka-300 bg-waka-50 text-waka-900 shadow-sm hover:border-waka-400 hover:bg-waka-100"
        }`}
      >
        <span aria-hidden>{synced ? "🟢" : "🟠"}</span>
        {synced ? t(lang, "desktopHomeStatusSynced") : t(lang, "desktopHomeStatusSyncPending")}
      </Link>
    </div>
  );
}
