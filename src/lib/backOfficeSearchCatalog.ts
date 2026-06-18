import type { Permission, ShopPreferences, UserRole } from "../types";
import type { SubscriptionSnapshot } from "./subscriptionEntitlements";
import { canUseBackupRestore, hasEffectivePermission } from "./subscriptionEntitlements";
import { isHospitalityMode } from "./hospitality";
import { isPharmacyMode } from "./pharmacy";
import { isWholesaleMode } from "./wholesale";
import { Capacitor } from "@capacitor/core";

export type BackOfficeSearchEntryDef = {
  id: string;
  path: string;
  titleKey: string;
  subtitleKey?: string;
  sectionKey: string;
  perm?: Permission;
  /** Extra words users might type (English + common shortcuts). */
  keywords?: string[];
  /** Only show in these business modes (omit = all). */
  modes?: Array<"pharmacy" | "hospitality" | "wholesale">;
  requiresBackup?: boolean;
  requiresCapacitor?: boolean;
};

export type ResolvedBackOfficeSearchEntry = {
  id: string;
  path: string;
  title: string;
  subtitle: string;
  section: string;
  haystack: string;
};

const CATALOG: BackOfficeSearchEntryDef[] = [
  { id: "shop-hub", path: "/office", titleKey: "officeHubNav", subtitleKey: "officeHubSub", sectionKey: "officeSectionDaily", keywords: ["shop", "office", "hub", "home"] },
  { id: "stock", path: "/stock", titleKey: "officeCardStock", subtitleKey: "officeCardStockSub", sectionKey: "officeSectionDaily", perm: "stock.view", keywords: ["inventory", "products", "items", "medicine", "warehouse"] },
  { id: "shelf-arrange", path: "/settings/shelves", titleKey: "officeCardShelfArrange", subtitleKey: "officeCardShelfArrangeSub", sectionKey: "settingsHubGroupApp", perm: "shelves.customize", keywords: ["shelf", "arrange", "order", "sell", "category", "drag", "customize"] },
  { id: "restock", path: "/restock", titleKey: "officeCardRestock", subtitleKey: "officeCardRestockSub", sectionKey: "officeSectionDaily", perm: "purchases.record", keywords: ["purchase", "buy", "stock in"] },
  { id: "suppliers", path: "/suppliers", titleKey: "officeCardSuppliers", subtitleKey: "officeCardSuppliersSub", sectionKey: "officeSectionDaily", perm: "suppliers.view", keywords: ["vendor", "supplier"] },
  { id: "purchases", path: "/office/purchases", titleKey: "officeCardPurchases", subtitleKey: "officeCardPurchasesSub", sectionKey: "officeSectionDaily", perm: "purchases.view", keywords: ["purchase history", "orders"] },
  { id: "customers", path: "/customers", titleKey: "customers", subtitleKey: "officeCardCustomersSub", sectionKey: "officeSectionDaily", perm: "customers.view", keywords: ["customer", "patient", "account", "debtor"] },
  { id: "debts", path: "/debts", titleKey: "debts", subtitleKey: "debtsHelp", sectionKey: "officeSectionDaily", perm: "customers.view", keywords: ["debt", "credit", "owe", "loan"] },
  { id: "cash-expenses", path: "/cash-expenses", titleKey: "officeCardCashExpenses", subtitleKey: "officeCardCashExpensesSub", sectionKey: "officeSectionDaily", keywords: ["expense", "petty cash", "drawer"] },
  { id: "day-open", path: "/office/day-open", titleKey: "dayOpenTitle", subtitleKey: "dayOpenSub", sectionKey: "officeSectionDaily", perm: "day.open_drawer", keywords: ["open", "float", "drawer", "day"] },
  { id: "cash-position", path: "/office/cash-position", titleKey: "officeCardCashPosition", subtitleKey: "officeCardCashPositionSub", sectionKey: "officeSectionDaily", perm: "day.close", keywords: ["cash", "drawer", "till"] },
  { id: "close-day", path: "/close-day", titleKey: "officeCardCloseDay", subtitleKey: "officeCardCloseDaySub", sectionKey: "officeSectionDaily", perm: "day.close", keywords: ["close", "end day", "z-report"] },
  { id: "kitchen", path: "/kitchen", titleKey: "navKitchen", subtitleKey: "officeCardKitchenSub", sectionKey: "officeSectionDaily", perm: "hospitality.kitchen", modes: ["hospitality"], keywords: ["kitchen", "kds", "orders"] },
  { id: "pending-sales", path: "/pending-sales", titleKey: "pendingSalesTitle", subtitleKey: "pendingSalesSub", sectionKey: "officeSectionDaily", perm: "pending_sales.manage", modes: ["hospitality"], keywords: ["pending", "hold", "table"] },
  { id: "floor", path: "/settings/floor", titleKey: "floorSetupTitle", subtitleKey: "floorSetupSub", sectionKey: "settingsHubGroupShop", perm: "hospitality.floor", modes: ["hospitality"], keywords: ["floor", "tables", "layout"] },
  { id: "pharmacy-settings", path: "/settings/pharmacy", titleKey: "settingsHubPharmacy", subtitleKey: "settingsHubPharmacySub", sectionKey: "settingsHubGroupShop", perm: "settings.shop", modes: ["pharmacy"], keywords: ["pharmacy", "medicine", "drug"] },
  { id: "reports", path: "/reports", titleKey: "officeCardReports", subtitleKey: "officeCardReportsSub", sectionKey: "officeSectionInsights", perm: "reports.view", keywords: ["report", "sales", "analytics"] },
  { id: "monthly-reports", path: "/office/monthly-reports", titleKey: "officeCardReportsMonthlyNested", subtitleKey: "officeCardReportsSub", sectionKey: "officeSectionInsights", perm: "reports.view", keywords: ["monthly", "month"] },
  { id: "profit", path: "/office/profit", titleKey: "officeCardProfit", subtitleKey: "officeCardProfitSub", sectionKey: "officeSectionInsights", perm: "reports.profit", keywords: ["profit", "margin", "money"] },
  { id: "pharmacy-margins", path: "/office/pharmacy-margins", titleKey: "officeCardPharmacyMargin", subtitleKey: "officeCardPharmacyMarginSub", sectionKey: "officeSectionInsights", perm: "reports.profit", modes: ["pharmacy"], keywords: ["margin", "markup"] },
  { id: "owner", path: "/owner", titleKey: "officeCardOwner", subtitleKey: "officeCardOwnerSub", sectionKey: "officeSectionInsights", perm: "owner.dashboard", keywords: ["owner", "dashboard", "overview"] },
  { id: "audit", path: "/office/audit-center", titleKey: "officeCardAuditCenter", subtitleKey: "officeCardAuditCenterSub", sectionKey: "officeSectionInsights", perm: "owner.activity", keywords: ["audit", "investigation", "trace"] },
  { id: "activity", path: "/owner/activity", titleKey: "officeCardActivity", subtitleKey: "officeCardActivitySub", sectionKey: "officeSectionInsights", perm: "owner.activity", keywords: ["activity", "log", "history"] },
  { id: "receipts", path: "/receipts", titleKey: "receipts", subtitleKey: "officeCardReportsSub", sectionKey: "officeSectionInsights", perm: "receipts.view", keywords: ["receipt", "invoice", "sales history"] },
  { id: "staff", path: "/staff-access", titleKey: "officeCardStaffAccess", subtitleKey: "officeCardStaffAccessSub", sectionKey: "settingsHubGroupShop", perm: "settings.shop", keywords: ["staff", "user", "pin", "role", "cashier"] },
  { id: "settings", path: "/settings", titleKey: "settingsHubTitle", subtitleKey: "settingsHubSub", sectionKey: "settingsHubTitle", perm: "settings.view", keywords: ["settings", "config", "preferences"] },
  { id: "backup", path: "/office/backup", titleKey: "officeCardBackup", subtitleKey: "officeCardBackupSub", sectionKey: "officeSectionData", perm: "settings.view", requiresBackup: true, keywords: ["backup", "upload", "sync", "cloud", "save"] },
  { id: "hardware", path: "/office/hardware", titleKey: "officeCardHardware", subtitleKey: "officeCardHardwareSub", sectionKey: "settingsHubGroupShop", keywords: ["printer", "barcode", "scanner", "hardware"] },
  { id: "settings-shop", path: "/settings/shop", titleKey: "settingsHubShop", subtitleKey: "settingsHubShopSub", sectionKey: "settingsHubGroupShop", perm: "settings.shop", keywords: ["shop name", "business", "profile"] },
  { id: "settings-receipt", path: "/settings/receipt", titleKey: "settingsHubReceipt", subtitleKey: "settingsHubReceiptSub", sectionKey: "settingsHubGroupShop", perm: "settings.receipt", keywords: ["receipt", "print", "header", "footer"] },
  { id: "settings-selling", path: "/settings/selling", titleKey: "settingsHubSelling", subtitleKey: "settingsHubSellingSub", sectionKey: "settingsHubGroupShop", perm: "settings.shop", keywords: ["sell", "pos", "quick sell"] },
  { id: "settings-devices", path: "/settings/devices", titleKey: "settingsHubDevices", subtitleKey: "settingsHubDevicesSub", sectionKey: "settingsHubGroupShop", perm: "settings.devices", keywords: ["device", "tablet", "phone"] },
  { id: "settings-pin", path: "/settings/pin", titleKey: "settingsHubPin", subtitleKey: "settingsHubPinSub", sectionKey: "settingsHubGroupShop", perm: "settings.shop", keywords: ["pin", "lock", "password"] },
  { id: "settings-password", path: "/settings/password", titleKey: "settingsHubPassword", subtitleKey: "settingsHubPasswordSub", sectionKey: "settingsHubGroupShop", perm: "settings.shop", keywords: ["password", "login"] },
  { id: "settings-notifications", path: "/settings/notifications", titleKey: "settingsHubNotifications", subtitleKey: "settingsHubNotificationsSub", sectionKey: "settingsHubGroupApp", perm: "settings.view", keywords: ["notification", "alert"] },
  { id: "settings-health", path: "/settings/health", titleKey: "settingsHubSystemHealth", subtitleKey: "settingsHubSystemHealthSub", sectionKey: "settingsHubGroupApp", perm: "settings.shop", keywords: ["health", "diagnostic", "status"] },
  { id: "settings-diagnostics", path: "/settings/diagnostics", titleKey: "settingsHubDiagnostics", subtitleKey: "settingsHubDiagnosticsSub", sectionKey: "settingsHubGroupApp", perm: "settings.shop", requiresCapacitor: true, keywords: ["diagnostics", "debug"] },
  { id: "settings-retention", path: "/settings/retention", titleKey: "settingsHubRetention", subtitleKey: "settingsHubRetentionSub", sectionKey: "settingsHubGroupApp", perm: "settings.shop", keywords: ["archive", "retention", "delete old"] },
  { id: "settings-hospitality", path: "/settings/hospitality", titleKey: "hospitalitySettingsTitle", subtitleKey: "hospitalitySettingsSub", sectionKey: "settingsHubGroupShop", perm: "settings.shop", modes: ["hospitality"], keywords: ["restaurant", "hotel", "hospitality"] },
  { id: "upgrade", path: "/upgrade", titleKey: "officeCardPlans", subtitleKey: "officeCardPlansSub", sectionKey: "officeSectionHelp", keywords: ["plan", "subscription", "upgrade", "premium"] },
  { id: "support", path: "/support", titleKey: "officeCardSupport", subtitleKey: "officeCardSupportSubDiagnostics", sectionKey: "officeSectionHelp", keywords: ["help", "support", "contact"] },
  { id: "account", path: "/office/account", titleKey: "officeCardAccount", subtitleKey: "officeCardAccountSub", sectionKey: "officeSectionHelp", keywords: ["account", "profile", "user"] },
];

