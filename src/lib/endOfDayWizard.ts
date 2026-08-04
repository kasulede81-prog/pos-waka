/**
 * Phase 35.1 — End-of-Day Closing Wizard step model (presentation / orchestration only).
 * Does not change cash ledger, variance, or day-close APIs.
 */

export const EOD_WIZARD_STEPS = [
  "start",
  "health",
  "cash",
  "summary",
  "reports",
  "review",
] as const;

export type EodWizardStepId = (typeof EOD_WIZARD_STEPS)[number];

export type EodWizardStepMeta = {
  id: EodWizardStepId;
  titleKey: string;
  hintKey: string;
};

export const EOD_WIZARD_STEP_META: EodWizardStepMeta[] = [
  { id: "start", titleKey: "eodWizardStepStart", hintKey: "eodWizardStepStartHint" },
  { id: "health", titleKey: "eodWizardStepHealth", hintKey: "eodWizardStepHealthHint" },
  { id: "cash", titleKey: "eodWizardStepCash", hintKey: "eodWizardStepCashHint" },
  { id: "summary", titleKey: "eodWizardStepSummary", hintKey: "eodWizardStepSummaryHint" },
  { id: "reports", titleKey: "eodWizardStepReports", hintKey: "eodWizardStepReportsHint" },
  { id: "review", titleKey: "eodWizardStepReview", hintKey: "eodWizardStepReviewHint" },
];

export function eodWizardStepIndex(id: EodWizardStepId): number {
  return EOD_WIZARD_STEPS.indexOf(id);
}

export function eodWizardNextStep(id: EodWizardStepId): EodWizardStepId | null {
  const i = eodWizardStepIndex(id);
  if (i < 0 || i >= EOD_WIZARD_STEPS.length - 1) return null;
  return EOD_WIZARD_STEPS[i + 1]!;
}

export function eodWizardPrevStep(id: EodWizardStepId): EodWizardStepId | null {
  const i = eodWizardStepIndex(id);
  if (i <= 0) return null;
  return EOD_WIZARD_STEPS[i - 1]!;
}

/** Whether the operator may advance past cash reconciliation. */
export function eodWizardCanLeaveCashStep(countedDigits: string): boolean {
  return countedDigits.replace(/\D/g, "").length > 0;
}
