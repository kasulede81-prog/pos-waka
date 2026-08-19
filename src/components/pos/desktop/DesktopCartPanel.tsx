import clsx from "clsx";
import type { ReactNode } from "react";

type Props = {
  children: ReactNode;
  className?: string;
};

/** Cart column wrapper — ticket-style order panel chrome. */
export function DesktopCartPanel({ children, className }: Props) {
  return (
    <div className={clsx("desktop-pos-cart-panel flex h-full min-h-0 flex-col", className)}>{children}</div>
  );
}
