import { actorHasEffectivePermission, actorHasPermission } from "../../lib/actorAuthorization";
import { useCallback, useMemo, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { Share2 } from "lucide-react";
import type { Language, Permission } from "../../types";
import { t } from "../../lib/i18n";
import { useSessionActor } from "../../context/SessionActorContext";
import { resolveEffectivePlanTier, maxProductsForTier } from "../../lib/subscriptionEntitlements";
import { useOwnerRiskCards } from "../../hooks/useOwnerRiskCards";
import { useMarketingAgentPortal } from "../../hooks/useMarketingAgentPortal";
import { usePosStore } from "../../store/usePosStore";
import { isLowStock } from "../../lib/sellingEngine";
import { useSubscription } from "../../context/SubscriptionContext";
import { isPharmacyMode } from "../../lib/pharmacy";
import { activePrescriptionQueue } from "../../lib/pharmacyPrescriptions";
import { countExpiryBuckets } from "../../lib/pharmacyExpiry";
import { lockedProductIds } from "../../lib/productPlanLock";
import { POS_SHOP_ROUTE } from "../../lib/posNavigation";
import { prefetchOfficeHub } from "../../lib/prefetchRoutes";
import { resolveHomeMenuTiles, type ResolvedHomeTile } from "../../lib/launcherTiles";
import { homeModuleBand } from "../../lib/homeModulePriority";
import { LivingDashboardCard } from "./LivingDashboardCard";
import { HomeBusinessHero } from "./HomeBusinessHero";
import { HomeExecutiveKpiStrip } from "./HomeExecutiveKpiStrip";
import { HomeBusinessHealthSection } from "./HomeBusinessHealthSection";
import { HomeReportsPreview } from "./HomeReportsPreview";
import { useHomeDashboardMetrics } from "../../hooks/useHomeDashboardMetrics";
import { useSessionHydration } from "../../context/SessionHydrationContext";
import { Caption, SectionTitle } from "../enterprise/EnterpriseTypography";

type Props = { lang: Language };

const EMPTY_ORDER: string[] = [];
const EMPTY_LAYOUT = {};

export function DesktopHomeTiles({ lang }: Props) {
  const navigate = useNavigate();
  const actor = useSessionActor();
  const tileRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const { unseenCount: riskCount } = useOwnerRiskCards(lang, false);
  const preferences = usePosStore((s) => s.preferences);
  const pharmacyPrescriptions = usePosStore((s) => s.pharmacyPrescriptions);
  const products = usePosStore((s) => s.products);
  const savedOrder = usePosStore((s) => s.preferences.launcherTileOrder) ?? EMPTY_ORDER;
  const layout = usePosStore((s) => s.preferences.launcherTileLayout) ?? EMPTY_LAYOUT;
  const pharmacyMode = isPharmacyMode(preferences.businessType, preferences.pharmacyModeEnabled);
  const { snapshot, authMode, loading: subscriptionLoading } = useSubscription();
  const { roleReady } = useSessionHydration();
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

  const { byTile: liveStats, executive } = useHomeDashboardMetrics(
    lang,
    actor.role,
    actor.userId,
    lowStockCount,
    actor.permissions,
  );

  const can = useCallback(
    (perm?: Permission) => {
      if (!perm) return true;
      if (!roleReady) {
        return actorHasPermission(actor, perm);
      }
      if (authMode === "supabase" && subscriptionLoading) {
        return actorHasPermission(actor, perm);
      }
      return actorHasEffectivePermission(actor, perm, snapshot, authMode);
    },
    [actor, roleReady, subscriptionLoading, snapshot, authMode],
  );

  const rxQueueCount = useMemo(
    () => (pharmacyMode ? activePrescriptionQueue(pharmacyPrescriptions).length : 0),
    [pharmacyMode, pharmacyPrescriptions],
  );
  const expiringCount = useMemo(() => {
    if (!pharmacyMode) return 0;
    const inStock = products.filter((p) => p.stockOnHand > 0);
    const buckets = countExpiryBuckets(inStock);
    return buckets.d30 + buckets.d60 + buckets.d90;
  }, [pharmacyMode, products]);

  const badges = useMemo(
    () => ({
      inventory: pharmacyMode
        ? expiringCount > 0
          ? expiringCount
          : lowStockCount > 0
            ? lowStockCount
            : undefined
        : lowStockCount > 0
          ? lowStockCount
          : undefined,
      investigation: riskCount > 0 ? riskCount : undefined,
      commandCenter: pharmacyMode
        ? rxQueueCount > 0
          ? rxQueueCount
          : riskCount > 0
            ? riskCount
            : undefined
        : riskCount > 0
          ? riskCount
          : undefined,
      dashboard: rxQueueCount > 0 ? rxQueueCount : undefined,
    }),
    [lowStockCount, riskCount, pharmacyMode, expiringCount, rxQueueCount],
  );

  const { hero, secondary: baseSecondary } = useMemo(
    () =>
      resolveHomeMenuTiles({
        savedOrder,
        layout,
        hasPermission: can,
        badges,
        pharmacyMode,
      }),
    [savedOrder, layout, can, badges, pharmacyMode],
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

  const reportsTile = useMemo(() => secondary.find((tile) => tile.id === "reports"), [secondary]);
  const moduleTiles = useMemo(
    () => secondary.filter((tile) => tile.id !== "reports"),
    [secondary],
  );

  const primaryTiles = useMemo(
    () => moduleTiles.filter((tile) => homeModuleBand(tile.id) === "primary"),
    [moduleTiles],
  );
  const secondaryTiles = useMemo(
    () => moduleTiles.filter((tile) => homeModuleBand(tile.id) === "secondary"),
    [moduleTiles],
  );
  const adminTiles = useMemo(
    () => moduleTiles.filter((tile) => homeModuleBand(tile.id) === "admin"),
    [moduleTiles],
  );

  const openTile = useCallback(
    (to: string) => {
      if (to === POS_SHOP_ROUTE) prefetchOfficeHub();
      navigate(to);
    },
    [navigate],
  );

  const renderCard = (tile: ResolvedHomeTile, density: "comfortable" | "compact" = "comfortable") => (
    <LivingDashboardCard
      key={tile.id}
      tile={tile}
      lang={lang}
      spotlight={false}
      appearance="enterprise"
      density={density}
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
    <div className="w-full max-w-none" role="navigation" aria-label={t(lang, "desktopHomeNavLabel")}>
      <HomeBusinessHero
        lang={lang}
        sellStat={liveStats.sell}
        onSell={hero ? () => openTile(hero.to) : undefined}
        heroActionLabelKey={pharmacyMode ? "builderHomeTapDispense" : "builderHomeTapSell"}
      />

      <HomeExecutiveKpiStrip lang={lang} kpis={executive} />
      <HomeBusinessHealthSection lang={lang} />

      {reportsTile ? (
        <div className="mb-4 sm:mb-5">
          <HomeReportsPreview
            lang={lang}
            liveStat={liveStats.reports}
            onOpen={() => openTile(reportsTile.to)}
          />
        </div>
      ) : null}

      {primaryTiles.length > 0 ? (
        <section className="mb-4 sm:mb-5">
          <SectionTitle as="h2" className="mb-2 !text-sm sm:!text-base">
            {t(lang, "homeModulesPrimary")}
          </SectionTitle>
          <div className="grid grid-cols-2 gap-2.5 sm:gap-3 lg:grid-cols-3 xl:grid-cols-4">
            {primaryTiles.map((tile) => renderCard(tile))}
          </div>
        </section>
      ) : null}

      {secondaryTiles.length > 0 ? (
        <section className="mb-4 sm:mb-5">
          <SectionTitle as="h2" className="mb-2 !text-sm sm:!text-base">
            {t(lang, "homeModulesSecondary")}
          </SectionTitle>
          <Caption className="mb-2 normal-case">{t(lang, "homeModulesSecondarySub")}</Caption>
          <div className="grid grid-cols-2 gap-2.5 sm:gap-3 lg:grid-cols-3 xl:grid-cols-4">
            {secondaryTiles.map((tile) => renderCard(tile))}
          </div>
        </section>
      ) : null}

      {adminTiles.length > 0 ? (
        <section className="mb-2">
          <SectionTitle as="h2" className="mb-2 !text-sm sm:!text-base">
            {t(lang, "homeModulesAdmin")}
          </SectionTitle>
          <div className="grid grid-cols-2 gap-2 sm:gap-2.5 lg:grid-cols-4 xl:grid-cols-5">
            {adminTiles.map((tile) => renderCard(tile, "compact"))
            }
          </div>
        </section>
      ) : null}
    </div>
  );
}
