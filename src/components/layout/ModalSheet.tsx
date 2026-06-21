import clsx from "clsx";
import type { CSSProperties, MouseEvent, ReactNode } from "react";
import { useKeyboardInset } from "../../hooks/useKeyboardInset";
import { combinedBottomInsetStyle } from "../../lib/safeAreaInsets";
import { AppModalOverlay } from "./AppModalOverlay";

type Props = {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  /** Sticky footer — actions stay visible above keyboard and gesture bar. */
  footer?: ReactNode;
  title?: ReactNode;
  /** Bottom sheet (mobile) or centered dialog. */
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

  const bottomPad = combinedBottomInsetStyle(keyboardInset);
  const overlayStyle: CSSProperties | undefined = bottomPad
    ? { paddingBottom: bottomPad }
    : undefined;

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
        align === "bottom" ? "items-end justify-center sm:items-center" : "items-center justify-center p-3 sm:p-4",
      )}
      style={overlayStyle}
      onClick={handleBackdrop}
    >
      <div
        className={clsx(
          "flex w-full max-w-md min-h-0 flex-col overflow-hidden bg-white shadow-2xl",
          maxHeightClass,
          align === "bottom" ? "rounded-t-[1.75rem] sm:rounded-3xl" : "rounded-3xl",
          panelClassName,
        )}
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
          <div
            className="shrink-0 border-t border-stone-100 bg-white px-5 py-4 pb-[max(0.75rem,env(safe-area-inset-bottom,0px))]"
            style={bottomPad ? { paddingBottom: bottomPad } : undefined}
          >
            {footer}
          </div>
        ) : null}
      </div>
    </AppModalOverlay>
  );
}
