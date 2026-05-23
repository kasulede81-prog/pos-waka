import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Trash2, Plus, Minus, ShoppingBag, Banknote, Smartphone, Clock, X, Printer, ScanLine, MessageCircle, Search } from "lucide-react";
import { seoHead } from "@/components/seo-head";
import { usePOS, formatUGX, type PayMethod, type Sale } from "@/lib/pos-store";
import { useI18n } from "@/lib/i18n";
import { printReceipt, loadPrinterSettings } from "@/lib/printer";
import { BarcodeScanner, isBarcodeSupported } from "@/components/barcode-scanner";
import { buildReceiptText, whatsappLink, smsLink } from "@/lib/share";

interface SellSearch {
  add?: string;
}

export const Route = createFileRoute("/_authenticated/sell")({
  head: () => seoHead({ title: "Sell — Waka POS", description: "Touch grid POS for your shop.", path: "/sell" }),
  validateSearch: (search: Record<string, unknown>): SellSearch => ({
    add: typeof search.add === "string" ? search.add : undefined,
  }),
  component: SellPage,
});

function SellPage() {
  const { t } = useI18n();
  const search = Route.useSearch();
  const navigate = useNavigate({ from: "/sell" });
  const products = usePOS((s) => s.products);
  const cart = usePOS((s) => s.cart);
  const customers = usePOS((s) => s.customers);
  const profile = usePOS((s) => s.profile);
  const addToCart = usePOS((s) => s.addToCart);
  const setCartQty = usePOS((s) => s.setCartQty);
  const removeFromCart = usePOS((s) => s.removeFromCart);
  const clearCart = usePOS((s) => s.clearCart);
  const checkout = usePOS((s) => s.checkout);
  const seedDemo = usePOS((s) => s.seedDemo);

  // Add a product from ?add= search param (e.g. Quick product chip on Home).
  useEffect(() => {
    if (!search.add) return;
    const exists = products.some((p) => p.id === search.add);
    if (exists) {
      addToCart(search.add);
    }
    navigate({ search: {} as never, replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search.add, products.length]);

  const [showCart, setShowCart] = useState(false);
  const [showPay, setShowPay] = useState(false);
  const [showScan, setShowScan] = useState(false);
  const [scanMsg, setScanMsg] = useState<string | null>(null);
  const [method, setMethod] = useState<PayMethod>("cash");
  const [customerId, setCustomerId] = useState<string>("");
  const [lastSale, setLastSale] = useState<Sale | null>(null);
  const [printing, setPrinting] = useState(false);
  const [sharePhone, setSharePhone] = useState("");
  const [query, setQuery] = useState("");
  const [activeShelf, setActiveShelf] = useState<string | null>(null);

  const total = cart.reduce((s, i) => s + i.price * i.qty, 0);
  const count = cart.reduce((s, i) => s + i.qty, 0);

  const shelves = (() => {
    const map = new Map<string, typeof products>();
    for (const p of products) {
      const key = p.category?.trim() || "General";
      const arr = map.get(key) ?? [];
      arr.push(p);
      map.set(key, arr);
    }
    return Array.from(map.entries())
      .map(([name, items]) => ({ name, items }))
      .sort((a, b) => a.name.localeCompare(b.name));
  })();

  const q = query.trim().toLowerCase();
  const searching = q.length > 0;
  const searchResults = searching
    ? products.filter(
        (p) => p.name.toLowerCase().includes(q) || (p.barcode && p.barcode.includes(q)),
      )
    : [];

  const visibleProducts = searching
    ? searchResults
    : activeShelf
      ? (shelves.find((s) => s.name === activeShelf)?.items ?? [])
      : [];

  const handleScanned = (code: string) => {
    setShowScan(false);
    const match =
      products.find((p) => p.barcode && p.barcode === code) ||
      products.find((p) => p.name.toLowerCase().includes(code.toLowerCase()));
    if (match) {
      addToCart(match.id);
      setScanMsg(`Added: ${match.name}`);
    } else {
      setScanMsg(`No match for "${code}". Add it on the Products page.`);
    }
    setTimeout(() => setScanMsg(null), 2500);
  };

  const handlePay = async () => {
    const sale = checkout(method, method === "credit" ? customerId || undefined : undefined);
    if (sale) {
      setShowPay(false);
      setShowCart(false);
      setLastSale(sale);
      const cust = sale.customerId ? customers.find((c) => c.id === sale.customerId) : undefined;
      setSharePhone(cust?.phone ?? "");
      const settings = loadPrinterSettings();
      if (settings.autoPrint) {
        setPrinting(true);
        try { await printReceipt(sale, profile, settings); } catch (e) { console.error(e); }
        setPrinting(false);
      }
    }
  };

  const handlePrint = async () => {
    if (!lastSale) return;
    setPrinting(true);
    try { await printReceipt(lastSale, profile); }
    catch (e) { alert((e as Error).message); }
    setPrinting(false);
  };

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
      <section>
        <div className="mb-1 flex items-end justify-between gap-3">
          <h1 className="text-3xl font-black">{t("app.sell")}</h1>
          {products.length === 0 && (
            <button
              onClick={seedDemo}
              className="rounded-full bg-waka-100 px-3 py-1.5 text-xs font-bold text-waka-700 hover:bg-waka-200"
            >
              Load demo products
            </button>
          )}
        </div>
        <p className="mb-4 text-sm font-bold text-waka-700">Quick sell mode</p>

        <div className="mb-4 flex items-center gap-2 rounded-full bg-card px-4 py-3 shadow-sm">
          <Search className="h-5 w-5 text-muted-foreground" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search product…"
            className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
          />
          {isBarcodeSupported() && (
            <button
              onClick={() => setShowScan(true)}
              aria-label="Scan barcode"
              className="grid h-8 w-8 place-items-center rounded-lg border border-border text-muted-foreground hover:bg-muted"
            >
              <ScanLine className="h-4 w-4" />
            </button>
          )}
        </div>

        {scanMsg && (
          <div className="mb-3 rounded-xl border border-waka-200 bg-waka-50 px-3 py-2 text-xs font-semibold text-waka-700">
            {scanMsg}
          </div>
        )}

        {products.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-border bg-card/50 p-8 text-center">
            <ShoppingBag className="mx-auto h-8 w-8 text-muted-foreground" />
            <p className="mt-3 text-sm font-semibold">No products yet</p>
            <p className="mt-1 text-xs text-muted-foreground">
              <Link to="/products" className="text-waka-700 underline">Add your first product</Link> or load demo data.
            </p>
          </div>
        ) : !searching && !activeShelf ? (
          <>
            <div className="mb-2 flex items-end justify-between">
              <div>
                <p className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">Shelves</p>
                <p className="text-base font-bold">Tap a shelf to see products</p>
              </div>
              <span className="grid h-7 min-w-7 place-items-center rounded-full bg-muted px-2 text-xs font-bold">
                {products.length}
              </span>
            </div>
            <div className="grid grid-cols-2 gap-3">
              {shelves.map((s) => (
                <button
                  key={s.name}
                  onClick={() => setActiveShelf(s.name)}
                  className="flex flex-col items-start rounded-2xl bg-card p-4 text-left shadow-sm transition hover:ring-2 hover:ring-waka-500"
                >
                  <span className="grid h-8 w-8 place-items-center rounded-md bg-foreground text-background">
                    <span className="block h-3 w-3 rounded-sm bg-background" />
                  </span>
                  <span className="mt-4 text-lg font-black leading-tight">{s.name}</span>
                  <span className="mt-1 text-xs text-muted-foreground">
                    {s.items.length} product{s.items.length === 1 ? "" : "s"}
                  </span>
                </button>
              ))}
            </div>
          </>
        ) : (
          <>
            {!searching && activeShelf && (
              <button
                onClick={() => setActiveShelf(null)}
                className="mb-3 inline-flex items-center gap-1 text-sm font-bold text-waka-700"
              >
                ← All shelves · <span className="text-foreground">{activeShelf}</span>
              </button>
            )}
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              {visibleProducts.map((p) => (
                <button
                  key={p.id}
                  onClick={() => addToCart(p.id)}
                  disabled={p.stock <= 0}
                  className="group relative flex flex-col items-start rounded-2xl border border-border/60 bg-card p-4 text-left transition hover:border-waka-500 hover:shadow-md disabled:opacity-40"
                >
                  <span className="text-sm font-bold leading-tight text-foreground">{p.name}</span>
                  <span className="mt-2 text-lg font-black text-waka-700">{formatUGX(p.price)}</span>
                  <span className="mt-1 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                    Stock: {p.stock}
                  </span>
                </button>
              ))}
              {visibleProducts.length === 0 && (
                <p className="col-span-full rounded-xl bg-card p-6 text-center text-sm text-muted-foreground">
                  No matching products.
                </p>
              )}
            </div>
          </>
        )}
      </section>


      {/* Desktop cart */}
      <aside className="hidden lg:block">
        <CartPanel
          cart={cart}
          total={total}
          onQty={setCartQty}
          onRemove={removeFromCart}
          onClear={clearCart}
          onPay={() => setShowPay(true)}
        />
      </aside>

      {/* Mobile cart trigger */}
      {count > 0 && (
        <button
          onClick={() => setShowCart(true)}
          className="fixed bottom-20 left-1/2 z-40 -translate-x-1/2 rounded-full bg-waka-600 px-6 py-3 text-sm font-bold text-primary-foreground shadow-lg lg:hidden"
        >
          {count} item{count > 1 ? "s" : ""} · {formatUGX(total)}
        </button>
      )}

      {/* Mobile cart drawer */}
      {showCart && (
        <div className="fixed inset-0 z-50 flex items-end bg-black/50 lg:hidden" onClick={() => setShowCart(false)}>
          <div onClick={(e) => e.stopPropagation()} className="w-full rounded-t-3xl bg-background p-4">
            <CartPanel
              cart={cart}
              total={total}
              onQty={setCartQty}
              onRemove={removeFromCart}
              onClear={clearCart}
              onPay={() => setShowPay(true)}
              onClose={() => setShowCart(false)}
            />
          </div>
        </div>
      )}

      {/* Pay modal */}
      {showPay && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4" onClick={() => setShowPay(false)}>
          <div onClick={(e) => e.stopPropagation()} className="w-full max-w-md rounded-3xl bg-background p-6">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-black">Payment</h2>
              <button onClick={() => setShowPay(false)} className="rounded-full p-1 hover:bg-muted">
                <X className="h-5 w-5" />
              </button>
            </div>
            <p className="mt-1 text-3xl font-black text-waka-700">{formatUGX(total)}</p>

            <div className="mt-5 grid grid-cols-3 gap-2">
              {([
                { id: "cash", label: "Cash", icon: Banknote },
                { id: "momo", label: "MoMo", icon: Smartphone },
                { id: "credit", label: "Credit", icon: Clock },
              ] as const).map((m) => {
                const Icon = m.icon;
                const active = method === m.id;
                return (
                  <button
                    key={m.id}
                    onClick={() => setMethod(m.id)}
                    className={`flex flex-col items-center gap-1.5 rounded-2xl border-2 p-3 text-xs font-bold ${
                      active ? "border-waka-600 bg-waka-50 text-waka-700" : "border-border text-foreground/70"
                    }`}
                  >
                    <Icon className="h-5 w-5" />
                    {m.label}
                  </button>
                );
              })}
            </div>

            {method === "credit" && (
              <div className="mt-4">
                <label className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Customer</label>
                {customers.length === 0 ? (
                  <p className="mt-2 text-sm">
                    <Link to="/customers" className="text-waka-700 underline">Add a customer</Link> first to record credit.
                  </p>
                ) : (
                  <select
                    value={customerId}
                    onChange={(e) => setCustomerId(e.target.value)}
                    className="mt-2 w-full rounded-xl border border-border bg-background px-3 py-2.5 text-sm"
                  >
                    <option value="">Select customer…</option>
                    {customers.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name} {c.balance > 0 ? `(owes ${formatUGX(c.balance)})` : ""}
                      </option>
                    ))}
                  </select>
                )}
              </div>
            )}

            <button
              onClick={handlePay}
              disabled={method === "credit" && !customerId}
              className="mt-6 w-full rounded-full bg-waka-600 py-3.5 text-sm font-bold text-primary-foreground hover:bg-waka-700 disabled:opacity-40"
            >
              Confirm & save receipt
            </button>
          </div>
        </div>
      )}

      {lastSale && (
        <div className="fixed inset-x-0 bottom-0 z-50 border-t border-border bg-background p-4 shadow-2xl lg:bottom-4 lg:left-1/2 lg:right-auto lg:w-[420px] lg:-translate-x-1/2 lg:rounded-2xl lg:border">
          <div className="flex items-center gap-3">
            <span className="grid h-10 w-10 place-items-center rounded-full bg-emerald-100 text-emerald-700 text-lg">✓</span>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-black">Sale saved · {formatUGX(lastSale.total)}</p>
              <p className="text-xs text-muted-foreground">{lastSale.method.toUpperCase()} · {lastSale.items.length} item{lastSale.items.length > 1 ? "s" : ""}</p>
            </div>
            <button onClick={() => setLastSale(null)} className="rounded-full p-1.5 hover:bg-muted"><X className="h-4 w-4" /></button>
          </div>
          <div className="mt-3 grid grid-cols-2 gap-2">
            <button
              onClick={handlePrint}
              disabled={printing}
              className="inline-flex items-center justify-center gap-1.5 rounded-full bg-waka-600 px-4 py-2.5 text-sm font-bold text-primary-foreground disabled:opacity-60"
            >
              <Printer className="h-4 w-4" /> {printing ? "Printing…" : "Print receipt"}
            </button>
            <button onClick={() => setLastSale(null)} className="rounded-full border border-border px-4 py-2.5 text-sm font-bold">Done</button>
          </div>
          <div className="mt-3 rounded-xl border border-border/60 bg-muted/40 p-2">
            <div className="flex items-center gap-2">
              <input
                inputMode="tel"
                value={sharePhone}
                onChange={(e) => setSharePhone(e.target.value)}
                placeholder="Customer phone (07… or +256…)"
                className="min-w-0 flex-1 rounded-full border border-border bg-background px-3 py-1.5 text-xs"
              />
            </div>
            <div className="mt-2 grid grid-cols-2 gap-2">
              <a
                href={whatsappLink(sharePhone, buildReceiptText(lastSale, profile)) ?? "#"}
                onClick={(e) => { if (!whatsappLink(sharePhone, "x")) e.preventDefault(); }}
                target="_blank"
                rel="noreferrer"
                className={`inline-flex items-center justify-center gap-1.5 rounded-full px-3 py-2 text-xs font-bold ${
                  whatsappLink(sharePhone, "x")
                    ? "bg-[#25D366] text-white"
                    : "bg-muted text-muted-foreground cursor-not-allowed"
                }`}
              >
                <MessageCircle className="h-3.5 w-3.5" /> WhatsApp
              </a>
              <a
                href={smsLink(sharePhone, buildReceiptText(lastSale, profile)) ?? "#"}
                onClick={(e) => { if (!smsLink(sharePhone, "x")) e.preventDefault(); }}
                className={`inline-flex items-center justify-center gap-1.5 rounded-full px-3 py-2 text-xs font-bold ${
                  smsLink(sharePhone, "x")
                    ? "border border-border bg-background"
                    : "bg-muted text-muted-foreground cursor-not-allowed"
                }`}
              >
                <Smartphone className="h-3.5 w-3.5" /> SMS
              </a>
            </div>
          </div>
        </div>
      )}

      {showScan && <BarcodeScanner onScan={handleScanned} onClose={() => setShowScan(false)} />}
    </div>
  );
}

