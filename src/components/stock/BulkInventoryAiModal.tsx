import { useEffect, useMemo, useState } from "react";
import { Sparkles } from "lucide-react";
import type { Language } from "../../types";
import { t, tTemplate } from "../../lib/i18n";
import { ModalSheet } from "../layout/ModalSheet";
import { formatAiErrorMessage } from "../../lib/ai/aiErrors";
import {
  generateBulkInventoryWithAi,
  mapBulkRowsToQuickAdd,
  type BulkInventoryPreviewRow,
} from "../../lib/ai/bulkInventoryAi";
import { WakaCheckbox } from "../enterprise/WakaCheckbox";
import { WakaButton } from "../ui/wakaPrimitives";
import { usePosStore } from "../../store/usePosStore";
import { applySharedCategoryToRows, isCatalogHierarchyEnabled } from "../../lib/catalogHierarchy";
import { ShelfDestinationPicker } from "./ShelfDestinationPicker";

type Props = {
  lang: Language;
  open: boolean;
  onClose: () => void;
  businessType: string;
  shopName: string;
  productSlotsLeft: number | null;
  onImport: (rows: ReturnType<typeof mapBulkRowsToQuickAdd>) => { added: number; skipped: number };
};

export function BulkInventoryAiModal({
  lang,
  open,
  onClose,
  businessType,
  shopName,
  productSlotsLeft,
  onImport,
}: Props) {
  const [description, setDescription] = useState("");
  const [rows, setRows] = useState<BulkInventoryPreviewRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errorCode, setErrorCode] = useState<string | null>(null);
  const [importResult, setImportResult] = useState<string | null>(null);
  const [sharedShelf, setSharedShelf] = useState("");
  const hierarchyOn = usePosStore((s) => isCatalogHierarchyEnabled(s.preferences));

  useEffect(() => {
    if (!open) return;
    setDescription(shopName.trim() ? `${shopName.trim()} — ${businessType}` : businessType);
    setRows([]);
    setLoading(false);
    setError(null);
    setErrorCode(null);
    setImportResult(null);
    setSharedShelf("");
  }, [open, shopName, businessType]);

  const selectedCount = useMemo(() => rows.filter((r) => r.enabled).length, [rows]);
  const importableCount = useMemo(() => mapBulkRowsToQuickAdd(rows).length, [rows]);
  const slotCap = productSlotsLeft ?? Number.POSITIVE_INFINITY;

  const handleGenerate = async () => {
    setLoading(true);
    setError(null);
    setErrorCode(null);
    setImportResult(null);
    const result = await generateBulkInventoryWithAi({
      shopDescription: description,
      businessType,
    });
    setLoading(false);
    if (!result.ok) {
      setError(result.error);
      setErrorCode(result.errorCode ?? null);
      return;
    }
    setRows(result.products);
  };

  const handleImport = () => {
    const payload = mapBulkRowsToQuickAdd(rows);
    if (payload.length === 0) {
      setError(t(lang, "aiBulkImportNeedPrices"));
      return;
    }
    const capped = payload.slice(0, slotCap);
    const result = onImport(capped);
    setImportResult(
      tTemplate(lang, "aiBulkImportDone", {
        added: String(result.added),
        skipped: String(result.skipped),
      }),
    );
    if (result.added > 0) onClose();
  };

  const updateRow = (index: number, patch: Partial<BulkInventoryPreviewRow>) => {
    setRows((prev) => prev.map((r, i) => (i === index ? { ...r, ...patch } : r)));
  };

  return (
    <ModalSheet
      open={open}
      onClose={onClose}
      zIndexClass="z-[59]"
      panelClassName="!max-w-2xl"
      title={
        <div className="flex items-start gap-3">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-trial-muted text-trial">
            <Sparkles className="h-5 w-5" aria-hidden />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-lg font-bold text-foreground">{t(lang, "aiBulkTitle")}</p>
            <p className="mt-1 text-sm font-semibold text-muted-foreground">{t(lang, "aiBulkSub")}</p>
          </div>
        </div>
      }
      footer={
        rows.length === 0 ? (
          <WakaButton
            type="button"
            variant="primary"
            className="w-full !min-h-[56px] !text-lg"
            disabled={loading || !description.trim()}
            onClick={() => void handleGenerate()}
          >
            {t(lang, "aiBulkGenerate")}
          </WakaButton>
        ) : (
          <WakaButton
            type="button"
            variant="primary"
            className="w-full !min-h-[56px] !text-lg"
            disabled={importableCount === 0}
            onClick={handleImport}
          >
            {tTemplate(lang, "aiBulkImportBtn", { count: String(Math.min(importableCount, slotCap)) })}
          </WakaButton>
        )
      }
    >
      <div className="space-y-4">
        {rows.length === 0 ? (
          <label className="block">
            <span className="text-xs font-bold uppercase tracking-wide text-muted-foreground">{t(lang, "aiBulkDescriptionLabel")}</span>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              disabled={loading}
              className="mt-2 w-full rounded-2xl border-2 border-border px-4 py-3 text-base font-semibold outline-none ring-violet-300 focus:ring disabled:opacity-60"
            />
          </label>
        ) : null}

        {loading ? (
          <p className="rounded-2xl bg-trial-muted px-4 py-3 text-center text-base font-bold text-trial">
            {t(lang, "aiBulkGenerating")}
          </p>
        ) : null}

        {error ? (
          <p className="rounded-2xl bg-warning-muted px-4 py-3 text-sm font-semibold text-warning-foreground">
            {formatAiErrorMessage({ code: errorCode, detail: error })}
          </p>
        ) : null}

        {importResult ? (
          <p className="rounded-2xl bg-success-muted px-4 py-3 text-sm font-bold text-success">{importResult}</p>
        ) : null}

        {rows.length > 0 ? (
          <div className="space-y-2">
            <p className="text-sm font-bold text-muted-foreground">
              {tTemplate(lang, "aiBulkPreviewCount", { count: String(selectedCount) })}
            </p>
            {productSlotsLeft !== null ? (
              <p className="text-xs font-semibold text-primary">
                {tTemplate(lang, "aiBulkSlotsLeft", { count: String(productSlotsLeft) })}
              </p>
            ) : null}
            {rows.length > 0 && hierarchyOn ? (
              <div className="space-y-2 rounded-2xl border border-border p-3">
                <p className="text-sm font-bold text-foreground">{t(lang, "catalogApplyShelfToSet")}</p>
                <ShelfDestinationPicker
                  lang={lang}
                  options={[]}
                  value={sharedShelf}
                  onChange={(next) => {
                    setSharedShelf(next);
                    if (next.trim()) setRows((prev) => applySharedCategoryToRows(prev, next));
                  }}
                />
              </div>
            ) : null}
            <div className="overflow-x-auto rounded-2xl border border-border">
              <table className="min-w-full text-left text-sm">
                <thead className="bg-muted text-xs font-bold uppercase text-muted-foreground">
                  <tr>
                    <th className="px-2 py-2">✓</th>
                    <th className="px-2 py-2">{t(lang, "stockEditNameLabel")}</th>
                    <th className="px-2 py-2">{t(lang, "aiProductAssistCategory")}</th>
                    <th className="px-2 py-2">{t(lang, "stockEditPriceLabel")}</th>
                    <th className="px-2 py-2">{t(lang, "stockEditStockLabel")}</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row, i) => (
                    <tr key={`${row.name}-${i}`} className="border-t border-border">
                      <td className="px-2 py-2">
                        <WakaCheckbox
                          checked={row.enabled}
                          onCheckedChange={(checked) => updateRow(i, { enabled: checked })}
                          row={false}
                        />
                      </td>
                      <td className="px-2 py-2">
                        <input
                          value={row.name}
                          onChange={(e) => updateRow(i, { name: e.target.value })}
                          className="min-w-[120px] w-full rounded-lg border border-border px-2 py-1 font-semibold"
                        />
                      </td>
                      <td className="px-2 py-2">
                        <input
                          value={row.category}
                          onChange={(e) => updateRow(i, { category: e.target.value })}
                          className="min-w-[90px] w-full rounded-lg border border-border px-2 py-1"
                        />
                      </td>
                      <td className="px-2 py-2">
                        <input
                          value={String(row.priceUgx)}
                          onChange={(e) => updateRow(i, { priceUgx: Math.floor(Number(e.target.value.replace(/\D/g, "")) || 0) })}
                          inputMode="numeric"
                          className="w-24 rounded-lg border border-border px-2 py-1 font-semibold"
                        />
                      </td>
                      <td className="px-2 py-2">
                        <input
                          value={String(row.stockQty)}
                          onChange={(e) => updateRow(i, { stockQty: Math.max(0, Math.floor(Number(e.target.value.replace(/[^\d.]/g, "")) || 0)) })}
                          inputMode="numeric"
                          className="w-20 rounded-lg border border-border px-2 py-1"
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ) : null}
      </div>
    </ModalSheet>
  );
}
