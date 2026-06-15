import { useCallback, useEffect, useMemo, useRef } from "react";
import { useNavigate } from "react-router-dom";
import clsx from "clsx";
import {
  ShoppingCart,
  Package,
  Users,
  BarChart3,
  Search,
  Banknote,
  Settings,
  Briefcase,
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
import { POS_SELL_ROUTE, POS_SHOP_ROUTE } from "../../lib/posNavigation";

type TileDef = {
  id: string;
  labelKey: string;
  to: string;
  Icon: LucideIcon;
  perm?: Permission;
  badge?: number;
  /** Grid placement */
  area: string;
  variant: "primary" | "secondary";
};

type Props = { lang: Language };

const FOCUS_ORDER = [
  "sell",
  "inventory",
  "customers",
  "shop",
  "reports",
  "investigation",
  "cash",
  "settings",
] as const;

function tileButtonClass(variant: TileDef["variant"], extra?: string): string {
  return clsx(
    "relative touch-manipulation rounded-2xl border-2 text-center shadow-md transition-all",
    "hover:shadow-lg active:scale-[0.98] motion-reduce:active:scale-100",
    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-waka-400 focus-visible:ring-offset-2 focus-visible:ring-offset-stone-900/5",
    variant === "primary"
      ? "flex min-h-[260px] flex-col items-center justify-center gap-4 border-waka-500/80 bg-gradient-to-br from-waka-600 to-waka-700 px-6 py-8 text-white shadow-[0_8px_32px_rgba(234,88,12,0.45)] hover:from-waka-500 hover:to-waka-600"
      : "flex min-h-[120px] flex-col items-center justify-center gap-2.5 border-stone-600/40 bg-stone-800/90 px-4 py-4 text-stone-50 hover:border-waka-500/50 hover:bg-stone-800",
    extra,
  );
}

export function DesktopHomeTiles({ lang }: Props) {
  const navigate = useNavigate();
  const actor = useSessionActor();
  const tileRefs = useRef<Record<string, HTMLButtonElement | null>>({});
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
      {
        id: "sell",
        labelKey: "desktopHomeTileSell",
        to: POS_SELL_ROUTE,
        Icon: ShoppingCart,
        perm: "pos.sell",
        area: "sell",
        variant: "primary",
      },
      {
        id: "inventory",
        labelKey: "desktopHomeTileInventory",
        to: "/stock",
        Icon: Package,
        perm: "stock.view",
        badge: lowStockCount > 0 ? lowStockCount : undefined,
        area: "inventory",
        variant: "secondary",
      },
      {
        id: "customers",
        labelKey: "desktopHomeTileCustomers",
        to: "/customers",
        Icon: Users,
        perm: "customers.view",
        area: "customers",
        variant: "secondary",
      },
      {
        id: "shop",
        labelKey: "desktopHomeTileShop",
        to: POS_SHOP_ROUTE,
        Icon: Briefcase,
        perm: "back_office.access",
        area: "shop",
        variant: "secondary",
      },
      {
        id: "reports",
        labelKey: "desktopHomeTileReports",
        to: "/reports",
        Icon: BarChart3,
        perm: "reports.view",
        area: "reports",
        variant: "secondary",
      },
      {
        id: "investigation",
        labelKey: "desktopHomeTileInvestigation",
        to: "/office/audit-center",
        Icon: Search,
        perm: "owner.activity",
        badge: riskCount > 0 ? riskCount : undefined,
        area: "investigation",
        variant: "secondary",
      },
      {
        id: "cash",
        labelKey: "desktopHomeTileCash",
        to: "/office/cash-position",
        Icon: Banknote,
        perm: "day.close",
        area: "cash",
        variant: "secondary",
      },
      {
        id: "settings",
        labelKey: "desktopHomeTileSettings",
        to: "/settings",
        Icon: Settings,
        perm: "settings.view",
        area: "settings",
        variant: "secondary",
      },
    ];
    return all.filter((tile) => !tile.perm || hasPermission(actor.role, tile.perm));
  }, [actor.role, lowStockCount, riskCount]);

  const focusableIds = useMemo(
    () => FOCUS_ORDER.filter((id) => tiles.some((t) => t.id === id)),
    [tiles],
  );

  useEffect(() => {
    const first = focusableIds[0];
    if (first) tileRefs.current[first]?.focus();
  }, [focusableIds]);

  const onTileKeyDown = useCallback(
    (id: string, event: React.KeyboardEvent<HTMLButtonElement>) => {
      const neighbors: Record<string, Partial<Record<string, string>>> = {
        sell: { ArrowRight: "inventory", ArrowDown: "reports" },
        inventory: { ArrowLeft: "sell", ArrowDown: "customers", ArrowRight: "customers" },
        customers: { ArrowLeft: "inventory", ArrowDown: "shop" },
        shop: { ArrowLeft: "customers", ArrowUp: "inventory", ArrowDown: "investigation" },
        reports: { ArrowUp: "sell", ArrowRight: "investigation" },
        investigation: { ArrowLeft: "reports", ArrowRight: "cash" },
        cash: { ArrowLeft: "investigation", ArrowRight: "settings" },
        settings: { ArrowLeft: "cash" },
      };

      const nextId = neighbors[id]?.[event.key];
      if (!nextId || !tileRefs.current[nextId]) return;
      event.preventDefault();
      tileRefs.current[nextId]?.focus();
    },
    [],
  );

  const renderTile = (tile: TileDef) => {
    const isPrimary = tile.variant === "primary";
    return (
      <button
        key={tile.id}
        ref={(el) => {
          tileRefs.current[tile.id] = el;
        }}
        type="button"
        onClick={() => navigate(tile.to)}
        onKeyDown={(e) => onTileKeyDown(tile.id, e)}
        style={{ gridArea: tile.area }}
        className={tileButtonClass(tile.variant)}
      >
        {tile.badge !== undefined && tile.badge > 0 ? (
          <span className="absolute right-3 top-3 flex h-7 min-w-[1.75rem] items-center justify-center rounded-full bg-rose-600 px-1.5 text-xs font-black text-white">
            {tile.badge > 99 ? "99+" : tile.badge}
          </span>
        ) : null}
        <tile.Icon
          className={isPrimary ? "h-16 w-16 shrink-0" : "h-9 w-9 shrink-0 text-waka-300"}
          strokeWidth={isPrimary ? 2.5 : 2}
          aria-hidden
        />
        <span className={isPrimary ? "text-3xl font-black uppercase tracking-wide" : "text-lg font-black leading-tight"}>
          {t(lang, tile.labelKey)}
        </span>
      </button>
    );
  };

  if (tiles.length === 0) {
    return (
      <p className="text-center text-base font-semibold text-stone-300">{t(lang, "desktopHomeNoTiles")}</p>
    );
  }

  const tileById = Object.fromEntries(tiles.map((tile) => [tile.id, tile]));

  return (
    <div
      className="w-full max-w-4xl [grid-template-areas:'sell_sell_inventory_customers''sell_sell_shop_shop''reports_investigation_cash_settings'] grid grid-cols-4 grid-rows-[minmax(120px,1fr)_minmax(120px,1fr)_minmax(120px,auto)] gap-3 sm:gap-4"
      role="navigation"
      aria-label={t(lang, "desktopHomeNavLabel")}
    >
      {FOCUS_ORDER.map((id) => (tileById[id] ? renderTile(tileById[id]!) : null))}
    </div>
  );
}