function CartPanel({
  cart, total, onQty, onRemove, onClear, onPay, onClose,
}: {
  cart: ReturnType<typeof usePOS.getState>["cart"];
  total: number;
  onQty: (id: string, qty: number) => void;
  onRemove: (id: string) => void;
  onClear: () => void;
  onPay: () => void;
  onClose?: () => void;
}) {
  return (
    <div className="rounded-2xl border border-border/60 bg-card p-4 lg:sticky lg:top-20">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-black uppercase tracking-wider">Cart</h2>
        <div className="flex items-center gap-2">
          {cart.length > 0 && (
            <button onClick={onClear} className="rounded-full p-1.5 text-muted-foreground hover:bg-muted hover:text-destructive">
              <Trash2 className="h-4 w-4" />
            </button>
          )}
          {onClose && (
            <button onClick={onClose} className="rounded-full p-1.5 hover:bg-muted lg:hidden">
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
      </div>

      {cart.length === 0 ? (
        <p className="py-8 text-center text-sm text-muted-foreground">Tap a product to add it.</p>
      ) : (
        <ul className="mt-3 divide-y divide-border/60">
          {cart.map((c) => (
            <li key={c.productId} className="flex items-center gap-2 py-3">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-bold">{c.name}</p>
                <p className="text-xs text-muted-foreground">{formatUGX(c.price)} each</p>
              </div>
              <div className="flex items-center gap-1.5">
                <button onClick={() => onQty(c.productId, c.qty - 1)} className="grid h-7 w-7 place-items-center rounded-full bg-muted">
                  <Minus className="h-3.5 w-3.5" />
                </button>
                <span className="w-6 text-center text-sm font-bold">{c.qty}</span>
                <button onClick={() => onQty(c.productId, c.qty + 1)} className="grid h-7 w-7 place-items-center rounded-full bg-muted">
                  <Plus className="h-3.5 w-3.5" />
                </button>
              </div>
              <button onClick={() => onRemove(c.productId)} className="ml-1 text-muted-foreground hover:text-destructive">
                <Trash2 className="h-4 w-4" />
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="mt-4 flex items-center justify-between border-t border-border/60 pt-4">
        <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Total</span>
        <span className="text-2xl font-black text-waka-700">{formatUGX(total)}</span>
      </div>

      <button
        onClick={onPay}
        disabled={cart.length === 0}
        className="mt-4 w-full rounded-full bg-waka-600 py-3 text-sm font-bold text-primary-foreground hover:bg-waka-700 disabled:opacity-40"
      >
        Take payment
      </button>
    </div>
  );
}
