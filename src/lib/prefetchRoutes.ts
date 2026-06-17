/** Warm route chunks before navigation (touch / hover on launcher tiles). */
export function prefetchOfficeHub(): void {
  void import("../pages/OfficeHubPage");
}

export function prefetchStockPage(): void {
  void import("../pages/StockPage");
}
