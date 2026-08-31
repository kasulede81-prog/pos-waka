import { Link } from "react-router-dom";
import clsx from "clsx";
import { useMemo } from "react";
import type { Language } from "../../types";
import { t, tTemplate } from "../../lib/i18n";
import { actorHasEffectivePermission } from "../../lib/actorAuthorization";
import { useOwnerRiskCards } from "../../hooks/useOwnerRiskCards";
import { usePosStore } from "../../store/usePosStore";
import { isLowStock } from "../../lib/sellingEngine";
import { useSyncStatus } from "../../hooks/useSyncStatus";
import { countSalesWithSyncErrors } from "../../offline/cloudSync";
import { useSubscription } from "../../context/SubscriptionContext";
import { resolveEffectivePlanTier, maxProductsForTier } from "../../lib/subscriptionEntitlements";
import { lockedProductIds } from "../../lib/productPlanLock";
import { useSessionActor } from "../../context/SessionActorContext";
import { resolveDesktopLicenseDisplay } from "../../lib/desktopLicenseDisplay";
import { healthStatusBadge, healthStatusDot } from "../../lib/statusTokens";
import { EnterpriseCard } from "../enterprise/EnterpriseCard";
type Props = { lang: Language };

type HealthItem = {
  id: string;
  label: string;
  to: string;
  status: "ok" | "warning" | "critical";
};

/**
 * Phase 34.1 — Business Health promoted above the fold.
 * Reuses the same sync / risk / stock / subscription signals as the former footer chips.
 */
export function HomeBusinessHealthSection({ lang }: Props) {
  const actor = useSessionActor();
  const { snapshot, authMode } = useSubscription();
  const { unseenCount: riskCount } = useOwnerRiskCards(lang, false);
  const products = usePosStore((s) => s.products);
  const sync = useSyncStatus();
  const syncErrors = countSalesWithSyncErrors();
  const pending = sync.pendingCount;
  const synced = pending === 0 && syncErrors === 0;
  const license = resolveDesktopLicenseDisplay(snapshot, authMode);
  const upgradeTo = authMode === "supabase" ? "/upgrade" : "/settings";

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

  const items = useMemo((): HealthItem[] => {
    const rows: HealthItem[] = [];

    rows.push({
      id: "connectivity",
      label: sync.isOnline ? t(lang, "homeHealthOnline") : t(lang, "homeHealthOffline"),
      to: "/office/backup",
      status: sync.isOnline ? "ok" : "critical",
    });

    rows.push({
      id: "sync",
      label: synced ? t(lang, "desktopHomeStatusSynced") : t(lang, "desktopHomeStatusSyncPending"),
      to: "/office/backup",
      status: synced ? "ok" : "warning",
    });

    if (actorHasEffectivePermission(actor, "owner.activity", snapshot, authMode)) {
      rows.push({
        id: "risks",
        label:
          riskCount > 0
            ? tTemplate(lang, "desktopHomeStatusRisks", { count: String(riskCount) })
            : t(lang, "homeHealthNoRisks"),
        to: "/office/audit-center",
        status: riskCount > 0 ? "critical" : "ok",
      });
    }

    if (actorHasEffectivePermission(actor, "stock.view", snapshot, authMode)) {
      rows.push({
        id: "stock",
        label:
          lowStockCount > 0
            ? tTemplate(lang, "desktopHomeStatusLowStock", { count: String(lowStockCount) })
            : t(lang, "homeHealthStockOk"),
        to: "/stock",
        status: lowStockCount >= 5 ? "critical" : lowStockCount > 0 ? "warning" : "ok",
      });
    }

    let subLabel = t(lang, "desktopHomeSubscriptionActive");
    let subStatus: HealthItem["status"] = "ok";
    if (license.status === "expired") {
      subLabel = t(lang, "desktopHomeSubscriptionExpired");
      subStatus = "critical";
    } else if (license.status === "expiring_soon" && license.daysRemaining !== null) {
      subLabel = tTemplate(lang, "desktopHomeSubscriptionExpiring", {
        days: String(license.daysRemaining),
      });
      subStatus = "warning";
    }
    rows.push({
      id: "subscription",
      label: subLabel,
      to: upgradeTo,
      status: subStatus,
    });

    if (license.deviceLimit !== null) {
      rows.push({
        id: "devices",
        label: tTemplate(lang, "desktopHomeDeviceLimit", { count: String(license.deviceLimit) }),
        to: "/settings",
        status: "ok",
      });
    }

    return rows;
  }, [
    actor,
    authMode,
    lang,
    license.daysRemaining,
    license.deviceLimit,
    license.status,
    lowStockCount,
    riskCount,
    snapshot,
    sync.isOnline,
    synced,
    upgradeTo,
  ]);

  return (
    <section className="mb-2.5 sm:mb-3" aria-label={t(lang, "homeHealthTitle")}>
      <EnterpriseCard
        className="!p-2.5 sm:!p-3"
        title={t(lang, "homeHealthTitle")}
        subtitle={t(lang, "homeHealthSub")}
        actions={
          actorHasEffectivePermission(actor, "owner.dashboard", snapshot, authMode) ? (
            <Link
              to="/owner"
              className="text-xs font-black text-waka-800 underline-offset-2 hover:underline"
            >
              {t(lang, "homeHealthOpenCommandCenter")}
            </Link>
          ) : null
        }
      >
        <ul className="grid grid-cols-2 gap-1 sm:grid-cols-3 sm:gap-1.5 lg:grid-cols-6">
          {items.map((item) => (
            <li key={item.id}>
              <Link
                to={item.to}
                className={clsx(
                  "flex min-h-[44px] items-center gap-1.5 rounded-xl px-2 py-1.5 text-[11px] font-bold ring-1 ring-inset transition-colors",
                  "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-waka-500",
                  healthStatusBadge(item.status),
                )}
              >
                <span className={clsx(healthStatusDot(item.status))} aria-hidden />
                <span className="truncate">{item.label}</span>
              </Link>
            </li>
          ))}
        </ul>
      </EnterpriseCard>
    </section>
  );
}
