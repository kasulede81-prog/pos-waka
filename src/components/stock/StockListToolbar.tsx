import type { Language } from "../../types";
import { t } from "../../lib/i18n";
import { CATEGORY_FILTER_ALL, UNCATEGORIZED_SENTINEL } from "../../lib/productCategories";

type SortKey = "name_az" | "name_za" | "stock_low" | "updated";

type Props = {
  lang: Language;
  listQuery?: string;
  onListQuery?: (q: string) => void;
  listSort: SortKey;
  onListSort: (s: SortKey) => void;
  listFilter: "all" | "low";
  onListFilter: (f: "all" | "low") => void;
  stockCategoryFilter: string;
  onStockCategoryFilter: (c: string) => void;
  stockCategoryPicklist: string[];
  stockHasUncategorized: boolean;
  groupByCategory: boolean;
  onGroupByCategory: (v: boolean) => void;
  compact?: boolean;
};

export function StockListToolbar({
  lang,
  listSort,
  onListSort,
  listFilter,
  onListFilter,
  stockCategoryFilter,
  onStockCategoryFilter,
  stockCategoryPicklist,
  stockHasUncategorized,
  groupByCategory,
  onGroupByCategory,
  compact = false,
}: Props) {
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-1.5">
          <button
            type="button"
            onClick={() => onListFilter("all")}
            className={`min-h-[32px] rounded-full px-3 py-1 text-xs font-black ${
              listFilter === "all" ? "bg-waka-600 text-white shadow-sm" : "border border-border bg-card text-muted-foreground"
            }`}
          >
            {t(lang, "stockFilterAll")}
          </button>
          <button
            type="button"
            onClick={() => onListFilter("low")}
            className={`min-h-[32px] rounded-full px-3 py-1 text-xs font-black ${
              listFilter === "low" ? "bg-rose-600 text-white shadow-sm" : "border border-border bg-card text-muted-foreground"
            }`}
          >
            {t(lang, "stockFilterLow")}
          </button>
          <button
            type="button"
            onClick={() => onGroupByCategory(!groupByCategory)}
            className={`min-h-[32px] rounded-full px-3 py-1 text-xs font-black ${
              groupByCategory ? "bg-foreground text-background" : "border border-border bg-card text-muted-foreground"
            }`}
          >
            {t(lang, "stockGroupByCategory")}
          </button>
      </div>

      <div className={compact ? "flex flex-wrap gap-2" : "grid grid-cols-2 gap-2 sm:grid-cols-3"}>
        <label className={compact ? "min-w-[7rem] flex-1" : "block sm:col-span-1"}>
          <span className="mb-1 block text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
            {t(lang, "stockListSortLabel")}
          </span>
          <select
            value={listSort}
            onChange={(e) => onListSort(e.target.value as SortKey)}
            className="min-h-[36px] w-full rounded-xl border border-border bg-card px-2.5 py-1.5 text-xs font-bold text-foreground"
          >
            <option value="name_az">{t(lang, "stockSortNameAz")}</option>
            <option value="name_za">{t(lang, "stockSortNameZa")}</option>
            <option value="stock_low">{t(lang, "stockSortStockLow")}</option>
            <option value="updated">{t(lang, "stockSortUpdatedNew")}</option>
          </select>
        </label>
        <label className={compact ? "min-w-[8rem] flex-[2]" : "block sm:col-span-2"}>
          <span className="mb-1 block text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
            {t(lang, "stockFilterCategoryLabel")}
          </span>
          <select
            value={stockCategoryFilter}
            onChange={(e) => onStockCategoryFilter(e.target.value)}
            className="min-h-[36px] w-full rounded-xl border border-border bg-card px-2.5 py-1.5 text-xs font-bold text-foreground"
          >
            <option value={CATEGORY_FILTER_ALL}>{t(lang, "posCategoryAll")}</option>
            {stockHasUncategorized ? <option value={UNCATEGORIZED_SENTINEL}>{t(lang, "uncategorized")}</option> : null}
            {stockCategoryPicklist.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </label>
      </div>
    </div>
  );
}
