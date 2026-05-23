import { create } from "zustand";
import { persist, createJSONStorage, type StateStorage } from "zustand/middleware";
import { get as idbGet, set as idbSet, del as idbDel } from "idb-keyval";

// ---------- Types ----------
export type PayMethod = "cash" | "momo" | "credit";

export interface Product {
  id: string;
  name: string;
  price: number; // UGX per unit
  stock: number; // units remaining
  category?: string;
  barcode?: string;
  createdAt: number;
}

export interface CartItem {
  productId: string;
  name: string;
  price: number;
  qty: number;
}

export interface Customer {
  id: string;
  name: string;
  phone?: string;
  balance: number; // positive = owes the shop (debt)
  createdAt: number;
}

export interface Sale {
  id: string;
  items: CartItem[];
  total: number;
  method: PayMethod;
  customerId?: string;
  customerName?: string;
  createdAt: number;
}

export interface Supplier {
  id: string;
  name: string;
  phone?: string;
  balance: number; // positive = shop owes the supplier
  createdAt: number;
}

export interface SupplierEntry {
  id: string;
  supplierId: string;
  supplierName: string;
  type: "purchase" | "payment";
  amount: number;
  note?: string;
  createdAt: number;
}

export interface DaySession {
  id: string;
  openedAt: number;
  openingFloat: number;
  closedAt?: number;
  countedCash?: number;
  expectedCash?: number;
  variance?: number;
  note?: string;
}

export type CashKind = "expense" | "cash_in" | "cash_out";
export type CashMethod = "cash" | "momo" | "bank";

export interface CashEntry {
  id: string;
  kind: CashKind;
  category?: string;
  method: CashMethod;
  amount: number;
  note?: string;
  createdAt: number;
}

export type PlanId = "free" | "starter" | "business" | "waka_plus";

export interface ShopProfile {
  shopName?: string;
  ownerName?: string;
  phone?: string;
  plan: PlanId;
}

export const PLAN_LIMITS: Record<PlanId, { products: number | null; label: string; price: string }> = {
  free: { products: 10, label: "Free", price: "UGX 0" },
  starter: { products: 100, label: "Starter", price: "UGX 15,000/mo" },
  business: { products: 1000, label: "Business", price: "UGX 45,000/mo" },
  waka_plus: { products: null, label: "Waka Plus", price: "UGX 120,000/mo" },
};

// ---------- IDB storage adapter ----------
const idbStorage: StateStorage = {
  getItem: async (name) => (await idbGet(name)) ?? null,
  setItem: async (name, value) => {
    await idbSet(name, value);
  },
  removeItem: async (name) => {
    await idbDel(name);
  },
};

// ---------- Store ----------
interface POSState {
  products: Product[];
  customers: Customer[];
  sales: Sale[];
  cart: CartItem[];
  suppliers: Supplier[];
  supplierEntries: SupplierEntry[];
  daySessions: DaySession[];
  cashEntries: CashEntry[];
  profile: ShopProfile;

  // products
  addProduct: (p: Omit<Product, "id" | "createdAt">) => void;
  updateProduct: (id: string, patch: Partial<Product>) => void;
  removeProduct: (id: string) => void;

  // cart
  addToCart: (productId: string) => void;
  setCartQty: (productId: string, qty: number) => void;
  removeFromCart: (productId: string) => void;
  clearCart: () => void;

  // customers
  addCustomer: (c: Omit<Customer, "id" | "createdAt" | "balance"> & { balance?: number }) => Customer;
  payDebt: (customerId: string, amount: number) => void;

  // suppliers
  addSupplier: (s: Omit<Supplier, "id" | "createdAt" | "balance"> & { balance?: number }) => Supplier;
  recordSupplierEntry: (supplierId: string, type: "purchase" | "payment", amount: number, note?: string) => void;

  // day sessions
  openDay: (openingFloat: number) => DaySession;
  closeDay: (countedCash: number, note?: string) => DaySession | null;
  currentDay: () => DaySession | undefined;

