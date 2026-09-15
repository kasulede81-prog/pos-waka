import { useEffect, useState } from "react";
import { actorHasEffectivePermission } from "../lib/actorAuthorization";
import { supabase } from "../lib/supabase";
import { fetchWakaInternalAdminMe } from "../lib/wakaInternalAdmin";
import { fetchMarketingAgentMe } from "../lib/referralAgents";
import { useMarketingAgentPortal } from "./useMarketingAgentPortal";
import type { Permission } from "../types";
import { useSessionActor } from "../context/SessionActorContext";
import { useSubscription } from "../context/SubscriptionContext";
import { canUseBackupRestore } from "../lib/subscriptionEntitlements";
import { canRecordCashExpenses } from "../lib/cashExpenses";
import { resolveProfitVisibility } from "../lib/profitVisibility";
import { usePosStore } from "../store/usePosStore";
import { isHospitalityMode } from "../lib/hospitality";
import { isPharmacyMode } from "../lib/pharmacy";
import { isWholesaleMode } from "../lib/wholesale";
import { runWhenIdle } from "../lib/uiYield";
import type { OfficeHubSectionId } from "../lib/officeHubSections";

export function useOfficeHubAccess() {
  const actor = useSessionActor();
  const preferences = usePosStore((s) => s.preferences);
  const pharmacyMode = isPharmacyMode(preferences.businessType, preferences.pharmacyModeEnabled);
  const hospitalityMode = isHospitalityMode(preferences.businessType, preferences.hospitalityModeEnabled);
  const wholesaleMode = isWholesaleMode(preferences.businessType);
  const { snapshot, authMode } = useSubscription();
  const { isMarketingAgent: showAgentPortal } = useMarketingAgentPortal();
  const [showDeferredHub, setShowDeferredHub] = useState(false);

  useEffect(() => {
    runWhenIdle(() => setShowDeferredHub(true));
  }, []);

  const can = (perm: Permission) => actorHasEffectivePermission(actor, perm, snapshot, authMode);
  const canBackup = canUseBackupRestore(snapshot, authMode);
  const canRecordExpense = canRecordCashExpenses(actor.role, preferences, actor.permissions);
  const profitVisibility = resolveProfitVisibility({
    role: actor.role,
    snapshot,
    authMode,
    actorPermissions: actor.permissions,
  });
  const canProfit = profitVisibility.canProfit && can("back_office.access");
  const canShopSettings = can("settings.shop");
  const canOwnerDashboard = can("owner.dashboard");
  const canArrangeShelves = can("settings.shop") && can("stock.view");

  const hasDaily =
    can("customers.view") ||
    can("stock.view") ||
    can("purchases.record") ||
    can("suppliers.view") ||
    can("day.close") ||
    canRecordExpense ||
    (hospitalityMode && (can("hospitality.floor") || can("hospitality.kitchen") || can("pending_sales.manage"))) ||
    (pharmacyMode && canShopSettings);
  const hasInsights =
    can("reports.view") ||
    can("receipts.view") ||
    canProfit ||
    can("owner.dashboard") ||
    can("owner.activity");
  const hasShopControl = can("settings.view") || canShopSettings;
  const hasData = can("settings.view") && canBackup;
  const hasHelp = true;

  const sectionVisible: Record<OfficeHubSectionId, boolean> = {
    daily: hasDaily,
    insights: hasInsights,
    "shop-control": hasShopControl,
    data: hasData,
    help: hasHelp,
  };

  return {
    actor,
    preferences,
    pharmacyMode,
    hospitalityMode,
    wholesaleMode,
    can,
    canBackup,
    canRecordExpense,
    canProfit,
    canShopSettings,
    canOwnerDashboard,
    canArrangeShelves,
    hasDaily,
    hasInsights,
    hasShopControl,
    hasData,
    hasHelp,
    sectionVisible,
    showDeferredHub,
    showAgentPortal,
    snapshot,
    authMode,
  };
}

export async function fetchOfficeHubAdminFlags(): Promise<{ showInternalAdmin: boolean; showAgentPortal: boolean }> {
  if (!supabase) return { showInternalAdmin: false, showAgentPortal: false };
  const [me, agent] = await Promise.all([fetchWakaInternalAdminMe(), fetchMarketingAgentMe()]);
  return { showInternalAdmin: Boolean(me), showAgentPortal: Boolean(agent) };
}
