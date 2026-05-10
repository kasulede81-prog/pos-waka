import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { Customer, InventoryItem, Sale, SaleLine } from "../types";

type PosState = {
  items: InventoryItem[];
  customers: Customer[];
  sales: Sale[];
  cart: SaleLine[];
  addItem: (item: Omit<InventoryItem, "id" | "updatedAt">) => void;
  addCustomer: (customer: Omit<Customer, "id" | "createdAt">) => void;
  addToCart: (item: InventoryItem) => void;
  clearCart: () => void;
  checkout: (paymentMethod: Sale["paymentMethod"], customerId?: string) => void;
};

const seedItems: InventoryItem[] = [
  {
    id: crypto.randomUUID(),
    name: "Sugar 1kg",
    category: "Grocery",
    sku: "SUG-1KG",
    price: 4500,
    cost: 3400,
    stock: 42,
    lowStockThreshold: 8,
    updatedAt: new Date().toISOString(),
  },
  {
    id: crypto.randomUUID(),
    name: "Cooking Oil 500ml",
    category: "Grocery",
    sku: "OIL-500",
    price: 6000,
    cost: 4900,
    stock: 20,
    lowStockThreshold: 6,
    updatedAt: new Date().toISOString(),
  },
];

export const usePosStore = create<PosState>()(
  persist(
    (set) => ({
      items: seedItems,
      customers: [],
      sales: [],
      cart: [],
      addItem: (item) =>
        set((state) => ({
          items: [
            {
              ...item,
              id: crypto.randomUUID(),
              updatedAt: new Date().toISOString(),
            },
            ...state.items,
          ],
        })),
      addCustomer: (customer) =>
        set((state) => ({
          customers: [
            {
              ...customer,
              id: crypto.randomUUID(),
              createdAt: new Date().toISOString(),
            },
            ...state.customers,
          ],
        })),
      addToCart: (item) =>
        set((state) => {
          const found = state.cart.find((line) => line.itemId === item.id);
          if (!found) {
            return {
              cart: [
                ...state.cart,
                {
                  itemId: item.id,
                  name: item.name,
                  qty: 1,
                  unitPrice: item.price,
                  lineTotal: item.price,
                },
              ],
            };
          }
          return {
            cart: state.cart.map((line) =>
              line.itemId === item.id
                ? { ...line, qty: line.qty + 1, lineTotal: (line.qty + 1) * line.unitPrice }
                : line,
            ),
          };
        }),
      clearCart: () => set({ cart: [] }),
      checkout: (paymentMethod, customerId) =>
        set((state) => {
          if (!state.cart.length) return state;
          const subtotal = state.cart.reduce((sum, line) => sum + line.lineTotal, 0);
          const tax = subtotal * 0.18;
          const total = subtotal + tax;
          const sale: Sale = {
            id: crypto.randomUUID(),
            lines: state.cart,
            subtotal,
            tax,
            total,
            paymentMethod,
            customerId,
            createdAt: new Date().toISOString(),
          };
          return {
            sales: [sale, ...state.sales],
            cart: [],
            items: state.items.map((item) => {
              const line = state.cart.find((x) => x.itemId === item.id);
              return line ? { ...item, stock: Math.max(0, item.stock - line.qty) } : item;
            }),
          };
        }),
    }),
    { name: "waka-pos-store-v1" },
  ),
);
