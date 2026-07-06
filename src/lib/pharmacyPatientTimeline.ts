import type {
  Customer,
  DebtPayment,
  PharmacyPatientTimelineEvent,
  PharmacyPrescription,
  Product,
  Sale,
} from "../types";
import { formatMedicineFullLabel } from "./pharmacyMedicine";
import { prescriptionsForPatient } from "./pharmacyPrescriptions";

export function buildPatientTimeline(input: {
  patientId: string;
  prescriptions: PharmacyPrescription[];
  sales: Sale[];
  debtPayments: DebtPayment[];
  products: Product[];
}): PharmacyPatientTimelineEvent[] {
  const { patientId, prescriptions, sales, debtPayments, products } = input;
  const events: PharmacyPatientTimelineEvent[] = [];
  const productById = new Map(products.map((p) => [p.id, p]));

  for (const rx of prescriptionsForPatient(prescriptions, patientId)) {
    events.push({
      id: `rx-create-${rx.id}`,
      at: rx.createdAt,
      kind: "prescription_created",
      title: rx.prescriptionNumber,
      detail: rx.doctorName ? `Dr. ${rx.doctorName}` : rx.type,
      prescriptionId: rx.id,
      prescriptionNumber: rx.prescriptionNumber,
      doctorName: rx.doctorName ?? null,
    });
    if (rx.dispensedAt) {
      for (const line of rx.lines) {
        const product = productById.get(line.productId);
        const controlled = product?.pharmacyMaster?.controlledDrug;
        events.push({
          id: `rx-line-${rx.id}-${line.id}`,
          at: rx.dispensedAt,
          kind: controlled ? "controlled_dispensed" : "prescription_dispensed",
          title: rx.prescriptionNumber,
          detail: line.directions ?? null,
          prescriptionId: rx.id,
          prescriptionNumber: rx.prescriptionNumber,
          saleId: rx.saleId ?? null,
          doctorName: rx.doctorName ?? null,
          productName: product ? formatMedicineFullLabel(product) : line.productName,
          batchNumber: line.batchNumber ?? null,
          quantity: line.quantityDispensed || line.quantityPrescribed,
        });
      }
    }
    if (rx.refillsUsed > 0 && rx.lastRefillAt) {
      events.push({
        id: `rx-refill-${rx.id}-${rx.refillsUsed}`,
        at: rx.lastRefillAt,
        kind: "prescription_refill",
        title: rx.prescriptionNumber,
        detail: `Refill ${rx.refillsUsed}/${rx.refillCount}`,
        prescriptionId: rx.id,
        prescriptionNumber: rx.prescriptionNumber,
        doctorName: rx.doctorName ?? null,
      });
    }
  }

  for (const sale of sales) {
    if (sale.customerId !== patientId || sale.status === "cancelled") continue;
    if (sale.prescriptionId) continue;
    for (const line of sale.lines) {
      const product = productById.get(line.productId);
      events.push({
        id: `sale-line-${sale.id}-${line.id}`,
        at: sale.createdAt,
        kind: "otc_sale",
        title: sale.dispenseType === "otc" ? "OTC" : "Dispensing",
        detail: `UGX ${line.lineTotalUgx.toLocaleString()}`,
        saleId: sale.id,
        amountUgx: line.lineTotalUgx,
        productName: product ? formatMedicineFullLabel(product) : line.name,
        batchNumber: line.pharmacyBatchNumber ?? null,
        quantity: line.quantity,
      });
    }
  }

  for (const pay of debtPayments) {
    if (pay.customerId !== patientId) continue;
    events.push({
      id: `debt-${pay.id}`,
      at: pay.createdAt,
      kind: "debt_payment",
      title: "Payment received",
      detail: `UGX ${pay.amountUgx.toLocaleString()}`,
      amountUgx: pay.amountUgx,
    });
  }

  return events.sort((a, b) => b.at.localeCompare(a.at));
}

export function patientSummary(input: {
  patient: Customer;
  prescriptions: PharmacyPrescription[];
  sales: Sale[];
}): {
  prescriptionCount: number;
  dispensedCount: number;
  otcCount: number;
  controlledCount: number;
  outstandingDebtUgx: number;
  refillsDue: number;
} {
  const rxList = prescriptionsForPatient(input.prescriptions, input.patient.id);
  const patientSales = input.sales.filter((s) => s.customerId === input.patient.id && s.status !== "cancelled");
  return {
    prescriptionCount: rxList.length,
    dispensedCount: rxList.filter((r) => r.status === "dispensed" || r.status === "archived").length,
    otcCount: patientSales.filter((s) => s.dispenseType === "otc" && !s.prescriptionId).length,
    controlledCount: rxList.filter((r) => r.controlledMedicinesApproved).length,
    outstandingDebtUgx: input.patient.debtBalanceUgx,
    refillsDue: rxList.filter((r) => {
      const left = Math.max(0, r.refillCount - r.refillsUsed);
      return left > 0 && (r.status === "dispensed" || r.status === "archived");
    }).length,
  };
}
