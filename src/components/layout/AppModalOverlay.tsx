import clsx from "clsx";
import type { ComponentPropsWithoutRef, ReactNode } from "react";

type Props = ComponentPropsWithoutRef<"div"> & {
  children: ReactNode;
  /** When false, do not reserve space for the bottom tab bar (full-screen sheets above nav). */
  clearNav?: boolean;
};

/**
 * Fixed modal backdrop inside AppShell. Optionally pads above the mobile bottom tab bar.
 */
export function AppModalOverlay({ className, children, clearNav = true, ...rest }: Props) {
  return (
    <div className={clsx("fixed inset-0", clearNav && "waka-overlay-clear-nav", className)} {...rest}>
      {children}
    </div>
  );
}
