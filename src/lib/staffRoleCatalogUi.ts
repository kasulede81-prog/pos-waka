import { UserCog } from "lucide-react";

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

type Accent = "waka" | "violet" | "emerald" | "amber" | "rose" | "sky" | "orange";

export function roleAccentClasses(accent: Accent, selected: boolean): string {
  if (!selected) return "border-stone-200 bg-white hover:border-stone-300";
  if (accent === "violet") return "border-violet-500 bg-violet-50 ring-2 ring-violet-200";
  if (accent === "emerald") return "border-emerald-500 bg-emerald-50 ring-2 ring-emerald-200";
  if (accent === "amber") return "border-amber-500 bg-amber-50 ring-2 ring-amber-200";
  if (accent === "rose") return "border-rose-500 bg-rose-50 ring-2 ring-rose-200";
  if (accent === "sky") return "border-sky-500 bg-sky-50 ring-2 ring-sky-200";
  if (accent === "orange") return "border-orange-500 bg-orange-50 ring-2 ring-orange-200";
  return "border-waka-500 bg-waka-50 ring-2 ring-waka-200";
}

export function roleIconClasses(accent: Accent, selected: boolean): string {
  if (!selected) return "bg-stone-100 text-stone-600";
  if (accent === "violet") return "bg-violet-100 text-violet-700";
  if (accent === "emerald") return "bg-emerald-100 text-emerald-700";
  if (accent === "amber") return "bg-amber-100 text-amber-700";
  if (accent === "rose") return "bg-rose-100 text-rose-700";
  if (accent === "sky") return "bg-sky-100 text-sky-700";
  if (accent === "orange") return "bg-orange-100 text-orange-700";
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

export const STAFF_OWNER_ROLE_CARD = {
  labelKey: "role_owner",
  descriptionKey: "staffRoleOwnerDesc",
  Icon: UserCog,
  accent: "violet" as const,
  disabled: true,
};
