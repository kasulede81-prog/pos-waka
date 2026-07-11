import { useEffect } from "react";
import { createPortal } from "react-dom";
import type { Language, Product } from "../../types";
import { t } from "../../lib/i18n";
import { packLabelFromProduct } from "../../lib/sellingEngine";

type Props = {
  lang: Language;
  open: boolean;
  query: string;
  onQueryChange: (value: string) => void;
  products: Product[];
  onPick: (productId: string) => void;
  onClose: () => void;
};

/** Full-screen product picker — portaled above app header and bottom nav. */
export function RestockProductPicker({ lang, open, query, onQueryChange, products, onPick, onClose }: Props) {
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      document.removeEventListener("keydown", onKey);
    };
  }, [open, onClose]);

  if (!open) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[60] flex min-h-0 flex-col bg-card"
      style={{
        paddingTop: "max(0.5rem, env(safe-area-inset-top, 0px))",
        paddingBottom: "env(safe-area-inset-bottom, 0px)",
      }}
      role="dialog"
      aria-modal
      aria-labelledby="restock-picker-title"
    >
      <header className="flex shrink-0 items-center justify-between gap-3 border-b border-border px-4 py-3">
        <button type="button" className="min-h-[44px] rounded-xl px-3 py-2 text-sm font-bold text-muted-foreground active:bg-muted" onClick={onClose}>
          {t(lang, "cancel")}
        </button>
        <h2 id="restock-picker-title" className="text-center text-lg font-black text-foreground">
          {t(lang, "restockPickProduct")}
        </h2>
        <span className="w-[4.5rem]" aria-hidden />
      </header>

      <div className="shrink-0 px-4 py-3">
        <input
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          placeholder={t(lang, "restockSearchProducts")}
          className="min-h-[48px] w-full rounded-xl border-2 border-border px-4 text-base font-semibold outline-none focus:border-waka-400 focus:ring-2 focus:ring-waka-200"
          autoFocus
        />
      </div>

      <ul className="min-h-0 flex-1 overflow-y-auto overscroll-y-contain px-4 pb-4 [-webkit-overflow-scrolling:touch]">
        {products.length === 0 ? (
          <li className="py-12 text-center text-sm font-semibold text-muted-foreground">{t(lang, "restockNoProductsMatch")}</li>
        ) : (
          products.map((p) => {
            const pack = packLabelFromProduct(p);
            const hint = pack ? `${pack} · ${p.baseUnit}` : p.baseUnit;
            return (
              <li key={p.id} className="mb-2">
                <button
                  type="button"
                  onClick={() => onPick(p.id)}
                  className="w-full rounded-2xl border border-border bg-muted px-4 py-3.5 text-left active:bg-waka-50"
                >
                  <span className="text-base font-black text-foreground">{p.name}</span>
                  <span className="mt-0.5 block text-xs font-semibold text-muted-foreground">
                    {[p.category, hint].filter(Boolean).join(" · ")}
                  </span>
                </button>
              </li>
            );
          })
        )}
      </ul>
    </div>,
    document.body,
  );
}
