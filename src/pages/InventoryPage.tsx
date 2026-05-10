import { useState } from "react";
import type { FormEvent } from "react";
import type { Language } from "../types";
import { t } from "../lib/i18n";
import { usePosStore } from "../store/usePosStore";

export function InventoryPage({ lang }: { lang: Language }) {
  const { items, addItem } = usePosStore();
  const [name, setName] = useState("");
  const [price, setPrice] = useState("");
  const [stock, setStock] = useState("");

  const submit = (e: FormEvent) => {
    e.preventDefault();
    addItem({
      name,
      category: "General",
      sku: `SKU-${Date.now()}`,
      price: Number(price),
      cost: Number(price) * 0.7,
      stock: Number(stock),
      lowStockThreshold: 5,
    });
    setName("");
    setPrice("");
    setStock("");
  };

  return (
    <div className="space-y-4 pb-24 md:pb-4">
      <h2 className="text-xl font-semibold">{t(lang, "inventory")}</h2>
      <form onSubmit={submit} className="grid gap-2 rounded-xl border bg-white p-4 sm:grid-cols-4">
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Item name" className="rounded-lg border px-3 py-2" />
        <input value={price} onChange={(e) => setPrice(e.target.value)} placeholder="Price UGX" className="rounded-lg border px-3 py-2" />
        <input value={stock} onChange={(e) => setStock(e.target.value)} placeholder="Stock" className="rounded-lg border px-3 py-2" />
        <button className="rounded-lg bg-slate-900 px-3 py-2 text-white">{t(lang, "addItem")}</button>
      </form>
      <div className="space-y-2">
        {items.map((item) => (
          <article key={item.id} className="flex items-center justify-between rounded-xl border bg-white p-3">
            <div>
              <p className="font-medium">{item.name}</p>
              <p className="text-xs text-slate-500">{item.sku}</p>
            </div>
            <div className="text-right">
              <p>UGX {item.price.toLocaleString()}</p>
              <p className="text-xs text-slate-500">Stock: {item.stock}</p>
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}
