import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useShallow } from "zustand/react/shallow";
import type { Language } from "../../../types";
import { usePosStore } from "../../../store/usePosStore";
import { useSessionActor } from "../../../context/SessionActorContext";
import {
  inventoryWorkspaceMode,
  resolveInventoryOverviewQuickActions,
} from "../../../lib/inventoryWorkspaceTiles";
import { computeInventoryWorkspaceDashboardStats } from "../../../lib/inventoryWorkspaceStats";
import { InventoryWorkspaceShell } from "./InventoryWorkspaceShell";
import { InventorySearchBar } from "./InventorySearchBar";
import { InventoryDashboardCards } from "./InventoryDashboardCards";
import { InventoryQuickActions } from "./InventoryQuickActions";
import { InventoryStatusStrip } from "./InventoryStatusStrip";
import { StockAdjustmentSheet } from "../../stock/StockAdjustmentSheet";
import type { InventoryPurchasingTab } from "../../../features/inventory-purchasing/types";

type Props = {
  lang: Language;
  onSetTab: (tab: InventoryPurchasingTab, extra?: Record<string, string | null>) => void;
  onReceiveStock: () => void;
};

export function InventoryWorkspaceOverview({ lang, onSetTab, onReceiveStock }: Props) {
  const navigate = useNavigate();
  const actor = useSessionActor();
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

  const stats = useMemo(
    () =>
      computeInventoryWorkspaceDashboardStats({
        products,
        purchases,
        supplierPayments,
        suppliers,
        businessType: preferences.businessType,
        pharmacyModeEnabled: preferences.pharmacyModeEnabled,
        complianceAlertCount: pharmacyComplianceAlerts.length,
      }),
    [products, purchases, supplierPayments, suppliers, preferences.businessType, preferences.pharmacyModeEnabled, pharmacyComplianceAlerts.length],
  );

  const quickActions = useMemo(() => resolveInventoryOverviewQuickActions(mode), [mode]);

  const [adjustOpen, setAdjustOpen] = useState(false);

  const handleAction = (actionId: string) => {
    switch (actionId) {
      case "receiveStock":
        onReceiveStock();
        break;
      case "adjustStock":
        setAdjustOpen(true);
        break;
      default:
        break;
    }
  };

  return (
    <InventoryWorkspaceShell>
      <InventorySearchBar lang={lang} onSearch={(q) => onSetTab("products", { q })} />
      <InventoryDashboardCards
        lang={lang}
        mode={mode}
        stats={stats}
        onLowStock={() => onSetTab("products", { stockView: "low" })}
        onOutOfStock={() => onSetTab("products")}
        onPendingPurchases={() => onSetTab("purchases")}
        onTodayPurchases={() => onSetTab("purchases")}
        onSuppliers={() => onSetTab("suppliers")}
        onInventoryAlerts={() => onSetTab("products", { stockView: "low" })}
        onNearExpiry={() => navigate("/pharmacy/expiry")}
        onExpired={() => navigate("/pharmacy/expiry")}
        onBatchIntegrity={() => onSetTab("products")}
        onControlledAlerts={() => navigate("/pharmacy/compliance/register")}
      />
      <InventoryQuickActions lang={lang} role={actor.role} actions={quickActions} onAction={handleAction} />
      <InventoryStatusStrip lang={lang} />
      <StockAdjustmentSheet lang={lang} open={adjustOpen} onClose={() => setAdjustOpen(false)} />
    </InventoryWorkspaceShell>
  );
}
