import { useMemo } from "react";
import type { Language } from "../types";
import { useDeferredReportingAuditLogs } from "./useDeferredReportingAuditLogs";
import { usePosStore } from "../store/usePosStore";
import { dateKeyKampala } from "../lib/datesUg";
import { buildOwnerRiskCards, sumOwnerRiskCardCounts, type OwnerRiskCard } from "../lib/ownerRiskDashboard";

export function useOwnerRiskCards(lang: Language, includeArchived = false): {
  cards: OwnerRiskCard[];
  totalCount: number;
  todayKey: string;
} {
  const auditLogs = useDeferredReportingAuditLogs(includeArchived);
  const voidRecords = usePosStore((s) => s.voidRecords);
  const archivedVoidRecords = usePosStore((s) => s.archivedVoidRecords);
  const returnRecords = usePosStore((s) => s.returnRecords);
  const archivedReturnRecords = usePosStore((s) => s.archivedReturnRecords);

  const reportingVoidRecords = includeArchived ? [...voidRecords, ...archivedVoidRecords] : voidRecords;
  const reportingReturnRecords = includeArchived ? [...returnRecords, ...archivedReturnRecords] : returnRecords;

  const todayKey = dateKeyKampala(new Date());

  const cards = useMemo(() => {
    const todayAuditLogs = auditLogs.filter((e) => dateKeyKampala(e.at) === todayKey);
    const todayReturns = reportingReturnRecords.filter((r) => dateKeyKampala(r.createdAt) === todayKey);
    const todayVoids = reportingVoidRecords.filter((v) => dateKeyKampala(v.createdAt) === todayKey);
    return buildOwnerRiskCards({ lang, todayKey, todayAuditLogs, todayReturns, todayVoids });
  }, [auditLogs, reportingReturnRecords, reportingVoidRecords, lang, todayKey]);

  const totalCount = useMemo(() => sumOwnerRiskCardCounts(cards), [cards]);

  return { cards, totalCount, todayKey };
}
