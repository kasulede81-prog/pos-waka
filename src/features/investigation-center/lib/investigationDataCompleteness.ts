/**
 * IC-P2-04 — Investigation Center remainder readiness.
 * Derives from existing store hydrationStage. Does not wait on cloud sync.
 */
export type InvestigationHydrationStage = "none" | "critical" | "interactive" | "background" | "complete";

export type InvestigationDataCompleteness = {
  dataComplete: boolean;
};

export function resolveInvestigationDataCompleteness(input: {
  hydrationStage: InvestigationHydrationStage | string;
}): InvestigationDataCompleteness {
  return { dataComplete: input.hydrationStage === "complete" };
}

export function isInvestigationDataComplete(stage: InvestigationHydrationStage | string): boolean {
  return resolveInvestigationDataCompleteness({ hydrationStage: stage }).dataComplete;
}

export function canPresentInvestigationKpis(dataComplete: boolean): boolean {
  return dataComplete;
}

export function canExportInvestigationData(dataComplete: boolean): boolean {
  return dataComplete;
}

export function canShareInvestigationData(dataComplete: boolean): boolean {
  return dataComplete;
}

/** Incomplete must not use auditEmpty. Complete + zero matches may. */
export function investigationTimelineEmptyCopyKey(dataComplete: boolean): "icActivityLoading" | "auditEmpty" {
  return dataComplete ? "auditEmpty" : "icActivityLoading";
}

export function investigationRefundsPresentation(dataComplete: boolean): "loading" | "ready" {
  return dataComplete ? "ready" : "loading";
}

export function investigationResultCountKind(
  dataComplete: boolean,
  matchingTotal: number,
  shown: number,
): "hidden" | "showing" | "showingOfTotal" {
  if (!dataComplete) return "hidden";
  if (matchingTotal > shown) return "showingOfTotal";
  if (shown > 0) return "showing";
  return "hidden";
}
