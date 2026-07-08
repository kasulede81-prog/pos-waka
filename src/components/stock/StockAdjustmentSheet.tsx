import { useEffect, useMemo, useState, type FormEvent } from "react";
import type { Language, Product } from "../../types";
import { t } from "../../lib/i18n";
import { usePosStore } from "../../store/usePosStore";
import { useSessionActor } from "../../context/SessionActorContext";
import { dateKeyKampala } from "../../lib/datesUg";
import {
  adjustmentDeltaForReason,
  adjustmentWorkspaceMode,
  adjustStockReasonString,
  resolveAdjustmentReasons,
  type AdjustmentReasonId,
} from "../../lib/adjustmentWorkspace";
import { StockAdjustmentShell } from "../inventory/adjustments/StockAdjustmentShell";
import { AdjustmentReasonSelector } from "../inventory/adjustments/AdjustmentReasonSelector";
import { AdjustmentQuantityEditor } from "../inventory/adjustments/AdjustmentQuantityEditor";
import { AdjustmentMovementPreview } from "../inventory/adjustments/AdjustmentMovementPreview";
import { AdjustmentSummaryPanel } from "../inventory/adjustments/AdjustmentSummaryPanel";
import { AdjustmentHistoryCard } from "../inventory/adjustments/AdjustmentHistoryCard";
import { AdjustmentFooter } from "../inventory/adjustments/AdjustmentFooter";
import { AdjustmentStatusStrip } from "../inventory/adjustments/AdjustmentStatusStrip";

type Props = {
  lang: Language;
  open: boolean;
  product?: Product | null;
  onClose: () => void;
  onDone?: () => void;
};

export function StockAdjustmentSheet({ lang, open, product: initialProduct, onClose, onDone }: Props) {
  const actor = useSessionActor();
  const preferences = usePosStore((s) => s.preferences);
  const products = usePosStore((s) => s.products);
  const stockMovements = usePosStore((s) => s.stockMovements);
  const adjustStock = usePosStore((s) => s.adjustStock);

  const [productId, setProductId] = useState("");
  const [reasonId, setReasonId] = useState<AdjustmentReasonId>("decrease");
  const [quantity, setQuantity] = useState("1");
  const [note, setNote] = useState("");
  const [direction, setDirection] = useState<"in" | "out">("out");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const mode = adjustmentWorkspaceMode(preferences.businessType, preferences.pharmacyModeEnabled);
  const reasons = useMemo(() => resolveAdjustmentReasons(mode), [mode]);
  const reasonDef = reasons.find((r) => r.id === reasonId) ?? reasons[0]!;

  const product = useMemo(() => {
    if (initialProduct) return initialProduct;
    return products.find((p) => p.id === productId) ?? null;
  }, [initialProduct, productId, products]);

  useEffect(() => {
    if (!open) return;
    setProductId(initialProduct?.id ?? "");
    setReasonId("decrease");
    setQuantity("1");
    setNote("");
    setDirection("out");
    setError(null);
  }, [open, initialProduct?.id]);

  const qtyN = Math.max(0, Number(quantity) || 0);
  const delta = qtyN > 0 ? adjustmentDeltaForReason(reasonDef, qtyN, direction) : 0;
  const inventoryValueUgx = product ? Math.round(product.stockOnHand * Math.max(0, product.costPricePerUnitUgx)) : 0;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!product) {
      setError(t(lang, "adjProductRequired"));
      return;
    }
    if (qtyN <= 0) {
      setError(t(lang, "invalidQty"));
      return;
    }
    if (reasonId === "inventory_count") {
      setError(t(lang, "adjUseInventoryCount"));
      return;
    }
    if (["expired", "supplier_return", "controlled_return", "batch_correction"].includes(reasonId)) {
      setError(t(lang, "adjUsePharmacyTools"));
      return;
    }

    setBusy(true);
    const reasonStr = adjustStockReasonString(reasonDef, note);
    const r = adjustStock(product.id, delta, reasonStr);
    setBusy(false);

    if (!r.ok) {
      setError(t(lang, r.errorKey ?? "invalid"));
      return;
    }
    onDone?.();
    onClose();
  };

  return (
    <StockAdjustmentShell
      lang={lang}
      open={open}
      title={t(lang, "adjSheetTitle")}
      subtitle={product?.name}
      error={error}
      onSubmit={submit}
      onRequestClose={onClose}
      statusStrip={<AdjustmentStatusStrip lang={lang} />}
      footer={
        <AdjustmentFooter
          lang={lang}
          onCancel={onClose}
          primaryLabelKey="adjApplyCta"
          primaryDisabled={!product || qtyN <= 0}
          primaryBusy={busy}
        />
      }
    >
      {!initialProduct ? (
        <label className="block">
          <span className="text-sm font-bold text-foreground">{t(lang, "adjSelectProduct")}</span>
          <select
            value={productId}
            onChange={(e) => setProductId(e.target.value)}
            className="mt-2 min-h-[52px] w-full rounded-2xl border border-input bg-card px-4 text-base font-bold"
          >
            <option value="">{t(lang, "adjSelectProductPh")}</option>
            {products.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name} ({p.stockOnHand})
              </option>
            ))}
          </select>
        </label>
      ) : null}

      <AdjustmentReasonSelector lang={lang} reasons={reasons} value={reasonId} onChange={(id) => setReasonId(id as AdjustmentReasonId)} />

      <AdjustmentQuantityEditor
        lang={lang}
        quantity={quantity}
        onQuantityChange={setQuantity}
        note={note}
        onNoteChange={setNote}
        showDirection={reasonDef.direction === "either"}
        direction={direction}
        onDirectionChange={setDirection}
        unitLabel={product?.baseUnit}
      />

      {product && delta !== 0 ? (
        <>
          <AdjustmentMovementPreview
            lang={lang}
            currentStock={product.stockOnHand}
            adjustment={delta}
            unitLabel={product.baseUnit}
          />
          <AdjustmentSummaryPanel
            lang={lang}
            productName={product.name}
            reasonLabel={t(lang, reasonDef.labelKey)}
            quantity={qtyN}
            currentStock={product.stockOnHand}
            newStock={product.stockOnHand + delta}
            inventoryValueUgx={inventoryValueUgx}
            operatorName={actor.displayName ?? actor.userId}
            businessDate={dateKeyKampala(new Date())}
          />
          <AdjustmentHistoryCard lang={lang} movements={stockMovements} productId={product.id} />
        </>
      ) : null}
    </StockAdjustmentShell>
  );
}