type BuildCtx = {
  lang: import("../types").Language;
  role: UserRole;
  preferences: ShopPreferences;
  snapshot: SubscriptionSnapshot | null;
  authMode: "supabase" | "local";
  t: (key: string) => string;
  canRecordExpense: boolean;
};

const EMPTY_SNAPSHOT: SubscriptionSnapshot = { kind: "none" };

function activeModes(preferences: ShopPreferences): Set<string> {
  const modes = new Set<string>(["retail"]);
  if (isPharmacyMode(preferences.businessType, preferences.pharmacyModeEnabled)) modes.add("pharmacy");
  if (isHospitalityMode(preferences.businessType, preferences.hospitalityModeEnabled)) modes.add("hospitality");
  if (isWholesaleMode(preferences.businessType)) modes.add("wholesale");
  return modes;
}

function entryVisible(def: BackOfficeSearchEntryDef, ctx: BuildCtx): boolean {
  const modes = activeModes(ctx.preferences);
  if (def.modes?.length && !def.modes.some((m) => modes.has(m))) return false;
  if (def.id === "debts" && (modes.has("pharmacy") || modes.has("hospitality") || modes.has("wholesale"))) return false;
  if (def.perm && !hasEffectivePermission(ctx.role, def.perm, ctx.snapshot ?? EMPTY_SNAPSHOT, ctx.authMode)) return false;
  if (def.requiresBackup && !canUseBackupRestore(ctx.snapshot ?? EMPTY_SNAPSHOT, ctx.authMode)) return false;
  if (def.requiresCapacitor && !Capacitor.isNativePlatform()) return false;
  if (def.id === "cash-expenses" && !ctx.canRecordExpense) return false;
  return true;
}

