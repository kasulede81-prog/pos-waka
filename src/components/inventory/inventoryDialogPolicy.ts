/**
 * Phase 31.1 — Inventory dialog policy (presentation only).
 *
 * Use:
 * - `ModalSheet` — complex workflows (forms, wizards, multi-step receive/edit)
 * - `ConfirmationDialog` — simple yes/no destructive confirms without extra fields
 *
 * Prefer ModalSheet for inventory feature dialogs.
 * Exception: product add/edit shells portal a full-height form chrome
 * (footer must stay inside `<form>`) — do not force those through ModalSheet.
 * `ModalSheet` owns the overlay implementation internally.
 */

export const INVENTORY_DIALOG_POLICY = {
  complexWorkflow: "ModalSheet",
  simpleConfirm: "ConfirmationDialog",
  /** Product add/edit: portaled AppModalOverlay form chrome (not ModalSheet). */
  productFormShell: "ProductEditorShell | ProductWizardShell",
} as const;
