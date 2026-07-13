import clsx from "clsx";
import type { CSSProperties, FocusEvent, MouseEvent, ReactNode } from "react";
import { useVisualViewportBounds } from "../../hooks/useVisualViewportBounds";
import { AppModalOverlay } from "./AppModalOverlay";
import { themeUi } from "../../lib/themeTokens";
import { enterpriseDialogTitle } from "../../lib/enterpriseTypography";
import { enterpriseMotion } from "../../lib/enterpriseMotion";

type Props = {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  /** Sticky footer — actions stay visible above keyboard and gesture bar. */
  footer?: ReactNode;
  title?: ReactNode;
  /** Bottom sheet (mobile) or centered dialog (sm+). */
  align?: "bottom" | "center";
  zIndexClass?: string;
  clearNav?: boolean;
  maxHeightClass?: string;
  panelClassName?: string;
  bodyClassName?: string;
  role?: string;
  "aria-modal"?: boolean;
  "aria-labelledby"?: string;
  onBackdropClick?: () => void;
};

const DEFAULT_MAX_H = "max-h-[min(92dvh,720px)]";

/**
 * Universal modal/sheet — scrollable body, sticky footer, safe-area + keyboard insets.
 * Overlay tracks the visual viewport so the sheet stays above the on-screen keyboard.
 */
export function ModalSheet({
  open,
  onClose,
  children,
  footer,
  title,
  align = "bottom",
  zIndexClass = "z-[var(--waka-z-modal,60)]",
  clearNav = true,
  maxHeightClass = DEFAULT_MAX_H,
  panelClassName,
  bodyClassName,
  role = "dialog",
  "aria-modal": ariaModal = true,
  "aria-labelledby": ariaLabelledby,
  onBackdropClick,
}: Props) {
  const viewport = useVisualViewportBounds();

  if (!open) return null;

  const overlayStyle: CSSProperties = {
    top: viewport.offsetTop,
    left: viewport.offsetLeft,
    width: viewport.width,
    height: viewport.height,
    right: "auto",
    bottom: "auto",
  };

  const panelMaxHeightPx = Math.min(Math.round(viewport.height * 0.92), 720);
  const panelStyle: CSSProperties = { maxHeight: panelMaxHeightPx };

  const handleBackdrop = (e: MouseEvent<HTMLDivElement>) => {
    if (e.target !== e.currentTarget) return;
    (onBackdropClick ?? onClose)();
  };

  const scrollFocusedFieldIntoView = (e: FocusEvent<HTMLDivElement>) => {
    const target = e.target;
    if (!(target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement)) return;
    requestAnimationFrame(() => {
      target.scrollIntoView({ block: "center", behavior: "smooth" });
    });
  };

  return (
    <AppModalOverlay
      clearNav={clearNav}
      role={role}
      aria-modal={ariaModal}
      aria-labelledby={ariaLabelledby}
      style={overlayStyle}
      className={clsx(
        zIndexClass,
        "flex pt-[max(0.25rem,env(safe-area-inset-top,0px))]",
        themeUi.overlay,
        enterpriseMotion.overlayEnter,
        align === "center"
          ? "items-end justify-center sm:items-center sm:p-4"
          : "items-end justify-center sm:items-center sm:p-4",
      )}
      onClick={handleBackdrop}
    >
      <div
        className={clsx(
          "flex w-full max-w-md min-h-0 flex-col overflow-hidden shadow-2xl",
          themeUi.dialog,
          maxHeightClass,
          "rounded-t-[1.75rem] sm:rounded-3xl",
          align === "center" ? enterpriseMotion.dialogEnter : enterpriseMotion.sheetEnter,
          panelClassName,
        )}
        style={panelStyle}
        onClick={(e) => e.stopPropagation()}
      >
        {title ? (
          <div className={themeUi.dialogHeader}>
            {typeof title === "string" ? (
              <h2 className={enterpriseDialogTitle}>{title}</h2>
            ) : (
              title
            )}
          </div>
        ) : null}

        <div
          onFocusCapture={scrollFocusedFieldIntoView}
          className={clsx("min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-4", bodyClassName)}
        >
          {children}
        </div>

        {footer ? (
          <div className={clsx(themeUi.dialogFooter, "pb-[max(0.75rem,env(safe-area-inset-bottom,0px))]")}>
            {footer}
          </div>
        ) : null}
      </div>
    </AppModalOverlay>
  );
}
