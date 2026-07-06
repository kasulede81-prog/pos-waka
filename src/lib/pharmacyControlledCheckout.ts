import type {
  PharmacyDispenseComplianceApproval,
  PharmacyPrescription,
  Product,
  SaleLine,
  ShopPreferences,
  UserRole,
} from "../types";
import type { SessionActor } from "./sessionActor";
import { validateControlledDispense, type ControlledDispenseValidation } from "./pharmacyControlledMedicine";

export type ControlledCheckoutContext = {
  lines: SaleLine[];
  products: Product[];
  preferences: ShopPreferences;
  prescription: PharmacyPrescription | null;
  compliance: PharmacyDispenseComplianceApproval | null;
};

/** Single shared controlled validation entry point for all pharmacy checkout paths. */
export function evaluateControlledCheckout(ctx: ControlledCheckoutContext): ControlledDispenseValidation {
  return validateControlledDispense({
    lines: ctx.lines,
    products: ctx.products,
    preferences: ctx.preferences,
    prescription: ctx.prescription,
    compliance: ctx.compliance,
  });
}

export function controlledCheckoutBlocked(
  validation: ControlledDispenseValidation,
  compliance: PharmacyDispenseComplianceApproval | null,
): boolean {
  if (validation.prescriptionRequiredBlocked) return true;
  if (validation.controlledLines.length === 0) return false;
  return (
    !compliance ||
    (validation.requiresManager && !compliance.managerApproved) ||
    (validation.requiresWitness && !compliance.witnessUserId) ||
    !compliance.patientVerified ||
    (validation.controlledLines.length > 0 &&
      validation.requiresGate &&
      (!compliance.patientVerified ||
        (validation.requiresManager && !compliance.managerApproved)))
  );
}

export function shouldOpenControlledGate(validation: ControlledDispenseValidation): boolean {
  if (validation.controlledLines.length === 0) return false;
  return validation.requiresGate || validation.prescriptionRequiredBlocked;
}

export function buildControlledComplianceApproval(input: {
  patientVerified: boolean;
  prescriptionVerified: boolean;
  managerApproved: boolean;
  managerReason?: string | null;
  witnessUserId?: string | null;
  witnessName?: string | null;
  actor: SessionActor | null;
  pinVerified: boolean;
}): PharmacyDispenseComplianceApproval {
  const actor = input.actor;
  return {
    patientVerified: input.patientVerified,
    prescriptionVerified: input.prescriptionVerified,
    managerApproved: input.managerApproved,
    managerReason: input.managerApproved ? input.managerReason?.trim() || null : null,
    witnessUserId: input.witnessUserId ?? null,
    witnessName: input.witnessName ?? null,
    approvedAt: new Date().toISOString(),
    managerUserId: input.managerApproved ? actor?.userId ?? null : null,
    managerName: input.managerApproved ? actor?.displayName ?? null : null,
    managerRole: input.managerApproved ? (actor?.role ?? null) : null,
    pharmacistUserId: actor?.userId ?? null,
    pharmacistName: actor?.displayName ?? null,
    pharmacistRole: actor?.role ?? null,
    pinVerified: input.pinVerified,
    approvalMethod: input.managerApproved ? "owner_pin" : null,
  };
}

export type ComplianceActorSnapshot = {
  staffId: string | null;
  staffName: string | null;
  staffRole: UserRole | null;
  pinVerified: boolean;
  approvalMethod: string | null;
};

export function actorSnapshotFromSession(actor: SessionActor | null | undefined): ComplianceActorSnapshot {
  return {
    staffId: actor?.userId ?? null,
    staffName: actor?.displayName ?? null,
    staffRole: actor?.role ?? null,
    pinVerified: false,
    approvalMethod: null,
  };
}

export function managerSnapshotFromCompliance(
  compliance: PharmacyDispenseComplianceApproval | null | undefined,
  fallbackActor: SessionActor | null | undefined,
): ComplianceActorSnapshot {
  if (compliance?.managerApproved) {
    return {
      staffId: compliance.managerUserId ?? fallbackActor?.userId ?? null,
      staffName: compliance.managerName ?? fallbackActor?.displayName ?? null,
      staffRole: (compliance.managerRole ?? fallbackActor?.role ?? null) as UserRole | null,
      pinVerified: Boolean(compliance.pinVerified),
      approvalMethod: compliance.approvalMethod ?? "owner_pin",
    };
  }
  return actorSnapshotFromSession(fallbackActor);
}
