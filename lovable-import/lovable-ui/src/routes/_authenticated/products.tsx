import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { Package, Plus, Trash2, Lock } from "lucide-react";
import { seoHead } from "@/components/seo-head";
import { usePOS, formatUGX, PLAN_LIMITS } from "@/lib/pos-store";

export const Route = createFileRoute("/_authenticated/products")({
  head: () => seoHead({ title: "Products — Waka POS", description: "Manage your stock.", path: "/products" }),
  component: ProductsPage,
});

function ProductsPage() {
  const products = usePOS((s) => s.products);
  const addProduct = usePOS((s) => s.addProduct);
  const removeProduct = usePOS((s) => s.removeProduct);
  const seedDemo = usePOS((s) => s.seedDemo);
  const plan = usePOS((s) => s.profile.plan);
  const limit = PLAN_LIMITS[plan].products;
  const atLimit = limit !== null && products.length >= limit;

  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState("");
  const [price, setPrice] = useState("");
  const [stock, setStock] = useState("");
  const [category, setCategory] = useState("");
  const [barcode, setBarcode] = useState("");

  return (
    <div>
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-black">Products</h1>
          <p className="mt-1 text-xs text-muted-foreground">
            {products.length} / {limit ?? "∞"} on {PLAN_LIMITS[plan].label}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {products.length === 0 && (
            <button onClick={seedDemo} className="rounded-full bg-waka-100 px-3 py-1.5 text-xs font-bold text-waka-700">
              Demo
            </button>
          )}
          <button
            onClick={() => setShowForm((v) => !v)}
            disabled={atLimit}
            className="inline-flex items-center gap-1.5 rounded-full bg-waka-600 px-3 py-1.5 text-xs font-bold text-primary-foreground disabled:opacity-40"
          >
            <Plus className="h-4 w-4" /> Add
          </button>
        </div>
      </div>

      {atLimit && (
        <div className="mt-4 flex items-center gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          <Lock className="h-4 w-4 flex-shrink-0" />
          <span className="flex-1">
            You've reached the {PLAN_LIMITS[plan].label} limit of {limit} products.
          </span>
          <Link to="/upgrade" className="rounded-full bg-amber-600 px-3 py-1.5 text-xs font-bold text-white">
            Upgrade
          </Link>
        </div>
      )}

      {showForm && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (!name.trim() || !price) return;
            addProduct({
              name: name.trim(),
              price: Number(price),
              stock: Number(stock) || 0,
              category: category.trim() || undefined,
              barcode: barcode.trim() || undefined,
            });
            setName(""); setPrice(""); setStock(""); setCategory(""); setBarcode(""); setShowForm(false);
          }}
          className="mt-4 grid gap-2 rounded-2xl border border-border/60 bg-card p-4 sm:grid-cols-2"
        >
          <input required value={name} onChange={(e) => setName(e.target.value)} placeholder="Product name" className="rounded-xl border border-border bg-background px-3 py-2.5 text-sm sm:col-span-2" />
          <input required type="number" min="0" value={price} onChange={(e) => setPrice(e.target.value)} placeholder="Price UGX" className="rounded-xl border border-border bg-background px-3 py-2.5 text-sm" />
          <input type="number" min="0" value={stock} onChange={(e) => setStock(e.target.value)} placeholder="Stock units" className="rounded-xl border border-border bg-background px-3 py-2.5 text-sm" />
          <input value={category} onChange={(e) => setCategory(e.target.value)} placeholder="Category (optional)" className="rounded-xl border border-border bg-background px-3 py-2.5 text-sm" />
          <input value={barcode} onChange={(e) => setBarcode(e.target.value)} placeholder="Barcode (optional)" className="rounded-xl border border-border bg-background px-3 py-2.5 text-sm" />
          <button className="rounded-full bg-waka-600 px-4 py-2.5 text-sm font-bold text-primary-foreground sm:col-span-2">Save product</button>
        </form>
      )}

      {products.length === 0 ? (
        <div className="mt-6 rounded-2xl border border-dashed border-border bg-card/50 p-10 text-center">
          <Package className="mx-auto h-8 w-8 text-muted-foreground" />
          <p className="mt-3 text-sm font-semibold">No products yet</p>
          <p className="mt-1 text-xs text-muted-foreground">Add products or load demo data to start selling.</p>
        </div>
      ) : (
        <ul className="mt-6 grid gap-2 sm:grid-cols-2">
          {products.map((p) => (
            <li key={p.id} className="flex items-center justify-between gap-3 rounded-2xl border border-border/60 bg-card p-4">
              <div className="min-w-0">
                <p className="truncate text-sm font-bold">{p.name}</p>
                <p className="text-xs text-muted-foreground">
                  {formatUGX(p.price)} · Stock {p.stock}{p.category ? ` · ${p.category}` : ""}{p.barcode ? ` · #${p.barcode}` : ""}
                </p>
              </div>
              <button onClick={() => removeProduct(p.id)} className="text-muted-foreground hover:text-destructive">
                <Trash2 className="h-4 w-4" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
