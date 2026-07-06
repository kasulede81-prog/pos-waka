import { describe, expect, it } from "vitest";
import type { Customer, Product } from "../types";
import { checkAllergyWarnings } from "./pharmacyAllergyWarnings";
import { computePatientAge, ensurePharmacyPatientProfile, normalizePharmacyPatientProfile } from "./pharmacyPatientProfile";
import { searchPharmacyPatients } from "./pharmacyPatientSearch";

function patient(allergies: string[] = []): Customer {
  return {
    id: "c1",
    name: "Jane Doe",
    phone: "0700123456",
    location: "",
    createdAt: "2026-01-01",
    version: 1,
    debtBalanceUgx: 0,
    pharmacyProfile: {
      patientCode: "PT-001",
      allergies,
      notes: [],
      documents: [],
      chronicMedications: [],
    },
  };
}

function product(name: string, generic?: string): Product {
  return {
    id: "p1",
    name,
    sellingMode: "unit",
    baseUnit: "tablet",
    sellingPricePerUnitUgx: 500,
    costPricePerUnitUgx: 200,
    stockOnHand: 10,
    minimumStockAlert: 1,
    category: "Pain",
    sku: "",
    updatedAt: "",
    version: 1,
    pharmacyMaster: { genericName: generic ?? name },
  };
}

describe("pharmacyPatientProfile", () => {
  it("computes age from DOB", () => {
    expect(computePatientAge("2000-07-06", new Date("2026-07-06"))).toBe(26);
  });

  it("normalizes legacy allergy text", () => {
    const profile = normalizePharmacyPatientProfile({
      patientCode: "PT-X",
      allergiesText: "penicillin, sulfa",
    });
    expect(profile?.allergies).toEqual(["penicillin", "sulfa"]);
  });

  it("ensures default profile shell", () => {
    const profile = ensurePharmacyPatientProfile(patient());
    expect(profile.patientCode).toBe("PT-001");
    expect(profile.chronicMedications).toEqual([]);
  });
});

describe("pharmacyAllergyWarnings", () => {
  it("flags penicillin class against amoxicillin", () => {
    const warnings = checkAllergyWarnings(patient(["penicillin"]), [product("Amoxicillin 500mg", "amoxicillin")]);
    expect(warnings.length).toBeGreaterThan(0);
    expect(warnings[0]?.allergyToken).toBe("penicillin");
  });

  it("returns empty when no allergies", () => {
    expect(checkAllergyWarnings(patient([]), [product("Paracetamol")])).toEqual([]);
  });
});

describe("pharmacyPatientSearch", () => {
  it("finds patient by national id", () => {
    const customers: Customer[] = [
      {
        ...patient(),
        pharmacyProfile: {
          patientCode: "PT-001",
          nationalId: "CM123456",
          allergies: [],
          notes: [],
          documents: [],
          chronicMedications: [],
        },
      },
    ];
    const hits = searchPharmacyPatients(customers, "cm123456", [], []);
    expect(hits).toHaveLength(1);
  });
});
