import type { LucideIcon } from "lucide-react";
import {
  ArrowLeftRight,
  AlertTriangle,
  BarChart3,
  ClipboardList,
  FolderOpen,
  History,
  Package,
  Receipt,
  Scale,
  Shield,
  Tag,
  Truck,
  Users,
  UtensilsCrossed,
  Upload,
  Warehouse,
} from "lucide-react";
import type { BusinessType, Permission } from "../types";
import { isHospitalityMode } from "./hospitality";
import { isPharmacyMode } from "./pharmacy";
import { isWholesaleMode } from "./wholesale";

export type InventoryWorkspaceMode = "retail" | "pharmacy" | "wholesale" | "hospitality";

export type InventoryWorkspaceTile = {
  id: string;
  labelKey: string;
  Icon: LucideIcon;
  href: string;
  perm?: Permission;
  badge?: number;
};

export type InventoryQuickActionDef = {
  id: string;
  labelKey: string;
  Icon: LucideIcon;
  href?: string;
  actionId?: string;
  perm?: Permission;
  primary?: boolean;
};

export function inventoryWorkspaceMode(
  businessType: BusinessType,
  pharmacyModeEnabled?: boolean,
): InventoryWorkspaceMode {
  if (isPharmacyMode(businessType, pharmacyModeEnabled)) return "pharmacy";
  if (isHospitalityMode(businessType)) return "hospitality";
  if (isWholesaleMode(businessType)) return "wholesale";
  return "retail";
}

export function inventoryWorkspaceBasePath(mode: InventoryWorkspaceMode): string {
  return mode === "pharmacy" ? "/pharmacy/inventory" : "/stock";
}

/**
 * Stock Transfer UI is productionized (MB-4C) on the deployed migration 167 engine.
 * Keep gated by `enterprise.transfers` on tiles and routes.
 */
export const INVENTORY_TRANSFER_ENABLED = true;

function tabHref(base: string, tab: string, extra?: Record<string, string>): string {
  const p = new URLSearchParams({ tab, ...extra });
  return `${base}?${p.toString()}`;
}

/** Hub directory — completed destinations only (Phase 27.1). */
export function resolveInventoryNavTiles(
  mode: InventoryWorkspaceMode,
  basePath: string,
): InventoryWorkspaceTile[] {
  const tiles: InventoryWorkspaceTile[] = [
    { id: "products", labelKey: "iwNavProducts", Icon: Package, href: tabHref(basePath, "products"), perm: "stock.view" },
    {
      id: "purchases",
      labelKey: "iwNavPurchases",
      Icon: Receipt,
      href: tabHref(basePath, "purchases"),
      perm: "purchases.view",
    },
    {
      id: "count",
      labelKey: "iwNavInventoryCount",
      Icon: ClipboardList,
      href: "/stock/count",
      perm: "stock.count",
    },
    {
      id: "movements",
      labelKey: "iwNavMovements",
      Icon: History,
      href: tabHref(basePath, "products", { stockView: "movements" }),
      perm: "stock.view",
    },
    {
      id: "categories",
      labelKey: "iwNavCategories",
      Icon: FolderOpen,
      href: tabHref(basePath, "products", { stockView: "shelves" }),
      perm: "stock.view",
    },
    {
      id: "suppliers",
      labelKey: "iwNavSuppliers",
      Icon: Users,
      href: tabHref(basePath, "suppliers"),
      perm: "suppliers.view",
    },
    {
      id: "reports",
      labelKey: "iwNavReports",
      Icon: BarChart3,
      href: mode === "pharmacy" ? "/pharmacy/reports/inventory" : "/reports",
      perm: "reports.view",
    },
  ];
  if (INVENTORY_TRANSFER_ENABLED) {
    tiles.splice(3, 0, {
      id: "transfer",
      labelKey: "iwNavTransfer",
      Icon: ArrowLeftRight,
      href: "/stock/transfer",
      perm: "enterprise.transfers",
    });
  }
  if (mode === "wholesale") {
    return tiles.map((t) =>
      t.id === "products" ? { ...t, labelKey: "iwNavBulkStock", Icon: Warehouse } : t,
    );
  }
  return tiles;
}

