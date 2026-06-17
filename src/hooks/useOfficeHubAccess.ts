import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import { fetchWakaInternalAdminMe } from "../lib/wakaInternalAdmin";
import { fetchMarketingAgentMe } from "../lib/referralAgents";
import { canSeeOfficeProfit } from "../lib/homeProfit";
import type { Permission } from "../types";
import { useSessionActor } from "../context/SessionActorContext";
import { useSubscription } from "../context/SubscriptionContext";
import { canUseBackupRestore, hasEffectivePermission } from "../lib/subscriptionEntitlements";
import { canRecordCashExpenses } from "../lib/cashExpenses";
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
  const [showDeferredHub, setShowDeferredHub] = useState(false);
  const [showAgentPortal, setShowAgentPortal] = useState(false);

  useEffect(() => {
    runWhenIdle(() => setShowDeferredHub(true));
  }, []);

  useEffect(() => {
    let cancelled = false;
    runWhenIdle(() => {
      void (async () => {
        if (!supabase) {
          if (!cancelled) setShowAgentPortal(false);
          return;
        }
        const agent = await fetchMarketingAgentMe();
        if (!cancelled) setShowAgentPortal(Boolean(agent));
      })();
    });
    return () => {
      cancelled = true;
    };
  }, [actor.userId]);

  const can = (perm: Permission) => hasEffectivePermission(actor.role, perm, snapshot, authMode);
  const canBackup = canUseBackupRestore(snapshot, authMode);
  const canRecordExpense = canRecordCashExpenses(actor.role, preferences);
  const canProfit =
    canSeeOfficeProfit(actor.role, authMode) && can("back_office.access") && can("reports.profit");
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
