import { useEffect, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "framer-motion";
import clsx from "clsx";
import { X } from "lucide-react";
import { BottomSheet } from "./primitives";

function useBodyScrollLock(locked: boolean) {
  useEffect(() => {
    if (!locked) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [locked]);
}

type Props = {
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  wide?: boolean;
  children: ReactNode;
};

/** Desktop right drawer; mobile falls back to bottom sheet. */
export function AdminRightDrawer({ open, onClose, title, subtitle, wide, children }: Props) {
  useBodyScrollLock(open);

  return (
    <>
      <div className="md:hidden">
        <BottomSheet open={open} onClose={onClose} title={title} subtitle={subtitle} wide={wide}>
          {children}
        </BottomSheet>
      </div>
      {createPortal(
        <AnimatePresence>
          {open ? (
            <motion.div
              className="fixed inset-0 z-[var(--waka-z-internal-admin-modal,70)] hidden md:flex"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              role="presentation"
              onClick={onClose}
            >
              <motion.div
                className="absolute inset-0 bg-foreground/45 backdrop-blur-[1px]"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
              />
              <motion.aside
                role="dialog"
                aria-modal
                aria-labelledby="admin-drawer-title"
                className={clsx(
                  "relative ml-auto flex h-full max-h-[100dvh] flex-col overflow-hidden border-l border-border bg-muted shadow-2xl",
                  wide ? "w-full max-w-2xl" : "w-full max-w-md lg:max-w-lg",
                )}
                initial={{ x: "100%" }}
                animate={{ x: 0 }}
                exit={{ x: "100%" }}
                transition={{ type: "spring", damping: 32, stiffness: 360 }}
                onClick={(e) => e.stopPropagation()}
              >
                <div className="flex shrink-0 items-start justify-between gap-3 border-b border-border bg-card px-4 py-3">
                  <div className="min-w-0">
                    <h2 id="admin-drawer-title" className="text-base font-black text-foreground">
                      {title}
                    </h2>
                    {subtitle ? <p className="mt-0.5 text-xs font-medium text-muted-foreground">{subtitle}</p> : null}
                  </div>
                  <button
                    type="button"
                    onClick={onClose}
                    className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-full text-muted-foreground hover:bg-muted"
                    aria-label="Close"
                  >
                    <X className="h-5 w-5" />
                  </button>
                </div>
                <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-4">{children}</div>
              </motion.aside>
            </motion.div>
          ) : null}
        </AnimatePresence>,
        document.body,
      )}
    </>
  );
}
