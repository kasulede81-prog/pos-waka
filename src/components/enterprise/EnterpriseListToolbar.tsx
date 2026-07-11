import clsx from "clsx";
import {
  ArrowDownUp,
  Calendar,
  Download,
  LayoutGrid,
  RefreshCw,
  Search,
  SlidersHorizontal,
} from "lucide-react";
import type { ReactNode } from "react";
import type { Language } from "../../types";
import { t } from "../../lib/i18n";
import { themeUi } from "../../lib/themeTokens";

export type EnterpriseListToolbarProps = {
  lang: Language;
  className?: string;
  sticky?: boolean;
  searchQuery?: string;
  searchPlaceholder?: string;
  onSearchChange?: (value: string) => void;
  periodLabel?: string;
  onOpenDateFilter?: () => void;
  onOpenSort?: () => void;
  onOpenFilters?: () => void;
  onOpenView?: () => void;
  onRefresh?: () => void;
  refreshSpinning?: boolean;
  onExport?: () => void;
  exportLabel?: string;
  statusChips?: ReactNode;
  trailing?: ReactNode;
};

function ToolbarButton({
  onClick,
  label,
  icon: Icon,
  active,
  primary,
  className,
}: {
  onClick?: () => void;
  label?: string;
  icon: typeof Search;
  active?: boolean;
  primary?: boolean;
  className?: string;
}) {
  if (!onClick) return null;
  return (
    <button
      type="button"
      onClick={onClick}
      className={clsx(
        "inline-flex min-h-[40px] shrink-0 items-center justify-center gap-2 rounded-xl border px-3 text-xs font-black transition-waka",
        primary
          ? "border-waka-600 bg-waka-600 text-white shadow-sm"
          : active
            ? "border-waka-300 bg-business-muted text-waka-800"
            : "border-border bg-card text-foreground",
        className,
      )}
    >
      <Icon className="h-4 w-4 shrink-0" aria-hidden />
      {label ? <span className="max-w-[8rem] truncate">{label}</span> : null}
    </button>
  );
}

/**
 * Standard list toolbar — search, sort, filter, date, status, view, refresh, export.
 * Collapses action row horizontally on mobile with overflow scroll.
 */
export function EnterpriseListToolbar({
  lang,
  className,
  sticky = true,
  searchQuery,
  searchPlaceholder,
  onSearchChange,
  periodLabel,
  onOpenDateFilter,
  onOpenSort,
  onOpenFilters,
  onOpenView,
  onRefresh,
  refreshSpinning,
  onExport,
  exportLabel,
  statusChips,
  trailing,
}: EnterpriseListToolbarProps) {
  const showSearch = onSearchChange != null;
  const showActions =
    onOpenDateFilter ||
    onOpenSort ||
    onOpenFilters ||
    onOpenView ||
    onRefresh ||
    onExport ||
    trailing ||
    statusChips;

  if (!showSearch && !showActions) return null;

  return (
    <div
      className={clsx(
        "space-y-2 rounded-2xl border border-border/80 bg-card/95 p-3 shadow-sm backdrop-blur-sm",
        sticky && "sticky top-0 z-20",
        className,
      )}
    >
      {showSearch ? (
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <input
            type="search"
            value={searchQuery ?? ""}
            onChange={(e) => onSearchChange?.(e.target.value)}
            placeholder={searchPlaceholder ?? t(lang, "enterpriseSearch")}
            className={clsx("min-h-[44px] w-full rounded-2xl border-2 pl-10 pr-3 text-sm font-semibold", themeUi.input)}
          />
        </div>
      ) : null}

      {showActions ? (
        <div className="w-full min-w-0 overflow-x-auto pb-0.5 [-webkit-overflow-scrolling:touch] sm:overflow-visible">
          <div className="flex w-max min-w-full items-center gap-2 sm:w-full sm:flex-wrap">
            {statusChips}
            <ToolbarButton
              onClick={onOpenDateFilter}
              label={periodLabel}
              icon={Calendar}
              className="flex-1 sm:flex-none"
            />
            <ToolbarButton onClick={onOpenSort} label={t(lang, "enterpriseSort")} icon={ArrowDownUp} />
            <ToolbarButton
              onClick={onOpenFilters}
              icon={SlidersHorizontal}
              label={t(lang, "enterpriseFilter")}
            />
            <ToolbarButton onClick={onOpenView} label={t(lang, "enterpriseView")} icon={LayoutGrid} />
            <ToolbarButton
              onClick={onRefresh}
              icon={RefreshCw}
              label={t(lang, "enterpriseRefresh")}
              className={refreshSpinning ? "[&_svg]:animate-spin" : undefined}
            />
            <ToolbarButton
              onClick={onExport}
              icon={Download}
              label={exportLabel ?? t(lang, "enterpriseExport")}
              primary
            />
            {trailing}
          </div>
        </div>
      ) : null}
    </div>
  );
}
