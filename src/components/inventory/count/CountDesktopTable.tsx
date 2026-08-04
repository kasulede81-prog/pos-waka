import { useMemo } from "react";
import clsx from "clsx";
import type { BusinessType, InventoryCountLine, Language, Product } from "../../../types";
import { t } from "../../../lib/i18n";
import { inventoryCountLineHasStockDrift } from "../../../lib/inventoryCount";
import { inventoryCountVarianceTone, varianceToneClass } from "../../../lib/countWorkspace";
import { statusTokens } from "../../../lib/statusTokens";
import { EnterpriseDataTable, type EnterpriseDataColumn } from "../../enterprise/data-table";
import { themeUi } from "../../../lib/themeTokens";
import { PharmacyCountExtension } from "./PharmacyCountExtension";

type Props = {
  lang: Language;
  lines: InventoryCountLine[];
  productById: Map<string, Product>;
  businessType: BusinessType;
  pharmacyModeEnabled?: boolean;
  showReview?: boolean;
  canCount?: boolean;
  qtyDraft: Record<string, string>;
  /** Kept for API parity with mobile cards; desktop edits qty inline. */
  reasonDraft?: Record<string, string>;
  onQtyChange: (productId: string, value: string) => void;
  onReasonChange?: (productId: string, value: string) => void;
  onSave: (productId: string) => void;
};

/** Phase 31.1 — desktop table-first inventory count lines. */
export function CountDesktopTable({
  lang,
  lines,
  productById,
  businessType,
  pharmacyModeEnabled,
  showReview,
  canCount,
  qtyDraft,
  onQtyChange,
  onSave,
}: Props) {
  const columns: EnterpriseDataColumn<InventoryCountLine>[] = useMemo(
    () => [
      {
        id: "product",
        header: t(lang, "inventoryTableProduct"),
        width: "minmax(160px,2fr)",
        cell: (line) => {
          const product = productById.get(line.productId);
          return (
            <div className="min-w-0">
              <p className="truncate font-bold text-foreground">{line.productName ?? line.productId}</p>
              {product ? (
                <PharmacyCountExtension
                  lang={lang}
                  product={product}
                  businessType={businessType}
                  pharmacyModeEnabled={pharmacyModeEnabled}
                />
              ) : null}
            </div>
          );
        },
      },
      {
        id: "sku",
        header: t(lang, "inventoryTableSku"),
        width: "minmax(80px,0.8fr)",
        hideBelow: "lg",
        cell: (line) => productById.get(line.productId)?.sku?.trim() || "—",
      },
      {
        id: "snapshot",
        header: t(lang, "inventoryCountSnapshotStock"),
        width: "minmax(72px,0.7fr)",
        align: "right",
        cell: (line) => String(line.expectedQtySnapshot),
      },
      {
        id: "counted",
        header: t(lang, "inventoryCountCounted"),
        width: "minmax(100px,1fr)",
        cell: (line) =>
          canCount ? (
            <input
              type="text"
              inputMode="decimal"
              value={qtyDraft[line.productId] ?? (line.countedQty != null ? String(line.countedQty) : "")}
              onChange={(e) => onQtyChange(line.productId, e.target.value)}
              className="min-h-[36px] w-full rounded-lg border border-input bg-card px-2 text-sm font-bold tabular-nums"
              aria-label={t(lang, "inventoryCountCounted")}
            />
          ) : (
            <span className="font-bold tabular-nums">{line.countedQty ?? "—"}</span>
          ),
      },
      {
        id: "variance",
        header: t(lang, "inventoryCountTotalVariance"),
        width: "minmax(72px,0.7fr)",
        align: "right",
        hideBelow: "lg",
        cell: (line) => {
          if (line.varianceQty == null) return "—";
          const tone = inventoryCountVarianceTone(line.varianceQty);
          return (
            <span className={clsx("font-bold tabular-nums", varianceToneClass(tone))}>
              {line.varianceQty >= 0 ? "+" : ""}
              {line.varianceQty}
            </span>
          );
        },
      },
      {
        id: "status",
        header: t(lang, "inventoryTableStatus"),
        width: "minmax(88px,0.8fr)",
        cell: (line) => {
          const product = productById.get(line.productId);
          const drift = inventoryCountLineHasStockDrift(line, product);
          if (drift && showReview) return <span className={statusTokens.warning.badge}>Drift</span>;
          if (line.countedQty != null) return <span className={statusTokens.success.badge}>OK</span>;
          return <span className={statusTokens.pending.badge}>—</span>;
        },
      },
    ],
    [lang, productById, businessType, pharmacyModeEnabled, canCount, qtyDraft, showReview, onQtyChange],
  );

  return (
    <EnterpriseDataTable
      rows={lines}
      columns={columns}
      rowKey={(line) => line.id}
      minWidthPx={920}
      estimateRowHeight={56}
      ariaLabel={t(lang, "inventoryCountTitle")}
      rowActions={
        canCount
          ? (line) => (
              <button
                type="button"
                onClick={() => onSave(line.productId)}
                className={clsx(themeUi.btnPrimary, "min-h-[36px] px-3 py-1.5 text-xs")}
              >
                {t(lang, "inventoryCountSaveQty")}
              </button>
            )
          : undefined
      }
    />
  );
}
