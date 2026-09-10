export const SHOP_OPS_LEDGER_PAGE_SIZE = 25;

/** Shared generation check for ledger reset vs in-flight load-more. */
export function isCurrentOpsLedgerRequest(startedSeq: number, latestSeq: number): boolean {
  return startedSeq === latestSeq;
}

/** Append load-more rows only when the request still belongs to the current shop load. */
export function applyOpsLedgerLoadMore<T>(args: {
  startedSeq: number;
  latestSeq: number;
  previous: T[];
  incoming: T[];
}): { applied: boolean; rows: T[] } {
  if (!isCurrentOpsLedgerRequest(args.startedSeq, args.latestSeq)) {
    return { applied: false, rows: args.previous };
  }
  return { applied: true, rows: [...args.previous, ...args.incoming] };
}

export type ShopOpsLedgerList<T> = {
  rows: T[];
  hasMore: boolean;
  loading: boolean;
  loadingMore: boolean;
  error: string | null;
  loaded: boolean;
};

export function emptyShopOpsLedgerList<T>(): ShopOpsLedgerList<T> {
  return {
    rows: [],
    hasMore: false,
    loading: false,
    loadingMore: false,
    error: null,
    loaded: false,
  };
}
