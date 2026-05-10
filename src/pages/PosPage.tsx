import type { Language } from "../types";
import { t } from "../lib/i18n";
import { usePosStore } from "../store/usePosStore";

export function PosPage({ lang }: { lang: Language }) {
  const { items, cart, addToCart, checkout } = usePosStore();
  const total = cart.reduce((sum, line) => sum + line.lineTotal, 0);

  return (
    <div className="grid gap-4 pb-24 md:grid-cols-2 md:pb-4">
      <section className="space-y-2">
        <h2 className="text-xl font-semibold">{t(lang, "pos")}</h2>
        {items.map((item) => (
          <button
            key={item.id}
            onClick={() => addToCart(item)}
            className="flex w-full items-center justify-between rounded-xl border bg-white p-3 text-left"
          >
            <span>{item.name}</span>
            <span className="text-sm">UGX {item.price.toLocaleString()}</span>
          </button>
        ))}
      </section>
      <section className="rounded-xl border bg-white p-4">
        <h3 className="font-semibold">Cart</h3>
        <div className="mt-2 space-y-2">
          {cart.length ? (
            cart.map((line) => (
              <div key={line.itemId} className="flex justify-between text-sm">
                <span>
                  {line.name} x{line.qty}
                </span>
                <span>UGX {line.lineTotal.toLocaleString()}</span>
              </div>
            ))
          ) : (
            <p className="text-sm text-slate-500">No items yet.</p>
          )}
        </div>
        <p className="mt-3 text-lg font-bold">UGX {total.toLocaleString()}</p>
        <button onClick={() => checkout("cash")} className="mt-3 w-full rounded-lg bg-emerald-600 px-3 py-2 text-white">
          {t(lang, "checkout")}
        </button>
      </section>
    </div>
  );
}
