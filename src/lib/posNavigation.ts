/** POS route entry — today Sell goes straight to /pos; future: /pos/operator then /pos. */
export const POS_SELL_ROUTE = "/pos" as const;

/** Future operator gate (not wired yet). */
export const POS_OPERATOR_ROUTE = "/pos/operator" as const;

export const POS_HOME_ROUTE = "/" as const;
export const POS_RECEIPTS_ROUTE = "/receipts" as const;
export const POS_SHOP_ROUTE = "/office" as const;
