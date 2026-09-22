export const SHOP_CONSOLE_TABS = [
  "summary",
  "support",
  "devices",
  "account",
  "history",
  "platform",
  "advanced",
] as const;

export type ShopConsoleTab = (typeof SHOP_CONSOLE_TABS)[number];

const TAB_SET = new Set<string>(SHOP_CONSOLE_TABS);

export function isShopConsoleTab(value: string | null | undefined): value is ShopConsoleTab {
  return Boolean(value && TAB_SET.has(value));
}

/** Legacy rescue hash anchors → unified console tabs */
export const RESCUE_HASH_TO_TAB: Record<string, ShopConsoleTab> = {
  health: "summary",
  owner: "summary",
  recovery: "account",
  sync: "advanced",
  inventory: "advanced",
  devices: "devices",
  financial: "advanced",
  audit: "history",
  import: "advanced",
  actions: "support",
};

const LEGACY_TAB_MAP: Record<string, ShopConsoleTab> = {
  overview: "summary",
  business: "account",
  subscriptions: "account",
  activity: "history",
  audit: "history",
  security: "account",
  developer: "advanced",
  ai: "platform",
  vision: "platform",
};

export function shopConsoleTabFromLocation(search: string, hash: string, shopId?: string): ShopConsoleTab {
  const q = new URLSearchParams(search);
  const tabParam = q.get("tab");
  if (isShopConsoleTab(tabParam)) return tabParam;
  if (tabParam && LEGACY_TAB_MAP[tabParam]) return LEGACY_TAB_MAP[tabParam];

  const hashId = hash.replace(/^#/, "").trim();
  if (hashId && RESCUE_HASH_TO_TAB[hashId]) return RESCUE_HASH_TO_TAB[hashId];

  if (shopId) {
    const stored = readShopConsoleTab(shopId);
    if (stored) return stored;
  }
  return "summary";
}

function tabStorageKey(shopId: string): string {
  return `waka.admin.shop.${shopId}.tab`;
}

export function readShopConsoleTab(shopId?: string): ShopConsoleTab | null {
  try {
    const raw = sessionStorage.getItem(shopId ? tabStorageKey(shopId) : "waka.admin.shop.tab");
    return isShopConsoleTab(raw) ? raw : null;
  } catch {
    return null;
  }
}

export function persistShopConsoleTab(shopId: string, tab: ShopConsoleTab): void {
  try {
    sessionStorage.setItem(tabStorageKey(shopId), tab);
    sessionStorage.setItem("waka.admin.shop.lastId", shopId);
  } catch {
    /* ignore quota */
  }
}

export function shopConsoleTabHref(shopId: string, tab: ShopConsoleTab, previewMode: boolean): string {
  const base = `/internal/waka/shop/${shopId}?tab=${tab}`;
  if (!previewMode) return base;
  return `${base}&preview=1`;
}
