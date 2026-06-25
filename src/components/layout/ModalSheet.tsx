import clsx from "clsx";
import type { CSSProperties, MouseEvent, ReactNode } from "react";
import { useKeyboardInset } from "../../hooks/useKeyboardInset";
import { AppModalOverlay } from "./AppModalOverlay";

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
 * Keyboard inset lifts the panel from the bottom (not overlay padding) so flex layout stays stable.
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
  const keyboardInset = useKeyboardInset();

  if (!open) return null;

  const panelLiftPx = keyboardInset > 0 ? keyboardInset : undefined;
  const panelStyle: CSSProperties | undefined = panelLiftPx
    ? { marginBottom: panelLiftPx, transition: "margin-bottom 160ms ease-out" }
    : { transition: "margin-bottom 160ms ease-out" };

  const handleBackdrop = (e: MouseEvent<HTMLDivElement>) => {
    if (e.target !== e.currentTarget) return;
    (onBackdropClick ?? onClose)();
  };

  return (
    <AppModalOverlay
      clearNav={clearNav}
      role={role}
      aria-modal={ariaModal}
      aria-labelledby={ariaLabelledby}
      className={clsx(
        zIndexClass,
        "flex bg-black/55 pt-[max(0.25rem,env(safe-area-inset-top,0px))]",
        align === "center"
          ? "items-end justify-center sm:items-center sm:p-4"
          : "items-end justify-center sm:items-center sm:p-4",
      )}
      onClick={handleBackdrop}
    >
      <div
        className={clsx(
          "flex w-full max-w-md min-h-0 flex-col overflow-hidden bg-white shadow-2xl",
          maxHeightClass,
          "rounded-t-[1.75rem] sm:rounded-3xl",
          panelClassName,
        )}
        style={panelStyle}
        onClick={(e) => e.stopPropagation()}
      >
        {title ? (
          <div className="shrink-0 border-b border-stone-100 px-5 py-4">
            {typeof title === "string" ? (
              <h2 className="text-xl font-black text-stone-950">{title}</h2>
            ) : (
              title
            )}
          </div>
        ) : null}

        <div className={clsx("min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-4", bodyClassName)}>
          {children}
        </div>

        {footer ? (
          <div className="shrink-0 border-t border-stone-100 bg-white px-5 py-4 pb-[max(0.75rem,env(safe-area-inset-bottom,0px))]">
            {footer}
          </div>
        ) : null}
      </div>
    </AppModalOverlay>
  );
}
