import { useState } from "react";
import clsx from "clsx";
import { BookmarkPlus, ChevronDown, Filter } from "lucide-react";
import type { Language, Supplier } from "../../../types";
import { t } from "../../../lib/i18n";
import { usePosStore } from "../../../store/usePosStore";
import { CATEGORY_FILTER_ALL, UNCATEGORIZED_SENTINEL } from "../../../lib/productCategories";
import {
  countActiveAdvancedFilters,
  defaultInventoryAdvancedFilters,
  INVENTORY_FILTER_ALL,
  type InventoryAdvancedFilters,
  type InventorySavedFilterPreset,
} from "./types";
import { distinctBrands, distinctSuppliersForFilter } from "./inventoryAdvancedFilters";
import type { Product } from "../../../types";

type Props = {
  lang: Language;
  filters: InventoryAdvancedFilters;
  onChange: (next: InventoryAdvancedFilters) => void;
  query: string;
  onQueryChange: (q: string) => void;
  products: Product[];
  suppliers: Supplier[];
  lastSupplierByProductId: Map<string, { supplierId: string; supplierName: string }>;
  stockCategoryPicklist: string[];
  savedPresets: InventorySavedFilterPreset[];
  onSavePreset: (name: string) => void;
  onApplyPreset: (preset: InventorySavedFilterPreset) => void;
  compact?: boolean;
};

