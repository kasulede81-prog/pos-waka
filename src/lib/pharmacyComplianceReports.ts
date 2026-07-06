import type { PharmacyControlledRegisterEntry } from "../types";
import { dateKeyKampala } from "./datesUg";
import { registerEntriesForBusinessDate } from "./pharmacyControlledRegister";

export type PharmacyComplianceReportBundle = {
  dailyControlled: PharmacyControlledRegisterEntry[];
  dispensingRegister: PharmacyControlledRegisterEntry[];
  returns: PharmacyControlledRegisterEntry[];
  destroyed: PharmacyControlledRegisterEntry[];
  overrides: PharmacyControlledRegisterEntry[];
  witnessLog: PharmacyControlledRegisterEntry[];
  controlledStockHints: { productId: string; productName: string; dispensedQty: number }[];
};

export function computeComplianceReports(
  register: PharmacyControlledRegisterEntry[],
  today: Date = new Date(),
): PharmacyComplianceReportBundle {
  const dayKey = dateKeyKampala(today);
  const daily = registerEntriesForBusinessDate(register, dayKey);
  const dispensingRegister = daily.filter((e) => e.kind === "dispense");
  const returns = register.filter((e) => e.kind === "return");
  const destroyed = register.filter((e) => e.kind === "destroy");
  const overrides = register.filter((e) => e.kind === "override");
  const witnessLog = register.filter((e) => e.kind === "witness" || e.witnessUserId);

  const qtyByProduct = new Map<string, { productId: string; productName: string; dispensedQty: number }>();
  for (const e of register.filter((x) => x.kind === "dispense")) {
    const prev = qtyByProduct.get(e.productId);
    qtyByProduct.set(e.productId, {
      productId: e.productId,
      productName: e.productName,
      dispensedQty: (prev?.dispensedQty ?? 0) + e.quantity,
    });
  }
  const controlledStockHints = [...qtyByProduct.values()].sort((a, b) => b.dispensedQty - a.dispensedQty).slice(0, 20);

  return {
    dailyControlled: daily,
    dispensingRegister,
    returns,
    destroyed,
    overrides,
    witnessLog,
    controlledStockHints,
  };
}
