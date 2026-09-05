import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useShallow } from "zustand/react/shallow";
import type { Language } from "../../../types";
import { usePosStore } from "../../../store/usePosStore";
import { useSessionActor } from "../../../context/SessionActorContext";
import { useSubscription } from "../../../context/SubscriptionContext";
import { maxProductsForTier, resolveEffectivePlanTier } from "../../../lib/subscriptionEntitlements";
import { actorCanSeeInventoryCostValue } from "../../../lib/inventoryFinancialVisibility";
import {
  inventoryWorkspaceBasePath,
  inventoryWorkspaceMode,
  resolveInventoryExtensionTiles,
  resolveInventoryNavTiles,
  resolveInventoryOverviewQuickActions,
} from "../../../lib/inventoryWorkspaceTiles";
import { computeInventoryWorkspaceDashboardStats } from "../../../lib/inventoryWorkspaceStats";
import { InventoryWorkspaceShell } from "./InventoryWorkspaceShell";
import { InventorySearchBar } from "./InventorySearchBar";
import { InventoryDashboardCards, InventoryOpsBoard } from "./InventoryDashboardCards";
import { InventoryQuickActions } from "./InventoryQuickActions";
import { InventoryNavigationTiles } from "./InventoryNavigationTiles";
import { InventoryBusinessExtension } from "./InventoryBusinessExtension";
import { InventoryStatusStrip } from "./InventoryStatusStrip";
import { StockAdjustmentSheet } from "../../stock/StockAdjustmentSheet";
import type { InventoryPurchasingTab } from "../../../features/inventory-purchasing/types";

type Props = {
  lang: Language;
  onSetTab: (tab: InventoryPurchasingTab, extra?: Record<string, string | null>) => void;
  onReceiveStock: () => void;
  /** Opens Add Product on the Products tab (≤2 taps from hub). */
  onAddProduct: () => void;
  /** Opens existing CSV import on the Products tab. */
  onImportCsv: () => void;
};

export function InventoryWorkspaceOverview({ lang, onSetTab, onReceiveStock, onAddProduct, onImportCsv }: Props) {
  const navigate = useNavigate();
  const actor = useSessionActor();
  const { snapshot, authMode } = useSubscription();
  const canSeeCost = actorCanSeeInventoryCostValue(actor, snapshot, authMode);
  const { products, purchases, supplierPayments, suppliers, preferences, pharmacyComplianceAlerts } = usePosStore(
    useShallow((s) => ({
      products: s.products,
      purchases: s.purchases,
      supplierPayments: s.supplierPayments,
      suppliers: s.suppliers,
      preferences: s.preferences,
      pharmacyComplianceAlerts: s.pharmacyComplianceAlerts,
    })),
  );

  const mode = inventoryWorkspaceMode(preferences.businessType, preferences.pharmacyModeEnabled);
  const basePath = inventoryWorkspaceBasePath(mode);
  const productLimit = maxProductsForTier(resolveEffectivePlanTier(snapshot));
  const catalogProducts = useMemo(
    () => (productLimit === null ? products : products.slice(0, productLimit)),
    [products, productLimit],
  );

  const stats = useMemo(
    () =>
      computeInventoryWorkspaceDashboardStats({
        products,
        catalogProducts,
        purchases,
        supplierPayments,
        suppliers,
        businessType: preferences.businessType,
        pharmacyModeEnabled: preferences.pharmacyModeEnabled,
        complianceAlertCount: pharmacyComplianceAlerts.length,
      }),
    [products, catalogProducts, purchases, supplierPayments, suppliers, preferences.businessType, preferences.pharmacyModeEnabled, pharmacyComplianceAlerts.length],
  );

  const quickActions = useMemo(() => resolveInventoryOverviewQuickActions(mode), [mode]);
  const navTiles = useMemo(() => resolveInventoryNavTiles(mode, basePath), [mode, basePath]);
  const extensionTiles = useMemo(
    () =>
      resolveInventoryExtensionTiles(mode, basePath, {
        nearExpiry: stats.nearExpiryCount,
        controlledAlerts: stats.controlledAlerts,
      }),
    [mode, basePath, stats.nearExpiryCount, stats.controlledAlerts],
  );

  const [adjustOpen, setAdjustOpen] = useState(false);

  const handleAction = (actionId: string) => {
    switch (actionId) {
      case "receiveStock":
        onReceiveStock();
        break;
      case "newProduct":
        onAddProduct();
        break;
      case "importCsv":
        onImportCsv();
        break;
      case "adjustStock":
        setAdjustOpen(true);
        break;
      case "viewPurchases":
        onSetTab("purchases");
        break;
      case "viewSuppliers":
        onSetTab("suppliers");
        break;
      default:
        break;
    }
  };

  return (
    <InventoryWorkspaceShell className="inventory-overview">
      <div className="inventory-enter inventory-enter--1">
        <InventorySearchBar lang={lang} onSearch={(q) => onSetTab("products", { q })} />
      </div>
      <div className="inventory-enter inventory-enter--2">
        <InventoryDashboardCards
          lang={lang}
          stats={stats}
          showInventoryValue={canSeeCost}
          onLowStock={() => onSetTab("products", { stockView: "low" })}
          onOutOfStock={() => onSetTab("products")}
        />
      </div>
      <div className="inventory-enter inventory-enter--3">
        <InventoryQuickActions lang={lang} actions={quickActions} onAction={handleAction} />
      </div>
      <div className="inventory-supporting inventory-enter inventory-enter--4 space-y-3">
        <InventoryOpsBoard
          lang={lang}
          mode={mode}
          stats={stats}
          onPendingPurchases={() => onSetTab("purchases")}
          onTodayPurchases={() => onSetTab("purchases")}
          onSuppliers={() => onSetTab("suppliers")}
          onInventoryAlerts={() => onSetTab("products", { stockView: "low" })}
          onNearExpiry={() => navigate("/pharmacy/expiry")}
          onExpired={() => navigate("/pharmacy/expiry")}
          onBatchIntegrity={() => onSetTab("products")}
          onControlledAlerts={() => navigate("/pharmacy/compliance/register")}
        />
        <InventoryNavigationTiles lang={lang} tiles={navTiles} />
        <InventoryBusinessExtension lang={lang} mode={mode} tiles={extensionTiles} />
        <InventoryStatusStrip lang={lang} />
      </div>
      <StockAdjustmentSheet lang={lang} open={adjustOpen} onClose={() => setAdjustOpen(false)} />
    </InventoryWorkspaceShell>
  );
}
