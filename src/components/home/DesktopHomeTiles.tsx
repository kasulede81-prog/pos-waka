import { useCallback, useEffect, useMemo, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { Share2 } from "lucide-react";
import type { Language, Permission } from "../../types";
import { t } from "../../lib/i18n";
import { useSessionActor } from "../../context/SessionActorContext";
import { hasEffectivePermission, resolveEffectivePlanTier, maxProductsForTier } from "../../lib/subscriptionEntitlements";
import { useOwnerRiskCards } from "../../hooks/useOwnerRiskCards";
import { useMarketingAgentPortal } from "../../hooks/useMarketingAgentPortal";
import { usePosStore } from "../../store/usePosStore";
import { isLowStock } from "../../lib/sellingEngine";
import { useSubscription } from "../../context/SubscriptionContext";
import { lockedProductIds } from "../../lib/productPlanLock";
import { POS_SHOP_ROUTE } from "../../lib/posNavigation";
import { prefetchOfficeHub } from "../../lib/prefetchRoutes";
import { resolveHomeMenuTiles, type ResolvedHomeTile } from "../../lib/launcherTiles";
import { prefetchHomeTileLotties } from "./HomeTileLottie";
import { LivingDashboardCard } from "./LivingDashboardCard";
import { HomeBusinessHero } from "./HomeBusinessHero";
import { useHomeDashboardAnimationPause } from "../../hooks/useHomeDashboardAnimationPause";
import { useHomeDashboardMetrics } from "../../hooks/useHomeDashboardMetrics";
import { useHomeTileSpotlight } from "../../hooks/useHomeTileSpotlight";

type Props = { lang: Language };

const EMPTY_ORDER: string[] = [];
const EMPTY_LAYOUT = {};

export function DesktopHomeTiles({ lang }: Props) {
  const animPaused = useHomeDashboardAnimationPause();
  const navigate = useNavigate();
  const actor = useSessionActor();
  const tileRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const { unseenCount: riskCount } = useOwnerRiskCards(lang, false);
  const products = usePosStore((s) => s.products);
  const savedOrder = usePosStore((s) => s.preferences.launcherTileOrder) ?? EMPTY_ORDER;
  const layout = usePosStore((s) => s.preferences.launcherTileLayout) ?? EMPTY_LAYOUT;
  const { snapshot, authMode } = useSubscription();
  const { isMarketingAgent } = useMarketingAgentPortal();

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

  const liveStats = useHomeDashboardMetrics(lang, actor.role, actor.userId, lowStockCount);

  const can = useCallback(
    (perm?: Permission) =>
      !perm || hasEffectivePermission(actor.role, perm, snapshot, authMode),
    [actor.role, snapshot, authMode],
  );

  const badges = useMemo(
    () => ({
      inventory: lowStockCount > 0 ? lowStockCount : undefined,
      investigation: riskCount > 0 ? riskCount : undefined,
      commandCenter: riskCount > 0 ? riskCount : undefined,
    }),
    [lowStockCount, riskCount],
  );

  const { hero, secondary: baseSecondary } = useMemo(
    () =>
      resolveHomeMenuTiles({
        savedOrder,
        layout,
        hasPermission: can,
        badges,
      }),
    [savedOrder, layout, can, badges],
  );

  const secondary = useMemo((): ResolvedHomeTile[] => {
    if (!isMarketingAgent) return baseSecondary;
    const agentTile: ResolvedHomeTile = {
      id: "agent",
      labelKey: "desktopHomeTileAgent",
      to: "/agent",
      Icon: Share2,
      group: "management",
      hideable: false,
      color: "orange",
      customColor: null,
      scale: 35,
      pinned: true,
      hidden: false,
    };
    if (baseSecondary.some((tile) => tile.id === "agent")) return baseSecondary;
    return [agentTile, ...baseSecondary];
  }, [baseSecondary, isMarketingAgent]);

  const profitTile = useMemo(() => secondary.find((tile) => tile.id === "profit"), [secondary]);
  const reportsTile = useMemo(() => secondary.find((tile) => tile.id === "reports"), [secondary]);
  const sceneTiles = useMemo(
    () => secondary.filter((tile) => tile.id !== "profit" && tile.id !== "reports"),
    [secondary],
  );

  const spotlightOrder = useMemo(() => {
    const ids: string[] = [];
    if (hero) ids.push("sell");
    if (profitTile) ids.push("profit");
    ids.push(...sceneTiles.map((tile) => tile.id));
    if (reportsTile) ids.push("reports");
    return ids;
  }, [hero, profitTile, sceneTiles, reportsTile]);

  const activeSpotlight = useHomeTileSpotlight(spotlightOrder, animPaused);

  useEffect(() => {
    prefetchHomeTileLotties(spotlightOrder);
  }, [spotlightOrder]);

  const openTile = useCallback(
    (to: string) => {
      if (to === POS_SHOP_ROUTE) prefetchOfficeHub();
      navigate(to);
    },
    [navigate],
  );

  const renderCard = (tile: ResolvedHomeTile) => (
    <LivingDashboardCard
      key={tile.id}
      tile={tile}
      lang={lang}
      spotlight={activeSpotlight === tile.id}
      liveStat={liveStats[tile.id]}
      buttonRef={(el) => {
        tileRefs.current[tile.id] = el;
      }}
      onClick={() => openTile(tile.to)}
    />
  );

  if (!hero && secondary.length === 0) {
    return (
      <p className="text-center text-base font-semibold text-waka-800">{t(lang, "desktopHomeNoTiles")}</p>
    );
  }

  return (
    <div
      className="w-full max-w-lg sm:max-w-3xl lg:max-w-6xl"
      role="navigation"
      aria-label={t(lang, "desktopHomeNavLabel")}
    >
      <HomeBusinessHero
        lang={lang}
        sellStat={liveStats.sell}
        onSell={hero ? () => openTile(hero.to) : undefined}
      />
      <div className="flex flex-col gap-3 sm:gap-4">
        {profitTile ? (
          <div className="grid grid-cols-1 gap-3 sm:gap-4 lg:grid-cols-2">
            {renderCard(profitTile)}
          </div>
        ) : null}
        {sceneTiles.length > 0 ? (
          <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-3 xl:grid-cols-4">
            {sceneTiles.map((tile) => renderCard(tile))}
          </div>
        ) : null}
        {reportsTile ? renderCard(reportsTile) : null}
      </div>
    </div>
  );
}
