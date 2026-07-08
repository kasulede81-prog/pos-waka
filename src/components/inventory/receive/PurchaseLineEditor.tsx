import type { ReactNode } from "react";
import type { Language, Product } from "../../../types";
import { RECEIVE_FIELD_LABEL, WIZARD_INPUT_NUMERIC } from "./receiveTokens";
import { ReceiveHeader } from "./ReceiveHeader";

type Props = {
  lang: Language;
  product: Product;
  productSubtitle?: string;
  quantityLabel: string;
  quantityValue: string;
  onQuantityChange: (value: string) => void;
  quantityInputMode?: "decimal" | "numeric";
  costLabel: string;
  costValue: string;
  onCostChange: (value: string) => void;
  costPlaceholder?: string;
  unitSelector?: ReactNode;
  preview?: ReactNode;
  extension?: ReactNode;
  notesLabel?: string;
  notesValue?: string;
  onNotesChange?: (value: string) => void;
};

export function PurchaseLineEditor({
  product,
  productSubtitle,
  quantityLabel,
  quantityValue,
  onQuantityChange,
  quantityInputMode = "decimal",
  costLabel,
  costValue,
  onCostChange,
  costPlaceholder,
  unitSelector,
  preview,
  extension,
  notesLabel,
  notesValue,
  onNotesChange,
}: Props) {
  const qtySanitize =
    quantityInputMode === "decimal"
      ? (v: string) => v.replace(/[^\d.]/g, "").slice(0, 8)
      : (v: string) => v.replace(/\D/g, "").slice(0, 12);

  return (
    <section className="space-y-4">
      <div>
        <ReceiveHeader title={product.name} />
        {productSubtitle ? <p className="mt-1 text-sm font-semibold text-muted-foreground">{productSubtitle}</p> : null}
      </div>

      {unitSelector}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className="block">
          <span className={RECEIVE_FIELD_LABEL}>{quantityLabel}</span>
          <input
            value={quantityValue}
            onChange={(e) => onQuantityChange(qtySanitize(e.target.value))}
            inputMode={quantityInputMode === "decimal" ? "decimal" : "numeric"}
            className={`${WIZARD_INPUT_NUMERIC} mt-2`}
          />
        </label>
        <label className="block">
          <span className={RECEIVE_FIELD_LABEL}>{costLabel}</span>
          <input
            value={costValue}
            onChange={(e) => onCostChange(e.target.value.replace(/\D/g, "").slice(0, 12))}
            inputMode="numeric"
            placeholder={costPlaceholder}
            className={`${WIZARD_INPUT_NUMERIC} mt-2`}
          />
        </label>
      </div>

      {preview}
      {extension}

      {notesLabel && onNotesChange ? (
        <label className="block">
          <span className={RECEIVE_FIELD_LABEL}>{notesLabel}</span>
          <input
            value={notesValue ?? ""}
            onChange={(e) => onNotesChange(e.target.value)}
            className={`${WIZARD_INPUT_NUMERIC} mt-2 text-base`}
          />
        </label>
      ) : null}
    </section>
  );
}
