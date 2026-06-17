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
  Receipt,
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
import { POS_RECEIPTS_ROUTE, POS_SELL_ROUTE, POS_SHOP_ROUTE } from "../../lib/posNavigation";

type TileDef = {
  id: string;
  labelKey: string;
  to: string;
  Icon: LucideIcon;
  perm?: Permission;
  badge?: number;
  area: string;
  variant: "primary" | "secondary";
};

type Props = { lang: Language };

const FOCUS_ORDER = [
  "sell",
  "inventory",
  "customers",
  "shop",
  "salesHistory",
  "reports",
  "investigation",
  "cash",
  "settings",
] as const;

function tileButtonClass(variant: TileDef["variant"], tileId: string): string {
  const isPrimary = variant === "primary";
  return clsx(
    "relative touch-manipulation rounded-2xl border-2 text-center shadow-md transition-all",
    "hover:shadow-lg active:scale-[0.98] motion-reduce:active:scale-100",
    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-waka-400 focus-visible:ring-offset-2 focus-visible:ring-offset-stone-900/5",
    isPrimary
      ? clsx(
          "col-span-2 flex flex-col items-center justify-center gap-3 border-waka-500/80 bg-gradient-to-br from-waka-600 to-waka-700 px-4 py-6 text-white",
          "min-h-[140px] shadow-[0_8px_32px_rgba(234,88,12,0.45)] hover:from-waka-500 hover:to-waka-600",
          "lg:min-h-[260px] lg:gap-4 lg:px-6 lg:py-8",
        )
      : clsx(
          "flex min-h-[108px] flex-col items-center justify-center gap-2 border-stone-600/40 bg-stone-800/90 px-3 py-3 text-stone-50",
          "hover:border-waka-500/50 hover:bg-stone-800 sm:min-h-[120px] sm:gap-2.5 sm:px-4 sm:py-4",
        ),
    tileId !== "sell" && "lg:[grid-area:var(--tile-area)]",
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
        id: "salesHistory",
        labelKey: "receipts",
        to: POS_RECEIPTS_ROUTE,
        Icon: Receipt,
        perm: "receipts.view",
        area: "salesHistory",
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
    () => FOCUS_ORDER.filter((id) => tiles.some((tile) => tile.id === id)),
    [tiles],
  );

  useEffect(() => {
    const first = focusableIds[0];
    if (first) tileRefs.current[first]?.focus();
  }, [focusableIds]);

  const onTileKeyDown = useCallback(
    (id: string, event: React.KeyboardEvent<HTMLButtonElement>) => {
      const neighbors: Record<string, Partial<Record<string, string>>> = {
        sell: { ArrowRight: "inventory", ArrowDown: "shop" },
        inventory: { ArrowLeft: "sell", ArrowDown: "customers", ArrowRight: "customers" },
        customers: { ArrowLeft: "inventory", ArrowDown: "salesHistory" },
        shop: { ArrowLeft: "inventory", ArrowUp: "inventory", ArrowDown: "investigation", ArrowRight: "salesHistory" },
        salesHistory: { ArrowLeft: "shop", ArrowUp: "customers", ArrowDown: "settings" },
        reports: { ArrowUp: "sell", ArrowRight: "investigation" },
        investigation: { ArrowLeft: "reports", ArrowRight: "cash", ArrowUp: "shop" },
        cash: { ArrowLeft: "investigation", ArrowRight: "settings" },
        settings: { ArrowLeft: "cash", ArrowUp: "salesHistory" },
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
        style={{ ["--tile-area" as string]: tile.area }}
        className={tileButtonClass(tile.variant, tile.id)}
      >
        {tile.badge !== undefined && tile.badge > 0 ? (
          <span className="absolute right-3 top-3 flex h-7 min-w-[1.75rem] items-center justify-center rounded-full bg-rose-600 px-1.5 text-xs font-black text-white">
            {tile.badge > 99 ? "99+" : tile.badge}
          </span>
        ) : null}
        <tile.Icon
          className={isPrimary ? "h-12 w-12 shrink-0 lg:h-16 lg:w-16" : "h-8 w-8 shrink-0 text-waka-300 sm:h-9 sm:w-9"}
          strokeWidth={isPrimary ? 2.5 : 2}
          aria-hidden
        />
        <span
          className={
            isPrimary
              ? "text-2xl font-black uppercase tracking-wide lg:text-3xl"
              : "text-base font-black leading-tight sm:text-lg"
          }
        >
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
      className={clsx(
        "w-full max-w-lg grid grid-cols-2 gap-3 sm:max-w-2xl sm:gap-4",
        "lg:max-w-4xl lg:grid-cols-4 lg:grid-rows-[minmax(120px,1fr)_minmax(120px,1fr)_minmax(120px,auto)] lg:gap-4",
        "lg:[grid-template-areas:'sell_sell_inventory_customers''sell_sell_shop_salesHistory''reports_investigation_cash_settings']",
      )}
      role="navigation"
      aria-label={t(lang, "desktopHomeNavLabel")}
    >
      {FOCUS_ORDER.map((id) => (tileById[id] ? renderTile(tileById[id]!) : null))}
    </div>
  );
}
