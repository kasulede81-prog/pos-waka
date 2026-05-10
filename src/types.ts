export type Language = "en" | "lg";

export type InventoryItem = {
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

export type Customer = {
  id: string;
  name: string;
  phone: string;
  location: string;
  createdAt: string;
};

export type SaleLine = {
  itemId: string;
  name: string;
  qty: number;
  unitPrice: number;
  lineTotal: number;
};

export type Sale = {
  id: string;
  customerId?: string;
  lines: SaleLine[];
  subtotal: number;
  tax: number;
  total: number;
  paymentMethod: "cash" | "mobile_money" | "card";
  createdAt: string;
};
