import { useState } from "react";
import clsx from "clsx";
import { Archive, Download, MoreHorizontal, Package, Printer, Tag } from "lucide-react";
import type { Language, Product, ShopPreferences, Supplier } from "../../../types";
import { t } from "../../../lib/i18n";
import { usePosStore } from "../../../store/usePosStore";
import { useInventorySelection } from "../selection/useInventorySelection";
import {
  runInventoryBulkOperation,
  selectedProducts,
  type InventoryBulkOperation,
} from "./InventoryBulkOperations";
import { buildProductCatalogCsv, productCatalogExportFilename } from "../export/productCatalogExport";
import { printProductLabels, exportProductLabelsHtml } from "../export/productLabelPrint";
import { saveExportedFile } from "../../../lib/fileDownload";
import { AppModalOverlay } from "../../../components/layout/AppModalOverlay";

type Props = {
  lang: Language;
  products: Product[];
  filteredProducts: Product[];
  preferences: ShopPreferences;
  suppliers: Supplier[];
  canEdit: boolean;
  canAdjust: boolean;
  stockCategoryPicklist: string[];
  onClearSelection?: () => void;
};

type BulkSheet = "category" | "stock" | "price" | "more" | null;

export function InventoryBulkToolbar({
  lang,
  products,
  filteredProducts,
  preferences,
  suppliers,
  canEdit,
  canAdjust,
  stockCategoryPicklist,
  onClearSelection,
}: Props) {
  const { count, state, clear, exit } = useInventorySelection();
  const updateProduct = usePosStore((s) => s.updateProduct);
  const adjustStock = usePosStore((s) => s.adjustStock);
  const setPreferences = usePosStore((s) => s.setPreferences);
  const [busy, setBusy] = useState(false);
  const [sheet, setSheet] = useState<BulkSheet>(null);
  const [inputValue, setInputValue] = useState("");
  const [selectValue, setSelectValue] = useState("");

  if (count === 0) return null;

  const selected = selectedProducts(products, state.selectedIds);
  const bulkCtx = {
    lang,
    products,
    selectedIds: state.selectedIds,
    preferences,
    store: { updateProduct, adjustStock, setPreferences },
    setBusy,
  };

  const run = async (op: InventoryBulkOperation) => {
    await runInventoryBulkOperation(op, bulkCtx);
    setSheet(null);
    setInputValue("");
    setSelectValue("");
  };

  const exportSelected = async () => {
    const csv = buildProductCatalogCsv(lang, selected);
    await saveExportedFile(productCatalogExportFilename("selected"), csv, "text/csv");
  };

  const exportFiltered = async () => {
    const csv = buildProductCatalogCsv(lang, filteredProducts);
    await saveExportedFile(productCatalogExportFilename("filtered"), csv, "text/csv");
  };

  return (
    <>
      <div
        className="fixed inset-x-0 bottom-[calc(env(safe-area-inset-bottom,0px)+4.5rem)] z-40 mx-auto max-w-3xl px-3 md:bottom-6"
        role="toolbar"
        aria-label={t(lang, "inventoryBulkToolbarLabel")}
      >
        <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-indigo-300 bg-indigo-950 px-3 py-2.5 text-white shadow-2xl">
          <span className="text-xs font-black">
            {t(lang, "inventoryBulkSelected").replace("{count}", String(count))}
          </span>
          <div className="flex flex-1 flex-wrap gap-1.5">
            {canEdit ? (
              <>
                <BulkBtn icon={Tag} label={t(lang, "inventoryBulkCategory")} onClick={() => setSheet("category")} />
                <BulkBtn icon={Package} label={t(lang, "inventoryBulkStock")} onClick={() => setSheet("stock")} disabled={!canAdjust} />
                <BulkBtn icon={Tag} label={t(lang, "inventoryBulkPrice")} onClick={() => setSheet("price")} />
              </>
            ) : null}
            <BulkBtn icon={Download} label={t(lang, "inventoryBulkExport")} onClick={() => void exportSelected()} />
            <BulkBtn icon={Printer} label={t(lang, "inventoryBulkLabels")} onClick={() => printProductLabels(lang, selected)} />
            <BulkBtn icon={MoreHorizontal} label={t(lang, "inventoryBulkMore")} onClick={() => setSheet("more")} />
          </div>
          <button
            type="button"
            onClick={() => {
              clear();
              exit();
              onClearSelection?.();
            }}
            className="min-h-[32px] rounded-lg border border-white/20 px-2 text-[10px] font-black"
          >
            {t(lang, "inventoryClearSelection")}
          </button>
        </div>
      </div>

      {sheet ? (
        <AppModalOverlay className="z-[80] flex items-end justify-center bg-black/50 p-4 sm:items-center" onClick={() => setSheet(null)}>
          <div
            className="w-full max-w-md rounded-2xl bg-card p-4 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal
          >
            {sheet === "category" ? (
              <>
                <h3 className="mb-3 text-sm font-black">{t(lang, "inventoryBulkCategory")}</h3>
                <select
                  value={selectValue}
                  onChange={(e) => setSelectValue(e.target.value)}
                  className="mb-3 min-h-[40px] w-full rounded-xl border border-border px-2 text-sm font-bold"
                >
                  <option value="">{t(lang, "inventoryBulkChooseShelf")}</option>
                  {stockCategoryPicklist.map((c) => (
                    <option key={c} value={c}>{c}</option>
                  ))}
                </select>
                <ModalActions
                  lang={lang}
                  busy={busy}
                  onCancel={() => setSheet(null)}
                  onConfirm={() => selectValue && void run({ kind: "category", category: selectValue })}
                />
              </>
            ) : null}
            {sheet === "stock" ? (
              <>
                <h3 className="mb-3 text-sm font-black">{t(lang, "inventoryBulkStock")}</h3>
                <select
                  value={selectValue}
                  onChange={(e) => setSelectValue(e.target.value)}
                  className="mb-2 min-h-[40px] w-full rounded-xl border border-border px-2 text-sm font-bold"
                >
                  <option value="increase">{t(lang, "inventoryBulkStockIncrease")}</option>
                  <option value="reduce">{t(lang, "inventoryBulkStockReduce")}</option>
                  <option value="set">{t(lang, "inventoryBulkStockSet")}</option>
                </select>
                <input
                  type="number"
                  min={0}
                  value={inputValue}
                  onChange={(e) => setInputValue(e.target.value)}
                  placeholder={t(lang, "inventoryBulkStockQty")}
                  className="mb-3 min-h-[40px] w-full rounded-xl border border-border px-2 text-sm font-bold"
                />
                <ModalActions
                  lang={lang}
                  busy={busy}
                  onCancel={() => setSheet(null)}
                  onConfirm={() => {
                    const v = Number(inputValue);
                    if (!Number.isFinite(v)) return;
                    const mode = (selectValue || "increase") as "increase" | "reduce" | "set";
                    void run({ kind: "stock", mode, value: v, reason: "Bulk inventory adjustment" });
                  }}
                />
              </>
            ) : null}
            {sheet === "price" ? (
              <>
                <h3 className="mb-3 text-sm font-black">{t(lang, "inventoryBulkPrice")}</h3>
                <input
                  type="number"
                  min={0}
                  value={inputValue}
                  onChange={(e) => setInputValue(e.target.value)}
                  placeholder={t(lang, "inventoryBulkPriceSet")}
                  className="mb-3 min-h-[40px] w-full rounded-xl border border-border px-2 text-sm font-bold"
                />
                <ModalActions
                  lang={lang}
                  busy={busy}
                  onCancel={() => setSheet(null)}
                  onConfirm={() => {
                    const v = Number(inputValue);
                    if (!Number.isFinite(v)) return;
                    void run({ kind: "sellingPrice", mode: "set", valueUgx: v });
                  }}
                />
              </>
            ) : null}
            {sheet === "more" ? (
              <>
                <h3 className="mb-3 text-sm font-black">{t(lang, "inventoryBulkMore")}</h3>
                <div className="space-y-2">
                  <button type="button" className="w-full rounded-xl border border-border px-3 py-2 text-left text-xs font-bold" onClick={() => void exportFiltered()}>
                    {t(lang, "inventoryExportFiltered")}
                  </button>
                  <button type="button" className="w-full rounded-xl border border-border px-3 py-2 text-left text-xs font-bold" onClick={() => exportProductLabelsHtml(lang, selected)}>
                    {t(lang, "inventoryExportLabels")}
                  </button>
                  {canEdit ? (
                    <>
                      <button type="button" className="w-full rounded-xl border border-border px-3 py-2 text-left text-xs font-bold" onClick={() => void run({ kind: "archive" })}>
                        <Archive className="mr-1 inline h-3.5 w-3.5" />{t(lang, "inventoryBulkArchive")}
                      </button>
                      <button type="button" className="w-full rounded-xl border border-border px-3 py-2 text-left text-xs font-bold" onClick={() => void run({ kind: "unarchive" })}>
                        {t(lang, "inventoryBulkUnarchive")}
                      </button>
                      <button type="button" className="w-full rounded-xl border border-border px-3 py-2 text-left text-xs font-bold" onClick={() => void run({ kind: "deactivate" })}>
                        {t(lang, "inventoryBulkDeactivate")}
                      </button>
                      {suppliers[0] ? (
                        <button
                          type="button"
                          className="w-full rounded-xl border border-border px-3 py-2 text-left text-xs font-bold"
                          onClick={() => void run({ kind: "supplier", supplierId: suppliers[0]!.id, supplierName: suppliers[0]!.name })}
                        >
                          {t(lang, "inventoryBulkSupplier")}
                        </button>
                      ) : null}
                    </>
                  ) : null}
                </div>
                <button type="button" className="mt-3 w-full min-h-[40px] rounded-xl border border-border text-xs font-black" onClick={() => setSheet(null)}>
                  {t(lang, "cancel")}
                </button>
              </>
            ) : null}
          </div>
        </AppModalOverlay>
      ) : null}
    </>
  );
}

function BulkBtn({
  icon: Icon,
  label,
  onClick,
  disabled,
}: {
  icon: typeof Tag;
  label: string;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={clsx(
        "inline-flex min-h-[36px] items-center gap-1 rounded-lg bg-white/10 px-2.5 text-[10px] font-black hover:bg-white/20",
        disabled && "opacity-40",
      )}
    >
      <Icon className="h-3.5 w-3.5" />
      <span className="hidden sm:inline">{label}</span>
    </button>
  );
}

function ModalActions({
  lang,
  busy,
  onCancel,
  onConfirm,
}: {
  lang: Language;
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <div className="flex gap-2">
      <button type="button" onClick={onCancel} className="min-h-[40px] flex-1 rounded-xl border border-border text-xs font-black">
        {t(lang, "cancel")}
      </button>
      <button type="button" disabled={busy} onClick={onConfirm} className="min-h-[40px] flex-1 rounded-xl bg-waka-600 text-xs font-black text-white disabled:opacity-50">
        {t(lang, "apply")}
      </button>
    </div>
  );
}
