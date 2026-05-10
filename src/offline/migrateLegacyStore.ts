import type { Customer, Product, Sale, SaleLine } from "../types";

const LEGACY_KEY = "waka-pos-store-v1";

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
  return {
    productId: l.itemId,
    name: l.name,
    inputMode: "quantity",
    quantity: l.qty,
    unitPriceUgx: l.unitPrice,
    lineTotalUgx: l.lineTotal,
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
    estimatedProfitUgx: lines.reduce((acc, line) => {
      return acc + (line.lineTotalUgx - line.quantity * 0);
    }, 0),
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

/** One-time read from old zustand persist key into new shapes */
export function tryMigrateLegacyLocalStorage(): {
  products: Product[];
  customers: Customer[];
  sales: Sale[];
} | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(LEGACY_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { state?: { items?: LegacyItem[]; sales?: LegacySale[]; customers?: LegacyCustomer[] } };
    const st = parsed.state;
    if (!st?.items?.length && !st?.sales?.length && !st?.customers?.length) return null;
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
