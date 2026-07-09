import { actorHasPermission } from "../../lib/actorAuthorization";
import { Link } from "react-router-dom";
import { useMemo } from "react";
import type { Language } from "../../types";
import { t, tTemplate } from "../../lib/i18n";
import { usePosStore } from "../../store/usePosStore";
import { isLowStock } from "../../lib/sellingEngine";
import { useSyncStatus } from "../../hooks/useSyncStatus";
import { countSalesWithSyncErrors } from "../../offline/cloudSync";
import { useSubscription } from "../../context/SubscriptionContext";
import { resolveEffectivePlanTier, maxProductsForTier } from "../../lib/subscriptionEntitlements";
import { lockedProductIds } from "../../lib/productPlanLock";

import { useSessionActor } from "../../context/SessionActorContext";
import { summarizeTodaySales } from "../../lib/todaySalesSummary";
import { pendingSales } from "../../lib/saleStatus";
import { POS_RECEIPTS_ROUTE } from "../../lib/posNavigation";

type Props = { lang: Language };

export function DesktopLauncherStatusBar({ lang }: Props) {
  const actor = useSessionActor();
  const products = usePosStore((s) => s.products);
  const sales = usePosStore((s) => s.sales);
  const { snapshot } = useSubscription();
  const sync = useSyncStatus();
  const syncErrors = countSalesWithSyncErrors();
  const pendingSync = sync.pendingCount;
  const synced = pendingSync === 0 && syncErrors === 0;

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

  const today = useMemo(() => summarizeTodaySales(sales), [sales]);
  const pendingSaleCount = useMemo(() => pendingSales(sales).length, [sales]);

  const chip =
    "inline-flex min-h-[32px] touch-manipulation items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-black sm:text-xs";

  const chips: React.ReactNode[] = [];

  if (actorHasPermission(actor, "receipts.view") && today.count > 0) {
    chips.push(
      <Link
        key="sales"
        to={POS_RECEIPTS_ROUTE}
        className={`${chip} border-emerald-500/40 bg-emerald-950/70 text-emerald-100`}
      >
        <span aria-hidden>📈</span>
        {tTemplate(lang, "launcherStatusTodaySales", { count: String(today.count) })}
      </Link>,
    );
  }

  if (actorHasPermission(actor, "pending_sales.manage") && pendingSaleCount > 0) {
    chips.push(
      <Link
        key="pending"
        to="/pending-sales"
        className={`${chip} border-amber-500/40 bg-amber-950/70 text-amber-100`}
      >
        <span aria-hidden>⏳</span>
        {tTemplate(lang, "launcherStatusPendingSales", { count: String(pendingSaleCount) })}
      </Link>,
    );
  }

  if (actorHasPermission(actor, "stock.view") && lowStockCount > 0) {
    chips.push(
      <Link key="stock" to="/stock" className={`${chip} border-waka-500/40 bg-waka-950/70 text-waka-100`}>
        <span aria-hidden>📦</span>
        {tTemplate(lang, "desktopHomeStatusLowStock", { count: String(lowStockCount) })}
      </Link>,
    );
  }

  chips.push(
    <Link
      key="sync"
      to="/office/backup"
      className={`${chip} ${
        synced
          ? "border-emerald-500/40 bg-emerald-950/70 text-emerald-100"
          : "border-amber-500/40 bg-amber-950/70 text-amber-100"
      }`}
    >
      <span aria-hidden>{synced ? "🟢" : "🟠"}</span>
      {synced ? t(lang, "desktopHomeStatusSynced") : t(lang, "desktopHomeStatusSyncPending")}
    </Link>,
  );

  if (chips.length === 0) return null;

  return (
    <div className="mb-3 flex flex-wrap items-center justify-center gap-1.5 sm:gap-2" role="status" aria-live="polite">
      {chips}
    </div>
  );
}
