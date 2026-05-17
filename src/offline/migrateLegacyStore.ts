import type { Customer, Product, Sale, SaleLine } from "../types";
import { getActiveAccountKey } from "./accountScope";

const LEGACY_KEY = "waka-pos-store-v1";
const LEGACY_CLAIMED_FLAG = "waka.legacy.ls.zustand.v1.claimed";

type LegacyItem = {
  id: string;
  name: string;
  category: string;
  sku: string;
  price: number;
  cost: number;
  stock: number;
  lowStockThreshold: number;
  updatedAt: string;
};

type LegacyLine = {
  itemId: string;
  name: string;
  qty: number;
  unitPrice: number;
  lineTotal: number;
};

type LegacySale = {
  id: string;
  lines: LegacyLine[];
  subtotal: number;
  tax: number;
  total: number;
  paymentMethod: string;
  customerId?: string;
  createdAt: string;
};

type LegacyCustomer = {
  id: string;
  name: string;
  phone: string;
  location: string;
  createdAt: string;
};

function mapProduct(i: LegacyItem): Product {
  return {
    id: i.id,
    name: i.name,
    sellingMode: "unit",
    baseUnit: "ea",
    buyingUnit: null,
    conversionRate: null,
    sellingPricePerUnitUgx: i.price,
    costPricePerUnitUgx: i.cost,
    stockOnHand: i.stock,
    minimumStockAlert: i.lowStockThreshold,
    category: i.category,
    sku: i.sku,
    updatedAt: i.updatedAt,
    version: 1,
  };
}

function mapLine(l: LegacyLine): SaleLine {
  const unitCostUgx = 0;
  const estimatedProfitUgx = l.lineTotal - l.qty * unitCostUgx;
  return {
    productId: l.itemId,
    name: l.name,
    inputMode: "quantity",
    quantity: l.qty,
    unitPriceUgx: l.unitPrice,
    unitCostUgx,
    lineTotalUgx: l.lineTotal,
    estimatedProfitUgx,
    moneyAmountUgx: null,
  };
}

function mapSale(s: LegacySale): Sale {
  const lines = s.lines.map(mapLine);
  const subtotal = Math.round(s.subtotal);
  const total = Math.round(s.total);
  return {
    id: s.id,
    lines,
    subtotalUgx: subtotal,
    totalUgx: total,
    cashPaidUgx: total,
    debtUgx: 0,
    estimatedProfitUgx: lines.reduce((acc, line) => acc + line.estimatedProfitUgx, 0),
    createdAt: s.createdAt,
    pendingSync: false,
    lastSyncError: null,
    customerId: s.customerId ?? null,
    soldByUserId: null,
  };
}

function mapCustomer(c: LegacyCustomer): Customer {
  return {
    id: c.id,
    name: c.name,
    phone: c.phone,
    location: c.location,
    createdAt: c.createdAt,
    version: 1,
    debtBalanceUgx: 0,
  };
}

/**
 * One-time read from old zustand persist key into new shapes.
 *
 * Multi-account safety: the legacy localStorage payload is unscoped, so it can
 * belong to at most one account. The first signed-in account to call this
 * function claims the legacy data; subsequent accounts get `null` and start
 * fresh. The claim is recorded in localStorage so the migration is idempotent
 * across reloads.
 */
export function tryMigrateLegacyLocalStorage(): {
  products: Product[];
  customers: Customer[];
  sales: Sale[];
} | null {
  if (typeof window === "undefined") return null;
  const account = getActiveAccountKey();
  if (!account) return null;
  try {
    const claimedRaw = window.localStorage.getItem(LEGACY_CLAIMED_FLAG);
    if (claimedRaw) {
      const claimed = JSON.parse(claimedRaw) as { accountKey?: string };
      if (claimed.accountKey && claimed.accountKey !== account) return null;
      if (claimed.accountKey === account) return null;
    }
    const raw = window.localStorage.getItem(LEGACY_KEY);
    if (!raw) {
      window.localStorage.setItem(LEGACY_CLAIMED_FLAG, JSON.stringify({ accountKey: account, at: new Date().toISOString(), empty: true }));
      return null;
    }
    const parsed = JSON.parse(raw) as { state?: { items?: LegacyItem[]; sales?: LegacySale[]; customers?: LegacyCustomer[] } };
    const st = parsed.state;
    if (!st?.items?.length && !st?.sales?.length && !st?.customers?.length) {
      window.localStorage.setItem(LEGACY_CLAIMED_FLAG, JSON.stringify({ accountKey: account, at: new Date().toISOString(), empty: true }));
      return null;
    }
    window.localStorage.setItem(LEGACY_CLAIMED_FLAG, JSON.stringify({ accountKey: account, at: new Date().toISOString() }));
    return {
      products: (st.items ?? []).map(mapProduct),
      customers: (st.customers ?? []).map(mapCustomer),
      sales: (st.sales ?? []).map(mapSale),
    };
  } catch {
    return null;
  }
}

export function clearLegacyLocalStorage(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(LEGACY_KEY);
  } catch {
    /* ignore */
  }
}
