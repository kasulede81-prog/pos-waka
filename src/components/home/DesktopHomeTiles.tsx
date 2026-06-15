import { useCallback, useMemo, useRef } from "react";
import { useNavigate } from "react-router-dom";
import clsx from "clsx";
import {
  ShoppingCart,
  Package,
  Users,
  Receipt,
  BarChart3,
  Search,
  Banknote,
  Settings,
  type LucideIcon,
} from "lucide-react";
import type { Language, Permission } from "../../types";
import { t } from "../../lib/i18n";
import { useSessionActor } from "../../context/SessionActorContext";
import { hasPermission } from "../../lib/permissions";
import { useOwnerRiskCards } from "../../hooks/useOwnerRiskCards";
import { usePosStore } from "../../store/usePosStore";
import { isLowStock } from "../../lib/sellingEngine";
import { useSubscription } from "../../context/SubscriptionContext";
import { resolveEffectivePlanTier, maxProductsForTier } from "../../lib/subscriptionEntitlements";
import { lockedProductIds } from "../../lib/productPlanLock";

type TileDef = {
  id: string;
  labelKey: string;
  to: string;
  Icon: LucideIcon;
  perm?: Permission;
  badge?: number;
};

type Props = { lang: Language };

export function DesktopHomeTiles({ lang }: Props) {
  const navigate = useNavigate();
  const actor = useSessionActor();
  const tileRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const { totalCount: riskCount } = useOwnerRiskCards(lang, false);
  const products = usePosStore((s) => s.products);
  const { snapshot } = useSubscription();

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

  const tiles = useMemo((): TileDef[] => {
    const all: TileDef[] = [
      { id: "sell", labelKey: "desktopHomeTileSell", to: "/pos", Icon: ShoppingCart, perm: "pos.sell" },
      {
        id: "inventory",
        labelKey: "desktopHomeTileInventory",
        to: "/stock",
        Icon: Package,
        perm: "stock.view",
        badge: lowStockCount > 0 ? lowStockCount : undefined,
      },
      { id: "customers", labelKey: "desktopHomeTileCustomers", to: "/customers", Icon: Users, perm: "customers.view" },
      { id: "receipts", labelKey: "desktopHomeTileReceipts", to: "/receipts", Icon: Receipt, perm: "receipts.view" },
      { id: "reports", labelKey: "desktopHomeTileReports", to: "/reports", Icon: BarChart3, perm: "reports.view" },
      {
        id: "investigation",
        labelKey: "desktopHomeTileInvestigation",
        to: "/office/audit-center",
        Icon: Search,
        perm: "owner.activity",
        badge: riskCount > 0 ? riskCount : undefined,
      },
      { id: "cash", labelKey: "desktopHomeTileCash", to: "/office/cash-position", Icon: Banknote, perm: "day.close" },
      { id: "settings", labelKey: "desktopHomeTileSettings", to: "/settings", Icon: Settings, perm: "settings.view" },
    ];
    return all.filter((tile) => !tile.perm || hasPermission(actor.role, tile.perm));
  }, [actor.role, lowStockCount, riskCount]);

  const onTileKeyDown = useCallback(
    (index: number, event: React.KeyboardEvent<HTMLButtonElement>) => {
      const cols = 2;
      let next = index;
      if (event.key === "ArrowRight") next = Math.min(index + 1, tiles.length - 1);
      else if (event.key === "ArrowLeft") next = Math.max(index - 1, 0);
      else if (event.key === "ArrowDown") next = Math.min(index + cols, tiles.length - 1);
      else if (event.key === "ArrowUp") next = Math.max(index - cols, 0);
      else return;
      event.preventDefault();
      tileRefs.current[next]?.focus();
    },
    [tiles.length],
  );

  if (tiles.length === 0) {
    return (
      <p className="text-center text-base font-semibold text-stone-600">{t(lang, "desktopHomeNoTiles")}</p>
    );
  }

  return (
    <div
      className="grid w-full max-w-2xl grid-cols-2 gap-4 lg:grid-cols-2 xl:grid-cols-2"
      role="navigation"
      aria-label={t(lang, "desktopHomeNavLabel")}
    >
      {tiles.map((tile, index) => (
        <button
          key={tile.id}
          ref={(el) => {
            tileRefs.current[index] = el;
          }}
          type="button"
          onClick={() => navigate(tile.to)}
          onKeyDown={(e) => onTileKeyDown(index, e)}
          className={clsx(
            "relative flex min-h-[120px] touch-manipulation flex-col items-center justify-center gap-3 rounded-2xl border-2 border-stone-200/90 bg-white/90 px-4 py-5 text-center shadow-md transition-all",
            "hover:border-waka-300 hover:bg-waka-50/60 hover:shadow-lg active:scale-[0.98] motion-reduce:active:scale-100",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-waka-500 focus-visible:ring-offset-2",
          )}
        >
          {tile.badge !== undefined && tile.badge > 0 ? (
            <span className="absolute right-3 top-3 flex h-7 min-w-[1.75rem] items-center justify-center rounded-full bg-rose-600 px-1.5 text-xs font-black text-white">
              {tile.badge > 99 ? "99+" : tile.badge}
            </span>
          ) : null}
          <tile.Icon className="h-10 w-10 text-waka-700" strokeWidth={2} aria-hidden />
          <span className="text-lg font-black leading-tight text-stone-900">{t(lang, tile.labelKey)}</span>
        </button>
      ))}
    </div>
  );
}
