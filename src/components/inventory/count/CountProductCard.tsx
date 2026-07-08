import { Check } from "lucide-react";
import clsx from "clsx";
import type { Language, InventoryCountLine, Product, BusinessType } from "../../../types";
import { t } from "../../../lib/i18n";
import { inventoryCountLineHasStockDrift } from "../../../lib/inventoryCount";
import { inventoryCountVarianceTone, varianceToneClass } from "../../../lib/countWorkspace";
import { WIZARD_BTN_FOOTER_BASE, WIZARD_INPUT_NUMERIC, WIZARD_INPUT_TEXT, COUNT_FIELD_LABEL } from "./countTokens";
import { CountVariancePreview } from "./CountVariancePreview";
import { PharmacyCountExtension } from "./PharmacyCountExtension";

type Props = {
  lang: Language;
  line: InventoryCountLine;
  product?: Product;
  businessType: BusinessType;
  pharmacyModeEnabled?: boolean;
  showReview?: boolean;
  canCount?: boolean;
  qtyValue: string;
  reasonValue: string;
  onQtyChange: (value: string) => void;
  onReasonChange: (value: string) => void;
  onSave: () => void;
};

export function CountProductCard({
  lang,
  line,
  product,
  businessType,
  pharmacyModeEnabled,
  showReview,
  canCount,
  qtyValue,
  reasonValue,
  onQtyChange,
  onReasonChange,
  onSave,
}: Props) {
  const drift = inventoryCountLineHasStockDrift(line, product);
  const currentStock = product?.stockOnHand ?? null;
  const varianceTone = inventoryCountVarianceTone(line.varianceQty);
  const shelf = product?.category?.trim() || "—";
  const sku = product?.sku?.trim() || "—";

  return (
    <li className="rounded-2xl border border-border/60 bg-card p-4 shadow-sm">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-base font-black text-foreground">{line.productName ?? line.productId}</p>
          <p className="mt-0.5 text-xs font-semibold text-muted-foreground">
            {t(lang, "cntSku")}: {sku} · {t(lang, "cntShelf")}: {shelf}
          </p>
          {product ? (
            <PharmacyCountExtension
              lang={lang}
              product={product}
              businessType={businessType}
              pharmacyModeEnabled={pharmacyModeEnabled}
            />
          ) : null}
        </div>
        {line.countedQty != null ? (
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-emerald-800">
            <Check className="h-4 w-4" aria-hidden />
          </span>
        ) : null}
      </div>

      <dl className="mt-3 grid grid-cols-2 gap-2 text-xs font-semibold text-muted-foreground">
        <div>
          <dt>{t(lang, "inventoryCountSnapshotStock")}</dt>
          <dd className="text-sm font-black text-foreground">{line.expectedQtySnapshot}</dd>
        </div>
        {showReview && currentStock != null ? (
          <div>
            <dt>{t(lang, "inventoryCountCurrentStock")}</dt>
            <dd className={clsx("text-sm font-black", drift ? "text-amber-700" : "text-foreground")}>
              {currentStock}
            </dd>
          </div>
        ) : null}
        {line.countedQty != null && !canCount ? (
          <>
            <div>
              <dt>{t(lang, "inventoryCountCounted")}</dt>
              <dd className="text-sm font-black text-foreground">{line.countedQty}</dd>
            </div>
            <div>
              <dt>{t(lang, "inventoryCountVariance")}</dt>
              <dd className={clsx("text-sm font-black", varianceToneClass(varianceTone))}>
                {line.varianceQty >= 0 ? "+" : ""}
                {line.varianceQty}
              </dd>
            </div>
            <div>
              <dt>{t(lang, "inventoryCountCostImpact")}</dt>
              <dd className="text-sm font-black text-foreground">UGX {line.varianceCostUgx.toLocaleString()}</dd>
            </div>
            <div>
              <dt>{t(lang, "inventoryCountRetailImpact")}</dt>
              <dd className="text-sm font-black text-foreground">UGX {line.varianceRetailUgx.toLocaleString()}</dd>
            </div>
          </>
        ) : null}
      </dl>

      {line.countedQty != null && showReview && !canCount ? (
        <div className="mt-3">
          <CountVariancePreview
            lang={lang}
            expected={line.expectedQtySnapshot}
            counted={line.countedQty}
            unitLabel={product?.baseUnit}
          />
        </div>
      ) : null}

      {canCount ? (
        <div className="mt-4 space-y-3">
          <label className="block">
            <span className={COUNT_FIELD_LABEL}>{t(lang, "inventoryCountCounted")}</span>
            <input
              type="text"
              inputMode="decimal"
              value={qtyValue}
              onChange={(e) => onQtyChange(e.target.value)}
              className={`${WIZARD_INPUT_NUMERIC} mt-2`}
            />
          </label>
          <label className="block">
            <span className={COUNT_FIELD_LABEL}>{t(lang, "inventoryCountReason")}</span>
            <input
              type="text"
              value={reasonValue}
              onChange={(e) => onReasonChange(e.target.value)}
              className={`${WIZARD_INPUT_TEXT} mt-2 text-base`}
            />
          </label>
          <button
            type="button"
            onClick={onSave}
            className={clsx(WIZARD_BTN_FOOTER_BASE, "w-full bg-primary text-primary-foreground hover:bg-primary/90")}
          >
            {t(lang, "inventoryCountSaveQty")}
          </button>
        </div>
      ) : null}
    </li>
  );
}
