import type { Customer, Language, PharmacyPrescription, Product } from "../../../types";
import { t } from "../../../lib/i18n";
import { AppModalOverlay } from "../../layout/AppModalOverlay";
import { formatMedicineFullLabel } from "../../../lib/pharmacyMedicine";
import { daysUntilExpiry } from "../../../lib/pharmacyBatches";
import { PharmacyAllergyWarningBanner } from "../patient/PharmacyAllergyWarningBanner";

type Props = {
  lang: Language;
  prescription: PharmacyPrescription;
  products: Product[];
  patient: Customer | null;
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
};

export function PharmacyVerificationSheet({ lang, prescription, products, patient, open, onClose, onConfirm }: Props) {
  if (!open) return null;
  const byId = new Map(products.map((p) => [p.id, p]));

  return (
    <AppModalOverlay className="z-[78] flex items-end justify-center bg-black/50 p-0 sm:items-center sm:p-4">
      <div className="flex max-h-[92dvh] w-full max-w-2xl flex-col rounded-t-3xl bg-card shadow-2xl sm:rounded-3xl">
        <div className="shrink-0 border-b border-border px-4 py-4 sm:px-6">
          <h2 className="text-xl font-black text-foreground">{t(lang, "pharmacyRxVerifyTitle")}</h2>
          <p className="mt-1 text-sm font-semibold text-muted-foreground">
            {prescription.prescriptionNumber} · {prescription.patientName ?? t(lang, "pharmacyRxWalkIn")}
          </p>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3 sm:px-6">
          <PharmacyAllergyWarningBanner
            lang={lang}
            patient={patient}
            productIds={prescription.lines.map((l) => l.productId)}
          />
          <dl className="mb-4 grid gap-2 rounded-2xl bg-muted p-3 text-sm sm:grid-cols-2">
            <div>
              <dt className="font-bold text-muted-foreground">{t(lang, "pharmacyRxDoctor")}</dt>
              <dd className="font-black text-foreground">{prescription.doctorName ?? "—"}</dd>
            </div>
            <div>
              <dt className="font-bold text-muted-foreground">{t(lang, "pharmacyRxDate")}</dt>
              <dd className="font-black text-foreground">{prescription.prescriptionDate}</dd>
            </div>
          </dl>
          <ul className="space-y-3">
            {prescription.lines.map((line) => {
              const product = byId.get(line.productId);
              const controlled = product?.pharmacyMaster?.controlledDrug;
              const expiry = line.batchExpiry ?? product?.expiryDate;
              const nearExpiry = expiry ? daysUntilExpiry(expiry) <= 30 : false;
              return (
                <li key={line.id} className="rounded-2xl border-2 border-border p-4">
                  <p className="text-base font-black text-foreground">
                    {product ? formatMedicineFullLabel(product) : line.productName}
                  </p>
                  <p className="text-sm font-semibold text-muted-foreground">
                    {line.strength ?? product?.medicineStrength ?? "—"} · {line.quantityPrescribed}{" "}
                    {product?.baseUnit ?? "units"}
                  </p>
                  {line.directions ? (
                    <p className="mt-1 text-xs font-medium text-muted-foreground">{line.directions}</p>
                  ) : null}
                  <div className="mt-2 flex flex-wrap gap-2">
                    {line.batchNumber ? (
                      <span className="rounded-full bg-teal-50 px-2 py-0.5 text-[10px] font-black text-teal-900">
                        {t(lang, "pharmacyBatchNumber")}: {line.batchNumber}
                        {line.batchExpiry ? ` · ${line.batchExpiry}` : ""}
                      </span>
                    ) : null}
                    {controlled ? (
                      <span className="rounded-full bg-violet-100 px-2 py-0.5 text-[10px] font-black text-violet-900">
                        {t(lang, "pharmacyControlledBadge")}
                      </span>
                    ) : null}
                    {nearExpiry ? (
                      <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-black text-amber-900">
                        {t(lang, "pharmacyRxNearExpiryWarn")}
                      </span>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
        <div className="shrink-0 grid grid-cols-2 gap-2 border-t border-border p-4">
          <button type="button" onClick={onClose} className="min-h-[52px] rounded-2xl border-2 font-bold">
            {t(lang, "cancel")}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className="min-h-[52px] rounded-2xl bg-teal-600 text-base font-black text-white"
          >
            {t(lang, "pharmacyRxVerifyConfirm")}
          </button>
        </div>
      </div>
    </AppModalOverlay>
  );
}
