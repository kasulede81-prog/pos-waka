import { Search } from "lucide-react";
import type { Language, Product } from "../../../types";
import { t } from "../../../lib/i18n";
import { WIZARD_INPUT_TEXT } from "./transferTokens";

type Props = {
  lang: Language;
  value: string;
  onChange: (value: string) => void;
  products: Product[];
  onAdd: (productId: string) => void;
  selectedIds: Set<string>;
};

export function TransferProductSelector({ lang, value, onChange, products, onAdd, selectedIds }: Props) {
  return (
    <section className="space-y-3">
      <label className="relative block">
        <Search className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-muted-foreground" aria-hidden />
        <input
          type="search"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={t(lang, "inventoryCountSearchProduct")}
          className={`${WIZARD_INPUT_TEXT} pl-12 text-base`}
          autoComplete="off"
        />
      </label>
      {products.length > 0 ? (
        <ul className="max-h-56 space-y-2 overflow-y-auto rounded-2xl border border-border/60 bg-card p-2">
          {products.slice(0, 40).map((p) => {
            const added = selectedIds.has(p.id);
            return (
              <li key={p.id}>
                <button
                  type="button"
                  disabled={added}
                  onClick={() => onAdd(p.id)}
                  className="flex w-full items-center justify-between gap-2 rounded-xl px-3 py-2.5 text-left transition-colors hover:bg-muted/50 disabled:opacity-50"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-black text-foreground">{p.name}</p>
                    <p className="text-xs font-semibold text-muted-foreground">
                      {p.sku?.trim() || "—"} · {p.category?.trim() || "—"} · {p.stockOnHand}
                    </p>
                  </div>
                  <span className="shrink-0 text-xs font-bold text-primary">
                    {added ? t(lang, "xferProductAdded") : t(lang, "xferProductAdd")}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      ) : value.trim() ? (
        <p className="rounded-xl border border-dashed border-border/60 px-4 py-6 text-center text-sm font-semibold text-muted-foreground">
          {t(lang, "xferNoProductsFound")}
        </p>
      ) : null}
    </section>
  );
}
