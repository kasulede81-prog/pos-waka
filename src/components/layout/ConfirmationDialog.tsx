import { useEffect, useRef, type ReactNode } from "react";
import clsx from "clsx";
import type { Language } from "../../types";
import { t } from "../../lib/i18n";
import { WakaButton } from "../ui/wakaPrimitives";
import { ModalSheet } from "./ModalSheet";
import { enterpriseTypeClass } from "../../lib/enterpriseTypography";

type Props = {
  lang: Language;
  open: boolean;
  onClose: () => void;
  title: string;
  children?: ReactNode;
  confirmLabelKey?: string;
  cancelLabelKey?: string;
  onConfirm: () => void;
  confirmDisabled?: boolean;
  confirmBusy?: boolean;
  destructive?: boolean;
};

/** Matches everything the browser considers keyboard-focusable inside the dialog. */
const FOCUSABLE =
  'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Tier C — keyboard-aware confirmation dialog (Enterprise Modal Standard).
 *
 * Accessibility contract (Phase 2, Batch 3):
 * - focus moves into the dialog body when it opens;
 * - Tab / Shift+Tab cycle within the dialog (focus trap for the aria-modal);
 * - Escape dismisses via onClose — which callers wire to CANCEL, never confirm;
 * - focus returns to the triggering control on close.
 */
export function ConfirmationDialog({
  lang,
  open,
  onClose,
  title,
  children,
  confirmLabelKey = "confirm",
  cancelLabelKey = "cancel",
  onConfirm,
  confirmDisabled,
  confirmBusy,
  destructive,
}: Props) {
  const bodyRef = useRef<HTMLDivElement>(null);
  // Keep the latest onClose reachable from the document-level listener without
  // re-running the open effect (and re-stealing focus) on every render.
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    const raf = requestAnimationFrame(() => bodyRef.current?.focus());

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        onCloseRef.current();
        return;
      }
      if (e.key !== "Tab") return;
      const dialog = bodyRef.current?.closest('[role="dialog"]');
      if (!dialog) return;
      const focusables = Array.from(dialog.querySelectorAll<HTMLElement>(FOCUSABLE));
      if (focusables.length === 0) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      const active = document.activeElement as HTMLElement | null;
      if (!active || !dialog.contains(active)) {
        e.preventDefault();
        first.focus();
        return;
      }
      if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      } else if (e.shiftKey && active === first) {
        e.preventDefault();
        last.focus();
      }
    };

    // Capture phase so the trap wins over page-level handlers.
    document.addEventListener("keydown", onKey, true);
    return () => {
      cancelAnimationFrame(raf);
      document.removeEventListener("keydown", onKey, true);
      if (previous && document.contains(previous)) previous.focus();
    };
  }, [open]);

  return (
    <ModalSheet
      open={open}
      onClose={onClose}
      title={title}
      align="center"
      maxHeightClass="max-h-[min(88dvh,480px)]"
      panelClassName="max-w-sm"
      footer={
        <div className="grid grid-cols-2 gap-2.5">
          <WakaButton type="button" variant="secondary" onClick={onClose}>
            {t(lang, cancelLabelKey)}
          </WakaButton>
          <WakaButton
            type="button"
            variant={destructive ? "danger" : "primary"}
            disabled={confirmDisabled}
            loading={confirmBusy}
            onClick={onConfirm}
          >
            {t(lang, confirmLabelKey)}
          </WakaButton>
        </div>
      }
    >
      <div
        ref={bodyRef}
        tabIndex={-1}
        className={clsx(enterpriseTypeClass("body", "text-muted-foreground"), "focus:outline-none")}
      >
        {children}
      </div>
    </ModalSheet>
  );
}
