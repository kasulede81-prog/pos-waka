import type { ReactNode } from "react";
import clsx from "clsx";

type Props = {
  children?: ReactNode;
  className?: string;
  empty?: ReactNode;
  isEmpty?: boolean;
};

/** White list shell used on Sales History, Debts, and matching history screens. */
export function HistoryListCard({ children, className, empty, isEmpty }: Props) {
  if (isEmpty && empty) {
    return (
      <div className={clsx("rounded-[1.35rem] border border-border bg-card p-6 text-center shadow-sm", className)}>
        {empty}
      </div>
    );
  }

  return (
    <div
      className={clsx(
        "overflow-hidden rounded-[1.35rem] border border-border bg-card shadow-sm",
        className,
      )}
    >
      {children}
    </div>
  );
}
