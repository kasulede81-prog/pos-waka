/**
 * Enterprise UX Standard — mandatory primitives for all new Waka POS pages.
 * Phase 15.1 foundation. Presentation only; no business logic.
 */
export const ENTERPRISE_UX_PRIMITIVES = [
  "EnterprisePageContainer",
  "EnterpriseScrollControls",
  "WakaSwitch",
  "WakaCheckbox",
  "EnterpriseEmptyState",
  "EnterpriseSkeleton",
  "EnterpriseSaveIndicator",
  "EnterpriseListFooter",
  "EnterpriseListToolbar",
  "SettingsAutoSaveShell",
  "PageHeader",
  "PageBackBar",
  "ModalSheet",
] as const;

export type EnterpriseUxPrimitive = (typeof ENTERPRISE_UX_PRIMITIVES)[number];
