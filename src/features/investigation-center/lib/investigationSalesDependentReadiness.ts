/**
 * IC-P2-07 — sales-tail readiness for refund integrity / sale-linked detail only.
 * Does not change IC-P2-04 hydrationStage remainder contract.
 */
export type InvestigationSalesDependentReadiness = {
  salesDependentReady: boolean;
};

export function resolveInvestigationSalesDependentReadiness(input: {
  salesHistoryHydrationActive: boolean;
}): InvestigationSalesDependentReadiness {
  return { salesDependentReady: !input.salesHistoryHydrationActive };
}

export function canPresentRefundIntegrity(salesDependentReady: boolean): boolean {
  return salesDependentReady;
}

export function investigationRefundIntegrityPresentation(
  salesDependentReady: boolean,
): "loading" | "ready" {
  return salesDependentReady ? "ready" : "loading";
}

export function investigationRefundTracePresentation(input: {
  salesDependentReady: boolean;
  saleId: string | null | undefined;
  saleFound: boolean;
}): "ready" | "loading" | "unlinked" {
  const saleId = typeof input.saleId === "string" ? input.saleId.trim() : "";
  if (!saleId) return "unlinked";
  if (input.saleFound) return "ready";
  return input.salesDependentReady ? "unlinked" : "loading";
}
