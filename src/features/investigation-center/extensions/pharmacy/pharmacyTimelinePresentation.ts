import type { AuditLogEntry, Language } from "../../../../types";
import { t, tTemplate } from "../../../../lib/i18n";
import { auditActionLabel } from "../../../../lib/auditCenterDetails";
import { productNameFromPayload } from "./pharmacyTimelineNarratives";

/** Richer timeline titles for pharmacy audit actions (presentation only). */
export function pharmacyInvestigationTimelineTitle(lang: Language, entry: AuditLogEntry): string | null {
  switch (entry.action) {
    case "pharmacy_prescription_dispensed":
      return t(lang, "icPharmacyTimelineRxDispensed");
    case "pharmacy_prescription_verified":
      return t(lang, "icPharmacyTimelineRxVerified");
    case "pharmacy_prescription_created":
      return t(lang, "icPharmacyTimelineRxCreated");
    case "pharmacy_controlled_dispensed":
    case "controlled_dispense":
      return t(lang, "icPharmacyTimelineControlledDispense");
    case "pharmacy_fefo_override":
      return t(lang, "icPharmacyTimelineFefoOverride");
    case "pharmacy_batch_received":
      return t(lang, "icPharmacyTimelineBatchReceived");
    case "pharmacy_batch_writeoff":
      return t(lang, "icPharmacyTimelineBatchWriteoff");
    case "pharmacy_batch_return":
      return t(lang, "icPharmacyTimelineBatchReturn");
    case "expired_stock_writeoff":
      return t(lang, "icPharmacyTimelineExpiredMedicine");
    case "controlled_return":
      return t(lang, "icPharmacyTimelineControlledReturn");
    case "witness_signed":
      return t(lang, "icPharmacyTimelineWitnessSigned");
    case "pharmacy_manager_approval":
      return t(lang, "icPharmacyTimelineComplianceVerification");
    default:
      if (entry.action.startsWith("pharmacy_") || entry.action.startsWith("controlled_")) {
        return auditActionLabel(lang, entry.action);
      }
      return null;
  }
}

export function pharmacyInvestigationTimelineSubtitle(
  lang: Language,
  entry: AuditLogEntry,
  productById: Map<string, { name: string }>,
): string | null {
  const pl = entry.payload;
  const product = productNameFromPayload(lang, pl, productById);
  const patient = typeof pl.patientName === "string" ? pl.patientName : typeof pl.customerName === "string" ? pl.customerName : null;
  const batch = typeof pl.batchNumber === "string" ? pl.batchNumber : null;
  const qty = typeof pl.quantity === "number" ? pl.quantity : typeof pl.qty === "number" ? pl.qty : null;

  switch (entry.action) {
    case "pharmacy_prescription_dispensed":
    case "pharmacy_controlled_dispensed":
    case "controlled_dispense":
      if (patient && product) {
        return tTemplate(lang, "icPharmacyTimelineDispenseDetail", { medicine: product, patient });
      }
      if (product) return product;
      return null;
    case "pharmacy_fefo_override":
      if (product && batch) {
        return tTemplate(lang, "icPharmacyTimelineFefoDetail", { medicine: product, batch });
      }
      return product;
    case "pharmacy_batch_received":
    case "pharmacy_batch_writeoff":
    case "pharmacy_batch_return":
      if (product && batch && qty != null) {
        return tTemplate(lang, "icPharmacyTimelineBatchDetail", { medicine: product, batch, qty: String(qty) });
      }
      return product;
    case "expired_stock_writeoff":
      if (product && qty != null) {
        return tTemplate(lang, "icPharmacyTimelineExpiredDetail", { medicine: product, qty: String(qty) });
      }
      return product;
    default:
      return null;
  }
}
