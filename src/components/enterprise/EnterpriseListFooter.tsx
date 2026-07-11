import clsx from "clsx";
import type { ReactNode } from "react";
import type { Language } from "../../types";
import { t } from "../../lib/i18n";
import { statusTokens } from "../../lib/statusTokens";
import { themeUi } from "../../lib/themeTokens";

type Props = {
  lang: Language;
  truncated?: boolean;
  truncatedCount?: number;
  totalCount?: number;
  endOfList?: boolean;
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
      <p className={clsx("py-6 text-center text-sm font-semibold text-muted-foreground", className)} role="status">
        {t(lang, "enterpriseNoResults")}
      </p>
    );
  }

  return (
    <div className={clsx("space-y-3 py-4", className)}>
      {truncated && truncatedCount != null ? (
        <p className={clsx(statusTokens.warning.banner, "text-center")} role="status">
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
            className={clsx(themeUi.btnSecondary, "px-5 text-sm font-black disabled:opacity-60")}
          >
            {loadMoreLoading ? t(lang, "enterpriseLoading") : t(lang, "enterpriseLoadMore")}
          </button>
        </div>
      ) : null}
      {endOfList && !hasMore ? (
        <p className="text-center text-xs font-semibold uppercase tracking-wide text-muted-foreground" role="status">
          {t(lang, "enterpriseEndOfList")}
        </p>
      ) : null}
      {children}
    </div>
  );
}
