import type { Language } from "../../../types";
import { t } from "../../../lib/i18n";
import { RECEIVE_FIELD_LABEL, WIZARD_INPUT_TEXT } from "./receiveTokens";
import { ReceiveHeader } from "./ReceiveHeader";
import { ReceiveValidationBanner } from "./ReceiveValidationBanner";

type Props = {
  lang: Language;
  batchNumber: string;
  onBatchNumberChange: (value: string) => void;
  expiryDate: string;
  onExpiryDateChange: (value: string) => void;
  manufactureDate: string;
  onManufactureDateChange: (value: string) => void;
  purchaseInvoice?: string;
  onPurchaseInvoiceChange?: (value: string) => void;
  supplierLot?: string;
  onSupplierLotChange?: (value: string) => void;
  location?: string;
  onLocationChange?: (value: string) => void;
  controlledWarning?: string | null;
  fefoWarning?: string | null;
};

export function BatchReceiveExtension({
  lang,
  batchNumber,
  onBatchNumberChange,
  expiryDate,
  onExpiryDateChange,
  manufactureDate,
  onManufactureDateChange,
  purchaseInvoice,
  onPurchaseInvoiceChange,
  supplierLot,
  onSupplierLotChange,
  location,
  onLocationChange,
  controlledWarning,
  fefoWarning,
}: Props) {
  return (
    <section className="space-y-3 rounded-2xl border border-border/60 bg-muted/20 p-4">
      <ReceiveHeader title={t(lang, "receiveBatchSectionTitle")} />

      {controlledWarning ? <ReceiveValidationBanner message={controlledWarning} tone="warning" /> : null}
      {fefoWarning ? <ReceiveValidationBanner message={fefoWarning} tone="warning" /> : null}

      {onPurchaseInvoiceChange ? (
        <label className="block">
          <span className={RECEIVE_FIELD_LABEL}>{t(lang, "pharmacyPurchaseInvoice")}</span>
          <input
            value={purchaseInvoice ?? ""}
            onChange={(e) => onPurchaseInvoiceChange(e.target.value)}
            className={`${WIZARD_INPUT_TEXT} mt-2 text-base`}
          />
        </label>
      ) : null}

      <label className="block">
        <span className={RECEIVE_FIELD_LABEL}>{t(lang, "pharmacyBatchNumber")} *</span>
        <input
          required
          value={batchNumber}
          onChange={(e) => onBatchNumberChange(e.target.value)}
          className={`${WIZARD_INPUT_TEXT} mt-2 font-bold`}
        />
      </label>

      <div className="grid grid-cols-2 gap-3">
        <label className="block">
          <span className={RECEIVE_FIELD_LABEL}>{t(lang, "pharmacyExpiryDateLabel")} *</span>
          <input
            type="date"
            required
            value={expiryDate}
            onChange={(e) => onExpiryDateChange(e.target.value)}
            className={`${WIZARD_INPUT_TEXT} mt-2 text-base`}
          />
        </label>
        <label className="block">
          <span className={RECEIVE_FIELD_LABEL}>{t(lang, "pharmacyManufactureDate")}</span>
          <input
            type="date"
            value={manufactureDate}
            onChange={(e) => onManufactureDateChange(e.target.value)}
            className={`${WIZARD_INPUT_TEXT} mt-2 text-base`}
          />
        </label>
      </div>

      {onSupplierLotChange ? (
        <label className="block">
          <span className={RECEIVE_FIELD_LABEL}>{t(lang, "receiveBatchSupplierLot")}</span>
          <input
            value={supplierLot ?? ""}
            onChange={(e) => onSupplierLotChange(e.target.value)}
            className={`${WIZARD_INPUT_TEXT} mt-2 text-base`}
          />
        </label>
      ) : null}

      {onLocationChange ? (
        <label className="block">
          <span className={RECEIVE_FIELD_LABEL}>{t(lang, "pharmacyBatchLocation")}</span>
          <input
            value={location ?? ""}
            onChange={(e) => onLocationChange(e.target.value)}
            placeholder={t(lang, "pharmacyBatchLocationHint")}
            className={`${WIZARD_INPUT_TEXT} mt-2 text-base`}
          />
        </label>
      ) : null}
    </section>
  );
}
