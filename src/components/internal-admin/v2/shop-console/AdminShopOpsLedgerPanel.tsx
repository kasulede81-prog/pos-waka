import type { ReactNode } from "react";
import { EmptyState } from "../primitives";
import { ResponsiveDataTable } from "../../../shared/ResponsiveDataTable";

type Props = {
  loading: boolean;
  loadingMore: boolean;
  error: string | null;
  emptyLabel: string;
  hasMore: boolean;
  onLoadMore: () => void;
  table: ReactNode;
  rowCount: number;
};

export function AdminShopOpsLedgerPanel({
  loading,
  loadingMore,
  error,
  emptyLabel,
  hasMore,
  onLoadMore,
  table,
  rowCount,
}: Props) {
  if (loading) {
    return <p className="text-sm font-semibold text-muted-foreground">Loading…</p>;
  }
  if (error) {
    return (
      <p className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm font-semibold text-rose-900">
        {error}
      </p>
    );
  }
  if (rowCount === 0) {
    return <EmptyState className="py-6">{emptyLabel}</EmptyState>;
  }

  return (
    <div className="space-y-3">
      <ResponsiveDataTable minWidthPx={560}>{table}</ResponsiveDataTable>
      {hasMore ? (
        <button
          type="button"
          disabled={loadingMore}
          onClick={onLoadMore}
          className="min-h-[44px] w-full rounded-xl border border-border text-sm font-black text-foreground disabled:opacity-40"
        >
          {loadingMore ? "Loading…" : "Load more"}
        </button>
      ) : null}
    </div>
  );
}