export function InventoryFilterBar({
  lang,
  filters,
  onChange,
  query,
  onQueryChange,
  products,
  suppliers,
  lastSupplierByProductId,
  stockCategoryPicklist,
  savedPresets,
  onSavePreset,
  onApplyPreset,
  compact = false,
}: Props) {
  const [open, setOpen] = useState(false);
  const [presetName, setPresetName] = useState("");
  const activeCount = countActiveAdvancedFilters(filters);
  const brands = distinctBrands(products);
  const supplierOptions = distinctSuppliersForFilter(suppliers, lastSupplierByProductId);

  const patch = (p: Partial<InventoryAdvancedFilters>) => onChange({ ...filters, ...p });

  return (
    <div className={clsx("space-y-2", compact && "space-y-1.5")}>
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-0 flex-1">
          <input
            type="search"
            value={query}
            onChange={(e) => onQueryChange(e.target.value)}
            placeholder={t(lang, "inventorySearchPlaceholder")}
            className="min-h-[40px] w-full rounded-xl border border-border bg-card px-3 text-sm font-semibold text-foreground"
            aria-label={t(lang, "inventorySearchPlaceholder")}
          />
        </div>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className={clsx(
            "inline-flex min-h-[40px] items-center gap-1.5 rounded-xl border px-3 text-xs font-black",
            activeCount > 0 ? "border-waka-600 bg-waka-50 text-waka-800" : "border-border bg-card text-muted-foreground",
          )}
          aria-expanded={open}
        >
          <Filter className="h-3.5 w-3.5" />
          {t(lang, "inventoryFilters")}
          {activeCount > 0 ? ` (${activeCount})` : ""}
          <ChevronDown className={clsx("h-3.5 w-3.5 transition", open && "rotate-180")} />
        </button>
      </div>

      {savedPresets.length > 0 ? (
        <div className="flex flex-wrap gap-1.5">
          {savedPresets.map((preset) => (
            <button
              key={preset.id}
              type="button"
              onClick={() => onApplyPreset(preset)}
              className="min-h-[28px] rounded-full border border-border bg-card px-2.5 text-[10px] font-black text-muted-foreground hover:border-waka-400"
            >
              {preset.name}
            </button>
          ))}
        </div>
      ) : null}

      {open ? (
        <div className="rounded-xl border border-border bg-card p-3 shadow-sm">
          <div className={compact ? "grid grid-cols-2 gap-2" : "grid grid-cols-2 gap-2 sm:grid-cols-3"}>
            <FilterSelect
              label={t(lang, "inventoryFilterCategory")}
              value={filters.category}
              onChange={(v) => patch({ category: v })}
              options={[
                { value: CATEGORY_FILTER_ALL, label: t(lang, "stockFilterAll") },
                ...stockCategoryPicklist.map((c) => ({ value: c, label: c })),
              ]}
            />
            <FilterSelect
              label={t(lang, "inventoryFilterShelf")}
              value={filters.shelf}
              onChange={(v) => patch({ shelf: v })}
              options={[
                { value: INVENTORY_FILTER_ALL, label: t(lang, "stockFilterAll") },
                ...stockCategoryPicklist.map((c) => ({ value: c, label: c })),
                { value: UNCATEGORIZED_SENTINEL, label: t(lang, "uncategorized") },
              ]}
            />
            <FilterSelect
              label={t(lang, "inventoryFilterSupplier")}
              value={filters.supplierId}
              onChange={(v) => patch({ supplierId: v })}
              options={[
                { value: INVENTORY_FILTER_ALL, label: t(lang, "stockFilterAll") },
                ...supplierOptions.map((s) => ({ value: s.id, label: s.name })),
              ]}
            />
            <FilterSelect
              label={t(lang, "inventoryFilterBrand")}
              value={filters.brand}
              onChange={(v) => patch({ brand: v })}
              options={[
                { value: INVENTORY_FILTER_ALL, label: t(lang, "stockFilterAll") },
                ...brands.map((b) => ({ value: b, label: b })),
              ]}
            />
            <FilterSelect
              label={t(lang, "inventoryFilterStock")}
              value={filters.stock}
              onChange={(v) => patch({ stock: v as InventoryAdvancedFilters["stock"] })}
              options={[
                { value: "all", label: t(lang, "stockFilterAll") },
                { value: "low", label: t(lang, "stockFilterLow") },
                { value: "out", label: t(lang, "inventoryFilterOutOfStock") },
              ]}
            />
            <FilterSelect
              label={t(lang, "inventoryFilterStatus")}
              value={filters.active}
              onChange={(v) => patch({ active: v as InventoryAdvancedFilters["active"] })}
              options={[
                { value: "active", label: t(lang, "inventoryFilterActive") },
                { value: "archived", label: t(lang, "inventoryFilterArchived") },
                { value: "inactive", label: t(lang, "inventoryFilterInactive") },
                { value: "all", label: t(lang, "stockFilterAll") },
              ]}
            />
            <NumberFilter
              label={t(lang, "inventoryFilterPriceMin")}
              value={filters.priceMinUgx}
              onChange={(v) => patch({ priceMinUgx: v })}
            />
            <NumberFilter
              label={t(lang, "inventoryFilterPriceMax")}
              value={filters.priceMaxUgx}
              onChange={(v) => patch({ priceMaxUgx: v })}
            />
            <FilterSelect
              label={t(lang, "inventoryFilterRecentlyEdited")}
              value={filters.updatedWithinDays == null ? "" : String(filters.updatedWithinDays)}
              onChange={(v) => patch({ updatedWithinDays: v ? Number(v) : null })}
              options={[
                { value: "", label: t(lang, "stockFilterAll") },
                { value: "7", label: t(lang, "inventoryFilterLast7Days") },
                { value: "30", label: t(lang, "inventoryFilterLast30Days") },
                { value: "90", label: t(lang, "inventoryFilterLast90Days") },
              ]}
            />
          </div>
          <div className="mt-3 flex flex-wrap items-end gap-2 border-t border-border pt-3">
            <button
              type="button"
              onClick={() => onChange(defaultInventoryAdvancedFilters(CATEGORY_FILTER_ALL))}
              className="min-h-[32px] rounded-lg border border-border px-2.5 text-[10px] font-black text-muted-foreground"
            >
              {t(lang, "inventoryClearFilters")}
            </button>
            <div className="flex min-w-0 flex-1 items-center gap-1.5">
              <input
                type="text"
                value={presetName}
                onChange={(e) => setPresetName(e.target.value)}
                placeholder={t(lang, "inventorySaveFilterName")}
                className="min-h-[32px] flex-1 rounded-lg border border-border px-2 text-xs font-semibold"
              />
              <button
                type="button"
                disabled={!presetName.trim()}
                onClick={() => {
                  onSavePreset(presetName.trim());
                  setPresetName("");
                }}
                className="inline-flex min-h-[32px] items-center gap-1 rounded-lg bg-waka-600 px-2.5 text-[10px] font-black text-white disabled:opacity-50"
              >
                <BookmarkPlus className="h-3.5 w-3.5" />
                {t(lang, "inventorySaveFilter")}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function FilterSelect({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-[10px] font-bold uppercase tracking-wide text-muted-foreground">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="min-h-[36px] w-full rounded-xl border border-border bg-muted/30 px-2 text-xs font-bold"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function NumberFilter({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number | null;
  onChange: (v: number | null) => void;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-[10px] font-bold uppercase tracking-wide text-muted-foreground">{label}</span>
      <input
        type="number"
        min={0}
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value === "" ? null : Number(e.target.value))}
        className="min-h-[36px] w-full rounded-xl border border-border bg-muted/30 px-2 text-xs font-bold"
      />
    </label>
  );
}

export function useInventorySavedFilters() {
  const preferences = usePosStore((s) => s.preferences);
  const setPreferences = usePosStore((s) => s.setPreferences);
  const presets = preferences.inventorySavedFilters ?? [];

  const save = (name: string, filters: InventoryAdvancedFilters, query: string) => {
    const preset: InventorySavedFilterPreset = {
      id: `isf-${Date.now()}`,
      name,
      filters,
      query,
      createdAt: new Date().toISOString(),
    };
    setPreferences({ inventorySavedFilters: [...presets, preset] });
  };

  const remove = (id: string) => {
    setPreferences({ inventorySavedFilters: presets.filter((p) => p.id !== id) });
  };

  return { presets, save, remove };
}
