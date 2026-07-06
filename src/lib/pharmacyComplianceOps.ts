import type {
  PharmacyControlledOverrideKind,
  PharmacyControlledRegisterEntry,
  PharmacyDispenseComplianceApproval,
  PharmacyPrescription,
  Product,
  Sale,
  SaleLine,
  UserRole,
} from "../types";
import { dateKeyKampala } from "./datesUg";
import { buildControlledLineInfo } from "./pharmacyControlledMedicine";
import { createRegisterEntry } from "./pharmacyControlledRegister";

type RegisterActorFields = {
  pharmacistUserId?: string | null;
  pharmacistName?: string | null;
  pharmacistRole?: string | null;
  managerUserId?: string | null;
  managerName?: string | null;
  managerRole?: string | null;
  pinVerified?: boolean;
  approvalMethod?: string | null;
};

function actorFieldsFromCompliance(
  compliance: PharmacyDispenseComplianceApproval | null | undefined,
  fallbackPharmacist?: { userId?: string | null; name?: string | null; role?: UserRole | null },
): RegisterActorFields {
  return {
    pharmacistUserId: compliance?.pharmacistUserId ?? fallbackPharmacist?.userId ?? null,
    pharmacistName: compliance?.pharmacistName ?? fallbackPharmacist?.name ?? null,
    pharmacistRole: compliance?.pharmacistRole ?? fallbackPharmacist?.role ?? null,
    managerUserId: compliance?.managerApproved ? compliance.managerUserId ?? null : null,
    managerName: compliance?.managerApproved ? compliance.managerName ?? null : null,
    managerRole: compliance?.managerApproved ? compliance.managerRole ?? null : null,
    pinVerified: compliance?.managerApproved ? Boolean(compliance.pinVerified) : false,
    approvalMethod: compliance?.managerApproved ? compliance.approvalMethod ?? "owner_pin" : null,
  };
}

export function registerEntriesFromControlledSale(input: {
  sale: Sale;
  lines: SaleLine[];
  products: Product[];
  deviceId: string;
  pharmacistUserId?: string | null;
  pharmacistName?: string | null;
  pharmacistRole?: UserRole | null;
  prescription?: PharmacyPrescription | null;
  patientName?: string | null;
  compliance?: PharmacyDispenseComplianceApproval | null;
}): PharmacyControlledRegisterEntry[] {
  const productById = new Map(input.products.map((p) => [p.id, p]));
  const entries: PharmacyControlledRegisterEntry[] = [];
  const businessDate = dateKeyKampala(input.sale.createdAt);
  const patientId = input.sale.customerId ?? input.prescription?.patientId ?? null;
  const actors = actorFieldsFromCompliance(input.compliance, {
    userId: input.pharmacistUserId ?? input.sale.soldByUserId ?? null,
    name: input.pharmacistName ?? null,
    role: input.pharmacistRole ?? null,
  });

  for (const line of input.lines) {
    const product = productById.get(line.productId);
    if (!product) continue;
    const info = buildControlledLineInfo(product, line);
    if (!info) continue;
    entries.push(
      createRegisterEntry({
        kind: "dispense",
        at: input.sale.createdAt,
        businessDate,
        productId: info.productId,
        productName: info.productName,
        controlledSchedule: info.schedule,
        regulatoryCategory: info.regulatoryCategory,
        patientId,
        patientName: input.patientName ?? input.prescription?.patientName ?? null,
        prescriptionId: input.prescription?.id ?? input.sale.prescriptionId ?? null,
        prescriptionNumber: input.prescription?.prescriptionNumber ?? null,
        saleId: input.sale.id,
        batchNumber: info.batchNumber ?? line.pharmacyBatchNumber ?? null,
        batchExpiry: info.batchExpiry ?? line.pharmacyBatchExpiry ?? null,
        quantity: line.quantity,
        ...actors,
        witnessUserId: input.compliance?.witnessUserId ?? null,
        witnessName: input.compliance?.witnessName ?? null,
        overrideReason: input.compliance?.managerReason ?? null,
        deviceId: input.deviceId,
      }),
    );
    if (input.compliance?.witnessUserId) {
      entries.push(
        createRegisterEntry({
          kind: "witness",
          at: input.sale.createdAt,
          businessDate,
          productId: info.productId,
          productName: info.productName,
          saleId: input.sale.id,
          quantity: line.quantity,
          witnessUserId: input.compliance.witnessUserId,
          witnessName: input.compliance.witnessName ?? null,
          ...actors,
          deviceId: input.deviceId,
        }),
      );
    }
  }
  return entries;
}

