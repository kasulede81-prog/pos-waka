import type { LucideIcon } from "lucide-react";
import { Briefcase, Package, ShoppingCart } from "lucide-react";
import type { UserRole } from "../types";

export type StaffCreateRole = Extract<UserRole, "cashier" | "manager" | "stock_keeper">;

export type StaffRoleCardDef = {
  role: StaffCreateRole;
  labelKey: string;
  descriptionKey: string;
  Icon: LucideIcon;
  accent: "waka" | "violet" | "emerald";
  allowedPermKeys: string[];
  restrictedPermKeys: string[];
};

export const STAFF_CREATE_ROLES: StaffRoleCardDef[] = [
  {
    role: "cashier",
    labelKey: "role_cashier",
    descriptionKey: "staffRoleCashierDesc",
    Icon: ShoppingCart,
    accent: "waka",
    allowedPermKeys: [
      "staffPermSell",
      "staffPermAcceptPayments",
      "staffPermOpenTill",
      "staffPermViewOwnSales",
    ],
    restrictedPermKeys: [
      "staffPermManageInventory",
      "staffPermViewReports",
      "staffPermManageStaff",
      "staffPermChangePrices",
      "staffPermAppSettings",
    ],
  },
  {
    role: "manager",
    labelKey: "role_manager",
    descriptionKey: "staffRoleManagerDesc",
    Icon: Briefcase,
    accent: "violet",
    allowedPermKeys: [
      "staffPermSell",
      "staffPermAcceptPayments",
      "staffPermOpenTill",
      "staffPermViewReports",
      "staffPermManageInventory",
      "staffPermCloseDay",
      "staffPermApproveExpenses",
    ],
    restrictedPermKeys: ["staffPermManageStaff", "staffPermAppSettings", "staffPermOwnerFinance"],
  },
  {
    role: "stock_keeper",
    labelKey: "role_stock_keeper",
    descriptionKey: "staffRoleStockDesc",
    Icon: Package,
    accent: "emerald",
    allowedPermKeys: [
      "staffPermManageInventory",
      "staffPermStockCount",
      "staffPermAddProducts",
      "staffPermSuppliers",
      "staffPermPurchases",
    ],
    restrictedPermKeys: [
      "staffPermSell",
      "staffPermAcceptPayments",
      "staffPermViewReports",
      "staffPermManageStaff",
      "staffPermAppSettings",
    ],
  },
];

export function staffRoleCard(role: StaffCreateRole): StaffRoleCardDef {
  return STAFF_CREATE_ROLES.find((r) => r.role === role) ?? STAFF_CREATE_ROLES[0];
}

/** Random 4-digit PIN avoiding trivial sequences. */
export function generateStaffPin(): string {
  const weak = new Set(["0000", "1111", "2222", "3333", "4444", "5555", "6666", "7777", "8888", "9999", "1234", "4321"]);
  for (let i = 0; i < 40; i += 1) {
    const pin = String(Math.floor(1000 + Math.random() * 9000));
    if (!weak.has(pin)) return pin;
  }
  return String(Math.floor(1000 + Math.random() * 9000));
}

export function staffInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return `${parts[0]![0] ?? ""}${parts[1]![0] ?? ""}`.toUpperCase();
}

export function roleAccentClasses(accent: StaffRoleCardDef["accent"], selected: boolean): string {
  if (!selected) return "border-stone-200 bg-white hover:border-stone-300";
  if (accent === "violet") return "border-violet-500 bg-violet-50 ring-2 ring-violet-200";
  if (accent === "emerald") return "border-emerald-500 bg-emerald-50 ring-2 ring-emerald-200";
  return "border-waka-500 bg-waka-50 ring-2 ring-waka-200";
}

export function roleIconClasses(accent: StaffRoleCardDef["accent"], selected: boolean): string {
  if (!selected) return "bg-stone-100 text-stone-600";
  if (accent === "violet") return "bg-violet-100 text-violet-700";
  if (accent === "emerald") return "bg-emerald-100 text-emerald-700";
  return "bg-waka-100 text-waka-700";
}

export type StaffWizardStep = "details" | "permissions" | "review";

export function stepIndex(step: StaffWizardStep): number {
  if (step === "details") return 0;
  if (step === "permissions") return 1;
  return 2;
}

export const WIZARD_STEPS: StaffWizardStep[] = ["details", "permissions", "review"];

export function stepLabelKey(step: StaffWizardStep): string {
  if (step === "details") return "staffWizardStepDetails";
  if (step === "permissions") return "staffWizardStepPermissions";
  return "staffWizardStepReview";
}