  // cash entries (expenses, cash in/out)
  addCashEntry: (e: Omit<CashEntry, "id" | "createdAt">) => CashEntry;
  removeCashEntry: (id: string) => void;


  // profile
  updateProfile: (patch: Partial<ShopProfile>) => void;

  // sales
  checkout: (method: PayMethod, customerId?: string) => Sale | null;

  // demo seed
  seedDemo: () => void;
}

const newId = () => {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  // RFC4122 v4 fallback
  const hex = "0123456789abcdef";
  let s = "";
  for (let i = 0; i < 36; i++) {
    if (i === 8 || i === 13 || i === 18 || i === 23) s += "-";
    else if (i === 14) s += "4";
    else if (i === 19) s += hex[(Math.random() * 4) | 0 | 8];
    else s += hex[(Math.random() * 16) | 0];
  }
  return s;
};

export const usePOS = create<POSState>()(
  persist(
    (set, get) => ({
      products: [],
      customers: [],
      sales: [],
      cart: [],
      suppliers: [],
      supplierEntries: [],
      daySessions: [],
      cashEntries: [],
      profile: { plan: "free" },

      addProduct: (p) =>
        set((s) => ({
          products: [
            { ...p, id: newId(), createdAt: Date.now() },
            ...s.products,
          ],
        })),
      updateProduct: (id, patch) =>
        set((s) => ({
          products: s.products.map((p) => (p.id === id ? { ...p, ...patch } : p)),
        })),
      removeProduct: (id) =>
        set((s) => ({ products: s.products.filter((p) => p.id !== id) })),

      addToCart: (productId) => {
        const product = get().products.find((p) => p.id === productId);
        if (!product) return;
        set((s) => {
          const existing = s.cart.find((c) => c.productId === productId);
          if (existing) {
            return {
              cart: s.cart.map((c) =>
                c.productId === productId ? { ...c, qty: c.qty + 1 } : c,
              ),
            };
          }
          return {
            cart: [
              ...s.cart,
              {
                productId,
                name: product.name,
                price: product.price,
                qty: 1,
              },
            ],
          };
        });
      },
      setCartQty: (productId, qty) =>
        set((s) => ({
          cart:
            qty <= 0
              ? s.cart.filter((c) => c.productId !== productId)
              : s.cart.map((c) =>
                  c.productId === productId ? { ...c, qty } : c,
                ),
        })),
      removeFromCart: (productId) =>
        set((s) => ({ cart: s.cart.filter((c) => c.productId !== productId) })),
      clearCart: () => set({ cart: [] }),

      addCustomer: (c) => {
        const created: Customer = {
          id: newId(),
          name: c.name,
          phone: c.phone,
          balance: c.balance ?? 0,
          createdAt: Date.now(),
        };
        set((s) => ({ customers: [created, ...s.customers] }));
        return created;
      },
      payDebt: (customerId, amount) =>
        set((s) => ({
          customers: s.customers.map((c) =>
            c.id === customerId
              ? { ...c, balance: Math.max(0, c.balance - amount) }
              : c,
          ),
        })),

      checkout: (method, customerId) => {
        const { cart, products, customers } = get();
        if (cart.length === 0) return null;
        const total = cart.reduce((sum, i) => sum + i.price * i.qty, 0);
        const customer = customerId
          ? customers.find((c) => c.id === customerId)
          : undefined;

        const sale: Sale = {
          id: newId(),
          items: cart,
          total,
          method,
          customerId: customer?.id,
          customerName: customer?.name,
          createdAt: Date.now(),
        };

        // decrement stock
        const newProducts = products.map((p) => {
          const inCart = cart.find((c) => c.productId === p.id);
          return inCart ? { ...p, stock: Math.max(0, p.stock - inCart.qty) } : p;
        });

        // credit -> add to customer balance
        const newCustomers =
          method === "credit" && customer
            ? customers.map((c) =>
                c.id === customer.id ? { ...c, balance: c.balance + total } : c,
              )
            : customers;

        set({
          sales: [sale, ...get().sales],
          products: newProducts,
          customers: newCustomers,
          cart: [],
        });
        return sale;
      },

      addSupplier: (s) => {
        const created: Supplier = {
          id: newId(),
          name: s.name,
          phone: s.phone,
          balance: s.balance ?? 0,
          createdAt: Date.now(),
        };
        set((st) => ({ suppliers: [created, ...st.suppliers] }));
        return created;
      },
      recordSupplierEntry: (supplierId, type, amount, note) => {
        const sup = get().suppliers.find((s) => s.id === supplierId);
        if (!sup) return;
        const entry: SupplierEntry = {
          id: newId(),
          supplierId,
          supplierName: sup.name,
          type,
          amount,
          note,
          createdAt: Date.now(),
        };
        const delta = type === "purchase" ? amount : -amount;
        set((st) => ({
          supplierEntries: [entry, ...st.supplierEntries],
          suppliers: st.suppliers.map((s) =>
            s.id === supplierId ? { ...s, balance: Math.max(0, s.balance + delta) } : s,
          ),
        }));
      },

      openDay: (openingFloat) => {
        const session: DaySession = { id: newId(), openedAt: Date.now(), openingFloat };
        set((st) => ({ daySessions: [session, ...st.daySessions] }));
        return session;
      },
      currentDay: () => get().daySessions.find((d) => !d.closedAt),
      closeDay: (countedCash, note) => {
        const open = get().daySessions.find((d) => !d.closedAt);
        if (!open) return null;
        const cashSales = get()
          .sales.filter((s) => s.method === "cash" && s.createdAt >= open.openedAt)
          .reduce((a, b) => a + b.total, 0);
        const cashAdj = get()
          .cashEntries.filter((e) => e.method === "cash" && e.createdAt >= open.openedAt)
          .reduce((a, e) => {
            if (e.kind === "cash_in") return a + e.amount;
            // expense and cash_out reduce drawer cash
            return a - e.amount;
          }, 0);
        const expected = open.openingFloat + cashSales + cashAdj;
        const closed: DaySession = {
          ...open,
          closedAt: Date.now(),
          countedCash,
          expectedCash: expected,
          variance: countedCash - expected,
          note,
        };
        set((st) => ({
          daySessions: st.daySessions.map((d) => (d.id === open.id ? closed : d)),
        }));
        return closed;
      },

      addCashEntry: (e) => {
        const created: CashEntry = {
          id: newId(),
          createdAt: Date.now(),
          ...e,
        };
        set((st) => ({ cashEntries: [created, ...st.cashEntries] }));
        return created;
      },
      removeCashEntry: (id) =>
        set((st) => ({ cashEntries: st.cashEntries.filter((c) => c.id !== id) })),

      updateProfile: (patch) =>
        set((st) => ({ profile: { ...st.profile, ...patch } })),

      seedDemo: () => {
        if (get().products.length > 0) return;
        const now = Date.now();
        set({
          products: [
            { id: newId(), name: "Sugar 1kg", price: 4500, stock: 20, category: "Groceries", createdAt: now },
            { id: newId(), name: "Soap (Geisha)", price: 2500, stock: 30, category: "Household", createdAt: now },
            { id: newId(), name: "Bread", price: 4000, stock: 12, category: "Bakery", createdAt: now },
            { id: newId(), name: "Cooking oil 1L", price: 8500, stock: 15, category: "Groceries", createdAt: now },
            { id: newId(), name: "Soda 500ml", price: 2000, stock: 40, category: "Drinks", createdAt: now },
            { id: newId(), name: "Airtime UGX 1000", price: 1000, stock: 100, category: "Airtime", createdAt: now },
          ],
        });
      },
    }),
    {
      name: "waka.pos",
      storage: createJSONStorage(() => idbStorage),
      partialize: (s) => ({
        products: s.products,
        customers: s.customers,
        sales: s.sales,
        suppliers: s.suppliers,
        supplierEntries: s.supplierEntries,
        daySessions: s.daySessions,
        cashEntries: s.cashEntries,
        profile: s.profile,
      }),
    },
  ),
);

export const formatUGX = (n: number) =>
  "UGX " + Math.round(n).toLocaleString("en-UG");
