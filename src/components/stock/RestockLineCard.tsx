import { X } from "lucide-react";
import type { Language, Product } from "../../types";
import { t, tTemplate } from "../../lib/i18n";
import { baseUnitsPerBuyingUnit, buyingUnitsToBaseUnits, packLabelFromProduct } from "../../lib/sellingEngine";

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
  const pack = packLabelFromProduct(p);
  const buyUnit = (pack || p.baseUnit || "").trim() || p.baseUnit || "ea";
  const rate = baseUnitsPerBuyingUnit(p);
  const addsBase = buyingUnitsToBaseUnits(p, qty);

  const capitalizeFirst = (s: string): string => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);
  const pluralize = (unit: string): string => {
    const u = unit.trim();
    if (!u) return u;
    if (u.endsWith("s")) return u;
    if (/(ch|sh|x|z)$/i.test(u)) return `${u}es`;
    if (/[^aeiou]y$/i.test(u)) return `${u.slice(0, -1)}ies`;
    return `${u}s`;
  };
  const formatNum = (n: number): string => {
    if (!Number.isFinite(n)) return "0";
    if (Number.isInteger(n)) return String(n);
    const fixed = n.toFixed(2);
    return fixed.replace(/\.?0+$/, "").replace(/(\.\d*?)0+$/, "$1");
  };

  const baseUnitPlural = pluralize(p.baseUnit || "ea");
  const buyUnitPlural = pluralize(buyUnit);
  const addsShown = formatNum(addsBase);
  const showConversion = rate > 1;

  const buyUnitLabel = showConversion
    ? tTemplate(lang, "restockBuyUnitWithConversion", {
        buyUnit: capitalizeFirst(buyUnit),
        rate: String(rate),
        baseUnitPlural,
      })
    : tTemplate(lang, "restockBuyUnitLabel", {
        buyUnit: capitalizeFirst(buyUnit),
      });

  return (
    <li className="rounded-2xl border border-border/90 bg-card p-4 shadow-sm">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-lg font-black text-foreground">{p.name}</p>
          <p className="mt-1 text-xs font-semibold text-muted-foreground">{buyUnitLabel}</p>
        </div>
        <button
          type="button"
          onClick={onRemove}
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-muted-foreground active:bg-muted"
          aria-label={t(lang, "removeLine")}
        >
          <X className="h-5 w-5" />
        </button>
      </div>

      <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className="block">
          <span className="text-xs font-bold uppercase tracking-wide text-muted-foreground">
            {tTemplate(lang, "restockQtyBoughtLabel", { unitPlural: buyUnitPlural })}
          </span>
          <input
            value={row.qtyBuyingStr}
            onChange={(e) => onChange({ qtyBuyingStr: e.target.value.replace(/[^\d.]/g, "").slice(0, 8) })}
            inputMode="decimal"
            className="mt-1 min-h-[48px] w-full rounded-xl border-2 border-border px-3 text-xl font-black text-foreground"
          />
        </label>
        <label className="block">
          <span className="text-xs font-bold uppercase tracking-wide text-muted-foreground">
            {tTemplate(lang, "restockPricePerBuyingUnitLabel", { buyUnit })}
          </span>
          <input
            value={row.costPerBuyingStr}
            onChange={(e) => onChange({ costPerBuyingStr: e.target.value.replace(/\D/g, "").slice(0, 12) })}
            inputMode="numeric"
            placeholder="0"
            className="mt-1 min-h-[48px] w-full rounded-xl border-2 border-border px-3 text-xl font-black text-foreground"
          />
        </label>
      </div>

      {qty > 0 ? (
        <p className="mt-2 text-xs font-semibold text-muted-foreground">
          {tTemplate(lang, "restockAddedPreview", {
            adds: addsShown,
            baseUnitPlural,
          })}
        </p>
      ) : null}
    </li>
  );
}
