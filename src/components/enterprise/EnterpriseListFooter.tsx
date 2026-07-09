import clsx from "clsx";
import type { ReactNode } from "react";
import type { Language } from "../../types";
import { t } from "../../lib/i18n";

type Props = {
  lang: Language;
  /** Shown when list has more items than displayed (e.g. audit cap). */
  truncated?: boolean;
  truncatedCount?: number;
  totalCount?: number;
  /** End of paginated list. */
  endOfList?: boolean;
  /** No results after filters. */
  noResults?: boolean;
  onLoadMore?: () => void;
  loadMoreLoading?: boolean;
  hasMore?: boolean;
  className?: string;
  children?: ReactNode;
};

export function EnterpriseListFooter({
  lang,
  truncated,
  truncatedCount,
  totalCount,
  endOfList,
  noResults,
  onLoadMore,
  loadMoreLoading,
  hasMore,
  className,
  children,
}: Props) {
  if (noResults) {
    return (
      <p className={clsx("py-6 text-center text-sm font-semibold text-stone-500", className)} role="status">
        {t(lang, "enterpriseNoResults")}
      </p>
    );
  }

  return (
    <div className={clsx("space-y-3 py-4", className)}>
      {truncated && truncatedCount != null ? (
        <p className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-center text-sm font-semibold text-amber-950" role="status">
          {totalCount != null && totalCount > truncatedCount
            ? t(lang, "enterpriseListTruncated").replace("{shown}", String(truncatedCount)).replace("{total}", String(totalCount))
            : t(lang, "enterpriseListTruncatedShort").replace("{shown}", String(truncatedCount))}
        </p>
      ) : null}
      {hasMore && onLoadMore ? (
        <div className="flex justify-center">
          <button
            type="button"
            disabled={loadMoreLoading}
            onClick={onLoadMore}
            className="inline-flex min-h-[44px] items-center rounded-xl border border-stone-200 bg-white px-5 text-sm font-black text-stone-800 shadow-sm disabled:opacity-60"
          >
            {loadMoreLoading ? t(lang, "enterpriseLoading") : t(lang, "enterpriseLoadMore")}
          </button>
        </div>
      ) : null}
      {endOfList && !hasMore ? (
        <p className="text-center text-xs font-semibold uppercase tracking-wide text-stone-400" role="status">
          {t(lang, "enterpriseEndOfList")}
        </p>
      ) : null}
      {children}
    </div>
  );
}
