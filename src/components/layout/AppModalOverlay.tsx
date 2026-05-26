import clsx from "clsx";
import type { ComponentPropsWithoutRef, ReactNode } from "react";

type Props = ComponentPropsWithoutRef<"div"> & {
  children: ReactNode;
};

/**
 * Fixed modal backdrop inside AppShell. Pads above the mobile bottom tab bar so
 * sheet footers and action buttons stay tappable (see waka-overlay-clear-nav).
 */
export function AppModalOverlay({ className, children, ...rest }: Props) {
  return (
    <div className={clsx("fixed inset-0 waka-overlay-clear-nav", className)} {...rest}>
      {children}
    </div>
  );
}
