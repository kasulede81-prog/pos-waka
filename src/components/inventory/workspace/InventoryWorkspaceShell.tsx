import clsx from "clsx";
import type { ReactNode } from "react";

type Props = {
  children: ReactNode;
  className?: string;
};

export function InventoryWorkspaceShell({ children, className }: Props) {
  return <div className={clsx("inventory-overview-shell space-y-3", className)}>{children}</div>;
}
