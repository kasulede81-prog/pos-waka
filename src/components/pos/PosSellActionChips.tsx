import type { ReactNode } from "react";
import clsx from "clsx";

/** Slim action row for POS sell screen (pending, expense, count drawer). */
export function PosSellActionChips({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={clsx(
        "flex max-w-full gap-1.5 overflow-x-auto pb-0.5 [-webkit-overflow-scrolling:touch]",
        className,
      )}
    >
      {children}
    </div>
  );
}

export function PosSellActionChip({
  children,
  onClick,
  href,
  className,
}: {
  children: ReactNode;
  onClick?: () => void;
  href?: string;
  className?: string;
}) {
  const base =
    "inline-flex min-h-[36px] shrink-0 items-center gap-1 rounded-full border border-stone-200 bg-stone-50 px-2.5 py-1 text-[11px] font-bold text-stone-800 active:bg-stone-100";
  if (href) {
    return (
      <a href={href} className={clsx(base, className)}>
        {children}
      </a>
    );
  }
  return (
    <button type="button" onClick={onClick} className={clsx(base, className)}>
      {children}
    </button>
  );
}
