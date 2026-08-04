import clsx from "clsx";
import type { ReactNode } from "react";
import type { Language } from "../../../types";
import { themeUi } from "../../../lib/themeTokens";

type Props = {
  lang: Language;
  count: number;
  onClear: () => void;
  onSelectVisible?: () => void;
  children?: ReactNode;
  className?: string;
};

/** Desktop-only bulk action strip shown when rows are selected. */
export function EnterpriseDesktopBulkBar({ count, onClear, onSelectVisible, children, className }: Props) {
  if (count <= 0) return null;
  return (
    <div
      className={clsx(
        "flex flex-wrap items-center gap-2 rounded-xl border border-waka-200 bg-waka-50/90 px-3 py-2 shadow-elev dark:border-waka-800 dark:bg-waka-950/40",
        className,
      )}
    >
      <p className="text-xs font-bold text-foreground">
        {count} selected
      </p>
      {onSelectVisible ? (
        <button type="button" onClick={onSelectVisible} className={clsx(themeUi.btnGhost, "min-h-[36px] px-3 py-1.5 text-xs")}>
          Select visible
        </button>
      ) : null}
      <button type="button" onClick={onClear} className={clsx(themeUi.btnGhost, "min-h-[36px] px-3 py-1.5 text-xs")}>
        Clear
      </button>
      <div className="ml-auto flex flex-wrap items-center gap-2">{children}</div>
    </div>
  );
}