export function buildBackOfficeSearchCatalog(ctx: BuildCtx): ResolvedBackOfficeSearchEntry[] {
  return CATALOG.filter((def) => entryVisible(def, ctx)).map((def) => {
    const title = ctx.t(def.titleKey);
    const subtitle = def.subtitleKey ? ctx.t(def.subtitleKey) : "";
    const section = ctx.t(def.sectionKey);
    const haystack = [title, subtitle, section, ...(def.keywords ?? [])].join(" ").toLowerCase();
    return { id: def.id, path: def.path, title, subtitle, section, haystack };
  });
}

function normalizeQuery(q: string): string {
  return q.toLowerCase().trim().replace(/\s+/g, " ");
}

/** Partial / few-letter match across title, subtitle, keywords. */
export function filterBackOfficeSearch(
  entries: ResolvedBackOfficeSearchEntry[],
  query: string,
  max = 14,
): ResolvedBackOfficeSearchEntry[] {
  const q = normalizeQuery(query);
  if (!q) return [];

  const scored = entries
    .map((entry) => {
      const h = entry.haystack;
      if (h.includes(q)) return { entry, score: 100 - h.indexOf(q) };
      const tokens = q.split(/\s+/).filter(Boolean);
      let score = 0;
      for (const tok of tokens) {
        if (h.includes(tok)) {
          score += 50;
          continue;
        }
        const wordHit = h.split(/\s+/).some((w) => w.startsWith(tok));
        if (wordHit) {
          score += 30;
          continue;
        }
        return null;
      }
      return score > 0 ? { entry, score } : null;
    })
    .filter((x): x is { entry: ResolvedBackOfficeSearchEntry; score: number } => x != null);

  scored.sort((a, b) => b.score - a.score || a.entry.title.localeCompare(b.entry.title));
  return scored.slice(0, max).map((s) => s.entry);
}
