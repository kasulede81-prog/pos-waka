import { useMemo } from "react";
import type { Language } from "../types";
import { t, tTemplate } from "../lib/i18n";
import { actorHasEffectivePermission } from "../lib/actorAuthorization";
import { useOwnerRiskCards } from "./useOwnerRiskCards";
import { usePosStore } from "../store/usePosStore";
import { isLowStock } from "../lib/sellingEngine";
import { useSyncStatus } from "./useSyncStatus";
import { countSalesWithSyncErrors } from "../offline/cloudSync";
import { useSubscription } from "../context/SubscriptionContext";
import { resolveEffectivePlanTier, maxProductsForTier } from "../lib/subscriptionEntitlements";
import { lockedProductIds } from "../lib/productPlanLock";
import { useSessionActor } from "../context/SessionActorContext";
import { resolveDesktopLicenseDisplay } from "../lib/desktopLicenseDisplay";

export type HomeHealthItem = {
  id: string;
  label: string;
  to: string;
  status: "ok" | "warning" | "critical";
};

export type HomeBusinessHealthModel = {
  items: HomeHealthItem[];
  commandCenterTo: string | null;
};

/**
 * Existing Home / EOD health signals only — connectivity, sync, risks, stock, subscription.
 * Presentation hook; does not change those calculations.
 */
export function useHomeBusinessHealthItems(lang: Language): HomeBusinessHealthModel {
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

  const canCommandCenter = actorHasEffectivePermission(actor, "owner.dashboard", snapshot, authMode);

  const items = useMemo((): HomeHealthItem[] => {
    const rows: HomeHealthItem[] = [];

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
    let subStatus: HomeHealthItem["status"] = "ok";
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

  return {
    items,
    commandCenterTo: canCommandCenter ? "/owner" : null,
  };
}
