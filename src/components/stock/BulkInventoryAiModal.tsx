import { useEffect, useMemo, useState } from "react";
import { Sparkles } from "lucide-react";
import type { Language } from "../../types";
import { t, tTemplate } from "../../lib/i18n";
import { AppModalOverlay } from "../layout/AppModalOverlay";
import { formatAiErrorMessage } from "../../lib/ai/aiErrors";
import {
  generateBulkInventoryWithAi,
  mapBulkRowsToQuickAdd,
  type BulkInventoryPreviewRow,
} from "../../lib/ai/bulkInventoryAi";
import { WakaCheckbox } from "../enterprise/WakaCheckbox";

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

  useEffect(() => {
    if (!open) return;
    setDescription(shopName.trim() ? `${shopName.trim()} — ${businessType}` : businessType);
    setRows([]);
    setLoading(false);
    setError(null);
    setErrorCode(null);
    setImportResult(null);
  }, [open, shopName, businessType]);

  const selectedCount = useMemo(() => rows.filter((r) => r.enabled).length, [rows]);
  const importableCount = useMemo(() => mapBulkRowsToQuickAdd(rows).length, [rows]);
  const slotCap = productSlotsLeft ?? Number.POSITIVE_INFINITY;

  if (!open) return null;

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
    <AppModalOverlay
      className="z-[59] flex items-end justify-center bg-black/55 sm:items-center"
      role="dialog"
      aria-modal
      onClick={onClose}
    >
      <div
        className="flex max-h-[94vh] w-full max-w-2xl flex-col rounded-t-[1.75rem] bg-card shadow-2xl sm:max-h-[90vh] sm:rounded-3xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="shrink-0 border-b border-border px-5 pb-4 pt-5">
          <div className="flex items-start gap-3">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-violet-100 text-violet-700">
              <Sparkles className="h-5 w-5" aria-hidden />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-lg font-black text-foreground">{t(lang, "aiBulkTitle")}</p>
              <p className="mt-1 text-sm font-semibold text-muted-foreground">{t(lang, "aiBulkSub")}</p>
            </div>
            <button type="button" onClick={onClose} className="shrink-0 rounded-xl px-2 py-1 text-sm font-bold text-muted-foreground">
              {t(lang, "cancel")}
            </button>
          </div>
        </div>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-4">
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
            <p className="rounded-2xl bg-violet-50 px-4 py-3 text-center text-base font-bold text-violet-900">
              {t(lang, "aiBulkGenerating")}
            </p>
          ) : null}

          {error ? (
            <p className="rounded-2xl bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-950">
              {formatAiErrorMessage({ code: errorCode, detail: error })}
            </p>
          ) : null}

          {importResult ? (
            <p className="rounded-2xl bg-emerald-50 px-4 py-3 text-sm font-bold text-emerald-900">{importResult}</p>
          ) : null}

          {rows.length > 0 ? (
            <div className="space-y-2">
              <p className="text-sm font-bold text-muted-foreground">
                {tTemplate(lang, "aiBulkPreviewCount", { count: String(selectedCount) })}
              </p>
              {productSlotsLeft !== null ? (
                <p className="text-xs font-semibold text-waka-800">
                  {tTemplate(lang, "aiBulkSlotsLeft", { count: String(productSlotsLeft) })}
                </p>
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

        <div className="shrink-0 space-y-2 border-t border-border p-5">
          {rows.length === 0 ? (
            <button
              type="button"
              disabled={loading || !description.trim()}
              onClick={() => void handleGenerate()}
              className="min-h-[56px] w-full rounded-2xl bg-violet-600 text-lg font-black text-white shadow-md disabled:opacity-50"
            >
              {t(lang, "aiBulkGenerate")}
            </button>
          ) : (
            <button
              type="button"
              disabled={importableCount === 0}
              onClick={handleImport}
              className="min-h-[56px] w-full rounded-2xl bg-waka-600 text-lg font-black text-white shadow-md disabled:opacity-50"
            >
              {tTemplate(lang, "aiBulkImportBtn", { count: String(Math.min(importableCount, slotCap)) })}
            </button>
          )}
        </div>
      </div>
    </AppModalOverlay>
  );
}
