import type { Language, PharmacyPrescription, Product, SaleLine } from "../../../types";
import { t } from "../../../lib/i18n";
import { prescriptionStatusLabelKey, prescriptionTypeLabelKey } from "../../../lib/pharmacyPrescriptions";
import { prescriptionHasControlledMedicines } from "../../../lib/pharmacyPrescriptions";

type Props = {
  lang: Language;
  selectedRx: PharmacyPrescription | null;
  products: Product[];
  draftLines: SaleLine[];
  dispenseMode: "otc" | "prescription" | null;
};

export function PharmacyCheckoutMetaStrip({ lang, selectedRx, products, draftLines, dispenseMode }: Props) {
  const controlledCount = draftLines.filter((line) => {
    const p = products.find((x) => x.id === line.productId);
    return Boolean(p?.pharmacyMaster?.controlledDrug);
  }).length;
  const batchLines = draftLines.filter(
    (l) => l.pharmacyBatchNumber || l.pharmacyBatchOverrideId || l.pharmacyBatchExpiry,
  ).length;

  return (
    <div className="flex flex-wrap gap-1.5 border-b border-border bg-muted px-2 py-1.5 text-[10px] font-bold text-muted-foreground">
      <span className="rounded-md bg-card px-2 py-1 ring-1 ring-border">
        {t(lang, "pharmacyDispenseType")}:{" "}
        {dispenseMode === "prescription"
          ? t(lang, "pharmacyDispenseTypeRx")
          : t(lang, "pharmacyDispenseTypeOtc")}
      </span>
      {selectedRx ? (
        <>
          <span className="rounded-md bg-card px-2 py-1 ring-1 ring-border">
            {t(lang, "pharmacyDispenseRxNumber")}: {selectedRx.prescriptionNumber}
          </span>
          <span className="rounded-md bg-card px-2 py-1 ring-1 ring-border">
            {t(lang, "pharmacyDispenseVerifyStatus")}: {t(lang, prescriptionStatusLabelKey(selectedRx.status))}
          </span>
          <span className="rounded-md bg-card px-2 py-1 ring-1 ring-border">
            {t(lang, "pharmacyRxType")}: {t(lang, prescriptionTypeLabelKey(selectedRx.type))}
          </span>
        </>
      ) : null}
      {controlledCount > 0 || (selectedRx && prescriptionHasControlledMedicines(selectedRx, products)) ? (
        <span className="rounded-md bg-violet-100 px-2 py-1 text-violet-900">
          {t(lang, "pharmacyDispenseControlledSummary")}: {controlledCount || "Rx"}
        </span>
      ) : null}
      {batchLines > 0 ? (
        <span className="rounded-md bg-teal-100 px-2 py-1 text-teal-900">
          {t(lang, "pharmacyDispenseFefoSummary")}: {batchLines}
        </span>
      ) : null}
    </div>
  );
}
