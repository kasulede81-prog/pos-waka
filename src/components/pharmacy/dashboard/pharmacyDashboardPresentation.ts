import type { AuditLogEntry, Language } from "../../../types";
import { describeAuditLine } from "../../../lib/activityNarrative";
import { t } from "../../../lib/i18n";

export type ActivityTimelineItem = {
  id: string;
  at: string;
  timeLabel: string;
  title: string;
  subtitle: string;
  tagKey: string;
  tagTone: "teal" | "blue" | "amber" | "rose" | "violet" | "stone";
};

function formatTimeLabel(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", hour12: true });
  } catch {
    return "—";
  }
}

function formatBusinessDateLabel(dateKey: string): string {
  const [y, m, d] = dateKey.split("-").map(Number);
  if (!y || !m || !d) return dateKey;
  try {
    return new Date(y, m - 1, d).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
  } catch {
    return dateKey;
  }
}

export function formatPharmacyBusinessDate(dateKey: string): string {
  return formatBusinessDateLabel(dateKey);
}

export function formatShiftTimeLabel(iso: string | undefined): string {
  if (!iso) return "—";
  return formatTimeLabel(iso);
}

export function greetingKeyForHour(hour: number): string {
  if (hour < 12) return "desktopHomeGreetingMorning";
  if (hour < 17) return "desktopHomeGreetingAfternoon";
  return "desktopHomeGreetingEvening";
}

export function formatSyncAgoLabel(lang: Language, iso: string | null | undefined, nowMs = Date.now()): string {
  if (!iso) return t(lang, "pharmacyOpsSyncUnknown");
  const t0 = new Date(iso).getTime();
  if (!Number.isFinite(t0)) return t(lang, "pharmacyOpsSyncUnknown");
  const sec = Math.max(0, Math.round((nowMs - t0) / 1000));
  if (sec < 60) return t(lang, "pharmacyOpsSyncJustNow");
  const min = Math.round(sec / 60);
  if (min < 60) return t(lang, "pharmacyOpsSyncMinutes").replace("{minutes}", String(min));
  const hr = Math.round(min / 60);
  return t(lang, "pharmacyOpsSyncHours").replace("{hours}", String(hr));
}

function activityTitleForAction(lang: Language, action: string): string {
  switch (action) {
    case "sale_completed":
      return t(lang, "pharmacyActivityDispensed");
    case "shift_start":
      return t(lang, "pharmacyActivityShiftOpened");
    case "shift_end":
      return t(lang, "pharmacyActivityShiftClosed");
    case "stock_adjust":
    case "purchase_add":
    case "purchase_receive":
      return t(lang, "pharmacyActivityReceivedStock");
    case "product_add":
      return t(lang, "pharmacyActivityStockUpdate");
    case "day_close":
      return t(lang, "pharmacyActivityDayClosed");
  }
  if (action.includes("controlled") || action.includes("compliance")) {
    return t(lang, "pharmacyActivityCompliance");
  }
  if (action.includes("prescription") || action.includes("rx")) {
    return t(lang, "pharmacyActivityPrescription");
  }
  return t(lang, "pharmacyActivityUpdate");
}

function activityTagForAction(action: string): { tagKey: string; tagTone: ActivityTimelineItem["tagTone"] } {
  switch (action) {
    case "sale_completed":
      return { tagKey: "pharmacyActivityTagPrescription", tagTone: "teal" };
    case "shift_start":
    case "shift_end":
      return { tagKey: "pharmacyActivityTagShift", tagTone: "blue" };
    case "stock_adjust":
    case "purchase_add":
    case "purchase_receive":
    case "product_add":
      return { tagKey: "pharmacyActivityTagStock", tagTone: "violet" };
    case "day_close":
      return { tagKey: "pharmacyActivityTagShift", tagTone: "blue" };
  }
  if (action.includes("controlled") || action.includes("compliance")) {
    return { tagKey: "pharmacyActivityTagCompliance", tagTone: "amber" };
  }
  return { tagKey: "pharmacyActivityTagGeneral", tagTone: "stone" };
}

export function buildPharmacyActivityTimeline(
  lang: Language,
  auditLogs: AuditLogEntry[],
  productById: Map<string, { name: string }>,
  customerById: Map<string, { name: string }>,
  maxItems = 8,
): ActivityTimelineItem[] {
  return [...auditLogs]
    .sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime())
    .slice(0, maxItems)
    .map((e) => {
      const { tagKey, tagTone } = activityTagForAction(e.action);
      return {
        id: e.id,
        at: e.at,
        timeLabel: formatTimeLabel(e.at),
        title: activityTitleForAction(lang, e.action),
        subtitle: describeAuditLine(lang, e, productById, customerById),
        tagKey,
        tagTone,
      };
    });
}

export type MetricPresentation = {
  primary: string;
  secondary: string;
  isEmpty: boolean;
};

export function presentCount(
  lang: Language,
  count: number,
  unitKey: string,
  emptyPrimaryKey: string,
  emptySecondaryKey: string,
): MetricPresentation {
  if (count <= 0) {
    return {
      primary: t(lang, emptyPrimaryKey),
      secondary: t(lang, emptySecondaryKey),
      isEmpty: true,
    };
  }
  return {
    primary: String(count),
    secondary: t(lang, unitKey),
    isEmpty: false,
  };
}
