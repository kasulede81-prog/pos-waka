import { useRef, type ReactNode } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import type { AuditLogEntry, Language } from "../../../types";
import { t } from "../../../lib/i18n";
import { buildTimelineRows } from "../lib/activityPresentation";
import type { TimelinePresentation } from "../registry/investigationWidgetTypes";
import { ActivityTimelineCard } from "./ActivityTimelineCard";

const VIRTUALIZE_THRESHOLD = 24;
const HEADER_HEIGHT = 36;
const ENTRY_HEIGHT = 132;

type Props = {
  lang: Language;
  entries: AuditLogEntry[];
  productById: Map<string, { name: string }>;
  customerById: Map<string, { name: string }>;
  getTimelinePresentation?: (entry: AuditLogEntry) => TimelinePresentation | null;
  onSelect: (entry: AuditLogEntry) => void;
  onMenu: (entry: AuditLogEntry) => void;
};

function estimateRowHeight(kind: "header" | "entry"): number {
  return kind === "header" ? HEADER_HEIGHT : ENTRY_HEIGHT;
}

export function VirtualizedActivityTimeline({
  lang,
  entries,
  productById,
  customerById,
  getTimelinePresentation,
  onSelect,
  onMenu,
}: Props) {
  const { rows, entryByIndex } = buildTimelineRows(lang, entries);
  const parentRef = useRef<HTMLDivElement>(null);

  const rowVirtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () =>
      parentRef.current?.closest<HTMLElement>(".scroll-main-chrome") ??
      document.querySelector<HTMLElement>(".scroll-main-chrome") ??
      parentRef.current,
    estimateSize: (index) => estimateRowHeight(rows[index]?.kind === "header" ? "header" : "entry"),
    overscan: 8,
  });

  if (entries.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-border bg-card px-4 py-10 text-center">
        <p className="text-sm font-semibold text-muted-foreground">{t(lang, "auditEmpty")}</p>
      </div>
    );
  }

  const renderRow = (index: number): ReactNode => {
    const row = rows[index];
    if (!row) return null;
    if (row.kind === "header") {
      return (
        <p className="sticky top-[88px] z-10 bg-muted/95 py-2 text-xs font-black uppercase tracking-widest text-muted-foreground backdrop-blur-sm">
          {row.label}
        </p>
      );
    }
    const entry = entryByIndex[row.entryIndex];
    if (!entry) return null;
    const next = rows[index + 1];
    const isLastInGroup = !next || next.kind === "header";
    const presentation = getTimelinePresentation?.(entry);
    return (
      <ActivityTimelineCard
        lang={lang}
        entry={entry}
        productById={productById}
        customerById={customerById}
        titleOverride={presentation?.titleOverride}
        subtitleOverride={presentation?.subtitleOverride}
        isLastInGroup={isLastInGroup}
        onOpen={() => onSelect(entry)}
        onMenu={() => onMenu(entry)}
      />
    );
  };

  if (rows.length <= VIRTUALIZE_THRESHOLD) {
    return <div className="space-y-0">{rows.map((_, index) => <div key={rows[index]!.id}>{renderRow(index)}</div>)}</div>;
  }

  return (
    <div ref={parentRef} className="w-full">
      <div className="relative w-full" style={{ height: `${rowVirtualizer.getTotalSize()}px` }}>
        {rowVirtualizer.getVirtualItems().map((virtualRow) => (
          <div
            key={rows[virtualRow.index]!.id}
            className="absolute left-0 top-0 w-full"
            style={{ transform: `translateY(${virtualRow.start}px)` }}
          >
            {renderRow(virtualRow.index)}
          </div>
        ))}
      </div>
    </div>
  );
}
