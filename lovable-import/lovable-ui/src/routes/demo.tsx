import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { ArrowRight, ShoppingBag, Banknote, Sparkles, X } from "lucide-react";
import { seoHead } from "@/components/seo-head";
import { usePOS, formatUGX } from "@/lib/pos-store";
import { WakaLogo } from "@/components/waka-logo";

export const Route = createFileRoute("/demo")({
  head: () =>
    seoHead({
      title: "Try the demo — Waka POS",
      description: "Try Waka POS with sample shop data — no account needed.",
      path: "/demo",
    }),
  component: DemoPage,
});

const STEPS = [
  { title: "This is the Sell screen", body: "Tap any product card to add it to the cart." },
  { title: "Cart adds up automatically", body: "Increase qty or remove items. Total updates live." },
  { title: "Take payment", body: "Choose Cash, MoMo or Credit. Your sale is saved to the receipt log." },
  { title: "That's it!", body: "Sign up free to use this with your real shop. Works offline + syncs to cloud." },
];

function DemoPage() {
  const products = usePOS((s) => s.products);
  const cart = usePOS((s) => s.cart);
  const addToCart = usePOS((s) => s.addToCart);
  const setCartQty = usePOS((s) => s.setCartQty);
  const clearCart = usePOS((s) => s.clearCart);
  const checkout = usePOS((s) => s.checkout);
  const seedDemo = usePOS((s) => s.seedDemo);
  const [step, setStep] = useState(0);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (products.length === 0) seedDemo();
  }, [products.length, seedDemo]);

  const total = cart.reduce((a, b) => a + b.price * b.qty, 0);

  const pay = (m: "cash" | "momo" | "credit") => {
    const s = checkout(m);
    if (s) { setSaved(true); setStep(3); setTimeout(() => setSaved(false), 2500); }
  };

  return (
    <div className="min-h-dvh bg-gradient-to-b from-waka-50 to-background">
      <header className="sticky top-0 z-30 border-b border-border/60 bg-background/90 backdrop-blur">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-3">
          <Link to="/"><WakaLogo size="sm" /></Link>
          <span className="inline-flex items-center gap-1.5 rounded-full bg-waka-100 px-3 py-1 text-xs font-black text-waka-700">
            <Sparkles className="h-3.5 w-3.5" /> Demo mode
          </span>
          <Link to="/register" className="inline-flex items-center gap-1.5 rounded-full bg-waka-600 px-4 py-2 text-xs font-bold text-primary-foreground">
            Get started <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-4 py-6">
        <div className="mb-4 rounded-2xl border border-waka-200 bg-waka-50 p-4">
          <p className="text-xs font-black uppercase tracking-wider text-waka-700">Step {step + 1} / 4</p>
          <h2 className="mt-1 text-lg font-black">{STEPS[step].title}</h2>
          <p className="mt-1 text-sm text-foreground/80">{STEPS[step].body}</p>
          <div className="mt-3 flex gap-2">
            {step > 0 && (
              <button onClick={() => setStep(step - 1)} className="rounded-full border border-border px-3 py-1.5 text-xs font-bold">
                Back
              </button>
            )}
            {step < STEPS.length - 1 && (
              <button onClick={() => setStep(step + 1)} className="rounded-full bg-waka-600 px-3 py-1.5 text-xs font-bold text-primary-foreground">
                Next →
              </button>
            )}
            {step === STEPS.length - 1 && (
              <Link to="/register" className="rounded-full bg-waka-600 px-3 py-1.5 text-xs font-bold text-primary-foreground">
                Create my shop
              </Link>
            )}
          </div>
        </div>

        <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
          <section>
            <h1 className="mb-3 text-xl font-black">Tap a product</h1>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              {products.map((p) => (
                <button
                  key={p.id}
                  onClick={() => { addToCart(p.id); if (step === 0) setStep(1); }}
                  className="flex flex-col items-start rounded-2xl border border-border/60 bg-card p-4 text-left hover:border-waka-500 hover:shadow-md"
                >
                  <span className="text-sm font-bold">{p.name}</span>
                  <span className="mt-2 text-lg font-black text-waka-700">{formatUGX(p.price)}</span>
                  <span className="mt-1 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Stock: {p.stock}</span>
                </button>
              ))}
            </div>
          </section>

          <aside className="rounded-2xl border border-border/60 bg-card p-4 lg:sticky lg:top-20 self-start">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-black uppercase tracking-wider">Cart</h2>
              {cart.length > 0 && (
                <button onClick={clearCart} className="text-xs text-muted-foreground hover:text-destructive">
                  Clear
                </button>
              )}
            </div>
            {cart.length === 0 ? (
              <div className="py-8 text-center">
                <ShoppingBag className="mx-auto h-8 w-8 text-muted-foreground" />
                <p className="mt-2 text-xs text-muted-foreground">Tap a product to add it.</p>
              </div>
            ) : (
              <ul className="mt-3 divide-y divide-border/60">
                {cart.map((c) => (
                  <li key={c.productId} className="flex items-center gap-2 py-2">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-bold">{c.name}</p>
                      <p className="text-xs text-muted-foreground">{formatUGX(c.price)} × {c.qty}</p>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <button onClick={() => setCartQty(c.productId, c.qty - 1)} className="grid h-6 w-6 place-items-center rounded-full bg-muted text-xs">−</button>
                      <span className="w-5 text-center text-sm font-bold">{c.qty}</span>
                      <button onClick={() => setCartQty(c.productId, c.qty + 1)} className="grid h-6 w-6 place-items-center rounded-full bg-muted text-xs">+</button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
            <div className="mt-3 flex items-center justify-between border-t border-border/60 pt-3">
              <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Total</span>
              <span className="text-2xl font-black text-waka-700">{formatUGX(total)}</span>
            </div>
            {cart.length > 0 && (
              <div className="mt-3 grid grid-cols-3 gap-2">
                <button onClick={() => pay("cash")} className="rounded-full bg-waka-600 py-2 text-xs font-bold text-primary-foreground">
                  <Banknote className="mx-auto h-4 w-4" />Cash
                </button>
                <button onClick={() => pay("momo")} className="rounded-full bg-waka-600 py-2 text-xs font-bold text-primary-foreground">MoMo</button>
                <button onClick={() => pay("credit")} className="rounded-full bg-waka-600 py-2 text-xs font-bold text-primary-foreground">Credit</button>
              </div>
            )}
          </aside>
        </div>

        <p className="mt-8 text-center text-xs text-muted-foreground">
          This demo data is saved on this device only. <Link to="/register" className="text-waka-700 underline">Create an account</Link> to sync your real shop.
        </p>
      </main>

      {saved && (
        <div className="fixed bottom-6 left-1/2 z-50 -translate-x-1/2 rounded-full bg-emerald-600 px-6 py-3 text-sm font-bold text-white shadow-xl">
          ✓ Sale saved! <button onClick={() => setSaved(false)} className="ml-2 opacity-80"><X className="inline h-3 w-3" /></button>
        </div>
      )}
    </div>
  );
}
