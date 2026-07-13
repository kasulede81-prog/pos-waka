/**
 * Phase 22.3 — Enterprise UX primitives (mandatory for new pages).
 */
export const ENTERPRISE_UX_PRIMITIVES = [
  "EnterprisePageContainer",
  "EnterprisePageHeader",
  "EnterpriseNavBack",
  "EnterpriseTypography",
  "EnterpriseCard",
  "EnterpriseKpiCard",
  "EnterpriseTextField",
  "EnterpriseResponsiveTable",
  "ResponsiveDataTable",
  "WakaButton",
  "WakaSwitch",
  "WakaCheckbox",
  "EnterpriseScrollControls",
  "EnterpriseEmptyState",
  "EnterpriseSkeleton",
  "EnterpriseSpinner",
  "enterpriseMotion",
  "EnterpriseActionSheet",
  "EnterpriseFeedbackBanner",
  "EnterpriseSaveIndicator",
  "EnterpriseListFooter",
  "EnterpriseListToolbar",
  "SettingsAutoSaveShell",
  "EnterpriseDialogSystem",
  "ModalSheet",
  "ConfirmationDialog",
  "statusTokens",
  "enterpriseTypeClass",
] as const;

export type EnterpriseUxPrimitive = (typeof ENTERPRISE_UX_PRIMITIVES)[number];