/** Overview primary actions — ≤2 taps for receive / add / adjust / count. */
export function resolveInventoryOverviewQuickActions(_mode: InventoryWorkspaceMode): InventoryQuickActionDef[] {
  const actions: InventoryQuickActionDef[] = [
    {
      id: "receive",
      labelKey: "ipActionReceiveStock",
      Icon: Truck,
      actionId: "receiveStock",
      perm: "purchases.record",
      primary: true,
    },
    {
      id: "newProduct",
      labelKey: "stockAddProductBtn",
      Icon: Package,
      actionId: "newProduct",
      perm: "products.add",
      primary: true,
    },
    {
      id: "importCsv",
      labelKey: "stockQuickImportCsv",
      Icon: Upload,
      actionId: "importCsv",
      perm: "products.add",
      primary: true,
    },
    {
      id: "adjust",
      labelKey: "iwQuickAdjustStock",
      Icon: Scale,
      actionId: "adjustStock",
      perm: "stock.adjust",
    },
    {
      id: "count",
      labelKey: "iwNavInventoryCount",
      Icon: ClipboardList,
      href: "/stock/count",
      perm: "stock.count",
    },
  ];
  if (INVENTORY_TRANSFER_ENABLED) {
    actions.push({
      id: "transfer",
      labelKey: "iwQuickTransfer",
      Icon: ArrowLeftRight,
      href: "/stock/transfer",
      perm: "enterprise.transfers",
    });
  }
  return actions;
}

export function resolveInventoryQuickActions(mode: InventoryWorkspaceMode): InventoryQuickActionDef[] {
  const shared: InventoryQuickActionDef[] = [
    {
      id: "receive",
      labelKey: "ipActionReceiveStock",
      Icon: Truck,
      actionId: "receiveStock",
      perm: "purchases.record",
      primary: true,
    },
    {
      id: "newProduct",
      labelKey: "stockAddProductBtn",
      Icon: Package,
      actionId: "newProduct",
      perm: "products.add",
      primary: true,
    },
    {
      id: "count",
      labelKey: "iwNavInventoryCount",
      Icon: ClipboardList,
      href: "/stock/count",
      perm: "stock.count",
    },
    {
      id: "adjust",
      labelKey: "iwQuickAdjustStock",
      Icon: Scale,
      actionId: "adjustStock",
      perm: "stock.adjust",
    },
    {
      id: "purchases",
      labelKey: "iwNavPurchases",
      Icon: Receipt,
      actionId: "viewPurchases",
      perm: "purchases.view",
    },
    {
      id: "suppliers",
      labelKey: "iwNavSuppliers",
      Icon: Users,
      actionId: "viewSuppliers",
      perm: "suppliers.view",
    },
  ];
  if (INVENTORY_TRANSFER_ENABLED) {
    shared.splice(4, 0, {
      id: "transfer",
      labelKey: "iwQuickTransfer",
      Icon: ArrowLeftRight,
      href: "/stock/transfer",
      perm: "enterprise.transfers",
    });
  }

  if (mode !== "pharmacy") return shared;

  return [
    ...shared,
    {
      id: "expiry",
      labelKey: "pharmacyExpiryCenterTitle",
      Icon: AlertTriangle,
      href: "/pharmacy/expiry",
      perm: "stock.view",
    },
    {
      id: "compliance",
      labelKey: "pharmacyComplianceRegisterTitle",
      Icon: Shield,
      href: "/pharmacy/compliance/register",
      perm: "pharmacy.access",
    },
  ];
}

/**
 * Mode extensions that map to real screens only (Phase 27.1).
 * Placeholder / duplicate-of-products tiles are omitted.
 */
export function resolveInventoryExtensionTiles(
  mode: InventoryWorkspaceMode,
  _basePath: string,
  badges?: Partial<Record<string, number>>,
): InventoryWorkspaceTile[] {
  switch (mode) {
    case "pharmacy":
      return [
        {
          id: "expiry",
          labelKey: "pharmacyExpiryCenterTitle",
          Icon: AlertTriangle,
          href: "/pharmacy/expiry",
          perm: "stock.view",
          badge: badges?.nearExpiry,
        },
        {
          id: "compliance",
          labelKey: "pharmacyComplianceRegisterTitle",
          Icon: Shield,
          href: "/pharmacy/compliance/register",
          perm: "pharmacy.access",
          badge: badges?.controlledAlerts,
        },
      ];
    case "retail":
      return [
        {
          id: "shelfLabels",
          labelKey: "iwExtShelfLabels",
          Icon: Tag,
          href: "/settings/shelves",
          perm: "settings.shop",
        },
      ];
    case "hospitality":
      return [
        {
          id: "recipeInventory",
          labelKey: "iwExtRecipeInventory",
          Icon: UtensilsCrossed,
          href: "/settings/menu",
          perm: "settings.shop",
        },
      ];
    case "wholesale":
      return [];
  }
  return [];
}

export function inventoryExtensionSectionTitleKey(mode: InventoryWorkspaceMode): string | null {
  switch (mode) {
    case "pharmacy":
      return "iwExtSectionPharmacy";
    case "retail":
      return "iwExtSectionRetail";
    case "hospitality":
      return "iwExtSectionHospitality";
    case "wholesale":
      return "iwExtSectionWholesale";
    default:
      return null;
  }
}
