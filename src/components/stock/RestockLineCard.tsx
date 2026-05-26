import { X } from "lucide-react";
import type { Language, Product } from "../../types";
import { t, tTemplate } from "../../lib/i18n";
import { buyingUnitsToBaseUnits, packLabelFromProduct, purchaseLineCostTotalUgx } from "../../lib/sellingEngine";

export type RestockLineRow = {
  key: string;
  productId: string;
  qtyBuyingStr: string;
  costPerBuyingStr: string;
};

type Props = {
  lang: Language;
  product: Product;
  row: RestockLineRow;
  onChange: (patch: Partial<Pick<RestockLineRow, "qtyBuyingStr" | "costPerBuyingStr">>) => void;
  onRemove: () => void;
};

export function RestockLineCard({ lang, product: p, row, onChange, onRemove }: Props) {
  const qty = Number(row.qtyBuyingStr) || 0;
  const cost = Math.floor(Number(row.costPerBuyingStr.replace(/\D/g, "")) || 0);
  const pack = packLabelFromProduct(p) ?? t(lang, "restockPackFallback");
  const lineTotal = purchaseLineCostTotalUgx({ qtyBuyingUnits: qty, costPerBuyingUnitUgx: cost });
  const addsBase = buyingUnitsToBaseUnits(p, qty);

  return (
    <li className="rounded-2xl border border-slate-200/90 bg-white p-4 shadow-sm">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-lg font-black text-slate-900">{p.name}</p>
          <p className="mt-0.5 text-xs font-semibold text-slate-500">
            {tTemplate(lang, "restockLinePackHint", { pack, unit: p.baseUnit })}
            {p.sellingPricePerUnitUgx > 0
              ? ` · ${tTemplate(lang, "restockSellsAt", { price: p.sellingPricePerUnitUgx.toLocaleString() })}`
              : ""}
          </p>
        </div>
        <button
          type="button"
          onClick={onRemove}
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-slate-400 active:bg-slate-100"
          aria-label={t(lang, "removeLine")}
        >
          <X className="h-5 w-5" />
        </button>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-3">
        <label className="block">
          <span className="text-xs font-bold uppercase tracking-wide text-slate-500">{t(lang, "restockQtyLabel")}</span>
          <input
            value={row.qtyBuyingStr}
            onChange={(e) => onChange({ qtyBuyingStr: e.target.value.replace(/[^\d.]/g, "").slice(0, 8) })}
            inputMode="decimal"
            className="mt-1 min-h-[48px] w-full rounded-xl border-2 border-slate-200 px-3 text-xl font-black text-slate-900"
          />
        </label>
        <label className="block">
          <span className="text-xs font-bold uppercase tracking-wide text-slate-500">{t(lang, "restockBuyPriceLabel")}</span>
          <input
            value={row.costPerBuyingStr}
            onChange={(e) => onChange({ costPerBuyingStr: e.target.value.replace(/\D/g, "").slice(0, 12) })}
            inputMode="numeric"
            placeholder="0"
            className="mt-1 min-h-[48px] w-full rounded-xl border-2 border-slate-200 px-3 text-xl font-black text-slate-900"
          />
        </label>
      </div>

      {qty > 0 && cost > 0 ? (
        <p className="mt-2 text-sm font-bold text-waka-800">
          {tTemplate(lang, "restockLineAdds", { count: String(addsBase), unit: p.baseUnit })} · UGX {lineTotal.toLocaleString()}
        </p>
      ) : null}
    </li>
  );
}
