import type { Language } from "../../types";
import { t } from "../../lib/i18n";
import { CATEGORY_FILTER_ALL, UNCATEGORIZED_SENTINEL } from "../../lib/productCategories";

type SortKey = "name_az" | "name_za" | "stock_low" | "updated";

type Props = {
  lang: Language;
  listQuery: string;
  onListQuery: (q: string) => void;
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
};

export function StockListToolbar({
  lang,
  listQuery,
  onListQuery,
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
}: Props) {
  return (
    <div className="space-y-3">
      <label className="block">
        <span className="sr-only">{t(lang, "stockListSearchPh")}</span>
        <input
          value={listQuery}
          onChange={(e) => onListQuery(e.target.value)}
          placeholder={t(lang, "stockListSearchPh")}
          className="min-h-[48px] w-full rounded-2xl border-2 border-slate-200 px-4 py-3 text-base font-semibold text-slate-900 outline-none ring-waka-200 focus:ring"
        />
      </label>

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => onListFilter("all")}
          className={`min-h-[40px] rounded-full px-4 py-2 text-sm font-black ${
            listFilter === "all" ? "bg-waka-600 text-white shadow-sm" : "border-2 border-slate-200 bg-white text-slate-700"
          }`}
        >
          {t(lang, "stockFilterAll")}
        </button>
        <button
          type="button"
          onClick={() => onListFilter("low")}
          className={`min-h-[40px] rounded-full px-4 py-2 text-sm font-black ${
            listFilter === "low" ? "bg-rose-600 text-white shadow-sm" : "border-2 border-slate-200 bg-white text-slate-700"
          }`}
        >
          {t(lang, "stockFilterLow")}
        </button>
        <button
          type="button"
          onClick={() => onGroupByCategory(!groupByCategory)}
          className={`min-h-[40px] rounded-full px-4 py-2 text-sm font-black ${
            groupByCategory ? "bg-slate-900 text-white" : "border-2 border-slate-200 bg-white text-slate-700"
          }`}
        >
          {t(lang, "stockGroupByCategory")}
        </button>
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        <label className="block sm:col-span-1">
          <span className="mb-1 block text-xs font-bold text-slate-500">{t(lang, "stockListSortLabel")}</span>
          <select
            value={listSort}
            onChange={(e) => onListSort(e.target.value as SortKey)}
            className="min-h-[44px] w-full rounded-xl border-2 border-slate-200 bg-white px-3 py-2 text-sm font-bold text-slate-900"
          >
            <option value="name_az">{t(lang, "stockSortNameAz")}</option>
            <option value="name_za">{t(lang, "stockSortNameZa")}</option>
            <option value="stock_low">{t(lang, "stockSortStockLow")}</option>
            <option value="updated">{t(lang, "stockSortUpdatedNew")}</option>
          </select>
        </label>
        <label className="block sm:col-span-2">
          <span className="mb-1 block text-xs font-bold text-slate-500">{t(lang, "stockFilterCategoryLabel")}</span>
          <select
            value={stockCategoryFilter}
            onChange={(e) => onStockCategoryFilter(e.target.value)}
            className="min-h-[44px] w-full rounded-xl border-2 border-slate-200 bg-white px-3 py-2 text-sm font-bold text-slate-900"
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
