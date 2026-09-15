import clsx from "clsx";
import type { ReactNode } from "react";

type Props = {
  children: ReactNode;
  className?: string;
};

export function InventoryWorkspaceShell({ children, className }: Props) {
  return <div className={clsx("space-y-4", className)}>{children}</div>;
}