export function registerEntryFromOverride(input: {
  at?: string;
  productId: string;
  productName: string;
  quantity: number;
  overrideKind: PharmacyControlledOverrideKind;
  reason: string;
  deviceId: string;
  pharmacistUserId?: string | null;
  pharmacistName?: string | null;
  pharmacistRole?: UserRole | null;
  managerUserId?: string | null;
  managerName?: string | null;
  managerRole?: UserRole | null;
  pinVerified?: boolean;
  saleId?: string | null;
  batchNumber?: string | null;
}): PharmacyControlledRegisterEntry {
  const at = input.at ?? new Date().toISOString();
  return createRegisterEntry({
    kind: "override",
    at,
    businessDate: dateKeyKampala(new Date(at)),
    productId: input.productId,
    productName: input.productName,
    quantity: input.quantity,
    overrideKind: input.overrideKind,
    overrideReason: input.reason,
    deviceId: input.deviceId,
    pharmacistUserId: input.pharmacistUserId ?? null,
    pharmacistName: input.pharmacistName ?? null,
    pharmacistRole: input.pharmacistRole ?? null,
    managerUserId: input.managerUserId ?? null,
    managerName: input.managerName ?? null,
    managerRole: input.managerRole ?? null,
    pinVerified: input.pinVerified ?? false,
    approvalMethod: input.managerUserId ? "owner_pin" : null,
    saleId: input.saleId ?? null,
    batchNumber: input.batchNumber ?? null,
  });
}

export function registerEntryFromControlledReturn(input: {
  kind: "return" | "destroy" | "void";
  productId: string;
  productName: string;
  quantity: number;
  reason: string;
  deviceId: string;
  patientId?: string | null;
  patientName?: string | null;
  saleId?: string | null;
  returnId?: string | null;
  batchNumber?: string | null;
  batchExpiry?: string | null;
  pharmacistUserId?: string | null;
  pharmacistName?: string | null;
  pharmacistRole?: UserRole | null;
  managerUserId?: string | null;
  managerName?: string | null;
  managerRole?: UserRole | null;
  pinVerified?: boolean;
  approvalMethod?: string | null;
}): PharmacyControlledRegisterEntry {
  const at = new Date().toISOString();
  return createRegisterEntry({
    kind: input.kind,
    at,
    businessDate: dateKeyKampala(new Date(at)),
    productId: input.productId,
    productName: input.productName,
    quantity: input.quantity,
    overrideReason: input.reason,
    deviceId: input.deviceId,
    patientId: input.patientId ?? null,
    patientName: input.patientName ?? null,
    saleId: input.saleId ?? null,
    returnId: input.returnId ?? null,
    batchNumber: input.batchNumber ?? null,
    batchExpiry: input.batchExpiry ?? null,
    pharmacistUserId: input.pharmacistUserId ?? null,
    pharmacistName: input.pharmacistName ?? null,
    pharmacistRole: input.pharmacistRole ?? null,
    managerUserId: input.managerUserId ?? null,
    managerName: input.managerName ?? null,
    managerRole: input.managerRole ?? null,
    pinVerified: input.pinVerified ?? false,
    approvalMethod: input.approvalMethod ?? null,
  });
}

export function registerEntryFromControlledVoid(input: {
  saleId: string;
  productId: string;
  productName: string;
  quantity: number;
  reason: string;
  deviceId: string;
  batchNumber?: string | null;
  batchExpiry?: string | null;
  pharmacistUserId?: string | null;
  pharmacistName?: string | null;
  pharmacistRole?: UserRole | null;
}): PharmacyControlledRegisterEntry {
  return registerEntryFromControlledReturn({
    kind: "void",
    productId: input.productId,
    productName: input.productName,
    quantity: input.quantity,
    reason: input.reason,
    deviceId: input.deviceId,
    saleId: input.saleId,
    batchNumber: input.batchNumber,
    batchExpiry: input.batchExpiry,
    pharmacistUserId: input.pharmacistUserId,
    pharmacistName: input.pharmacistName,
    pharmacistRole: input.pharmacistRole,
  });
}
