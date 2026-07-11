/**
 * Centralized status badge / pill tokens — theme-aware via CSS variables.
 * Class names are explicit strings so Tailwind JIT includes them.
 */

export type StatusKind =
  | "success"
  | "warning"
  | "danger"
  | "info"
  | "draft"
  | "pending"
  | "trial"
  | "expired"
  | "cancelled"
  | "offline"
  | "syncing"
  | "paid"
  | "free"
  | "business"
  | "vip"
  | "active"
  | "security";

type StatusClasses = {
  badge: string;
  badgeRing: string;
  dot: string;
  icon: string;
  banner: string;
};

const BASE_BADGE = "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-bold ring-1 ring-inset";
const BASE_DOT = "h-2 w-2 shrink-0 rounded-full";
const BASE_ICON = "inline-flex items-center justify-center rounded-xl";
const BASE_BANNER = "rounded-xl border px-4 py-3 text-sm font-semibold";

export const statusTokens: Record<StatusKind, StatusClasses> = {
  success: {
    badge: `${BASE_BADGE} bg-success-muted text-success-foreground ring-success/30`,
    badgeRing: `${BASE_BADGE} bg-success-muted text-success-foreground ring-success/40`,
    dot: `${BASE_DOT} bg-success`,
    icon: `${BASE_ICON} bg-success-muted text-success`,
    banner: `${BASE_BANNER} border-success/30 bg-success-muted text-success-foreground`,
  },
  warning: {
    badge: `${BASE_BADGE} bg-warning-muted text-warning-foreground ring-warning/30`,
    badgeRing: `${BASE_BADGE} bg-warning-muted text-warning-foreground ring-warning/40`,
    dot: `${BASE_DOT} bg-warning`,
    icon: `${BASE_ICON} bg-warning-muted text-warning`,
    banner: `${BASE_BANNER} border-warning/30 bg-warning-muted text-warning-foreground`,
  },
  danger: {
    badge: `${BASE_BADGE} bg-danger-muted text-danger-foreground ring-danger/30`,
    badgeRing: `${BASE_BADGE} bg-danger-muted text-danger-foreground ring-danger/40`,
    dot: `${BASE_DOT} bg-danger`,
    icon: `${BASE_ICON} bg-danger-muted text-danger`,
    banner: `${BASE_BANNER} border-danger/30 bg-danger-muted text-danger-foreground`,
  },
  info: {
    badge: `${BASE_BADGE} bg-info-muted text-info-foreground ring-info/30`,
    badgeRing: `${BASE_BADGE} bg-info-muted text-info-foreground ring-info/40`,
    dot: `${BASE_DOT} bg-info`,
    icon: `${BASE_ICON} bg-info-muted text-info`,
    banner: `${BASE_BANNER} border-info/30 bg-info-muted text-info-foreground`,
  },
  draft: {
    badge: `${BASE_BADGE} bg-draft-muted text-draft-foreground ring-draft/30`,
    badgeRing: `${BASE_BADGE} bg-draft-muted text-draft-foreground ring-draft/40`,
    dot: `${BASE_DOT} bg-draft`,
    icon: `${BASE_ICON} bg-draft-muted text-draft`,
    banner: `${BASE_BANNER} border-draft/30 bg-draft-muted text-draft-foreground`,
  },
  pending: {
    badge: `${BASE_BADGE} bg-pending-muted text-pending-foreground ring-pending/30`,
    badgeRing: `${BASE_BADGE} bg-pending-muted text-pending-foreground ring-pending/40`,
    dot: `${BASE_DOT} bg-pending`,
    icon: `${BASE_ICON} bg-pending-muted text-pending`,
    banner: `${BASE_BANNER} border-pending/30 bg-pending-muted text-pending-foreground`,
  },
  trial: {
    badge: `${BASE_BADGE} bg-trial-muted text-trial-foreground ring-trial/30`,
    badgeRing: `${BASE_BADGE} bg-trial-muted text-trial-foreground ring-trial/40`,
    dot: `${BASE_DOT} bg-trial`,
    icon: `${BASE_ICON} bg-trial-muted text-trial`,
    banner: `${BASE_BANNER} border-trial/30 bg-trial-muted text-trial-foreground`,
  },
  expired: {
    badge: `${BASE_BADGE} bg-expired-muted text-expired-foreground ring-expired/30`,
    badgeRing: `${BASE_BADGE} bg-expired-muted text-expired-foreground ring-expired/40`,
    dot: `${BASE_DOT} bg-expired`,
    icon: `${BASE_ICON} bg-expired-muted text-expired`,
    banner: `${BASE_BANNER} border-expired/30 bg-expired-muted text-expired-foreground`,
  },
  cancelled: {
    badge: `${BASE_BADGE} bg-cancelled-muted text-cancelled-foreground ring-cancelled/30`,
    badgeRing: `${BASE_BADGE} bg-cancelled-muted text-cancelled-foreground ring-cancelled/40`,
    dot: `${BASE_DOT} bg-cancelled`,
    icon: `${BASE_ICON} bg-cancelled-muted text-cancelled`,
    banner: `${BASE_BANNER} border-cancelled/30 bg-cancelled-muted text-cancelled-foreground`,
  },
  offline: {
    badge: `${BASE_BADGE} bg-offline-muted text-offline-foreground ring-offline/30`,
    badgeRing: `${BASE_BADGE} bg-offline-muted text-offline-foreground ring-offline/40`,
    dot: `${BASE_DOT} bg-offline`,
    icon: `${BASE_ICON} bg-offline-muted text-offline`,
    banner: `${BASE_BANNER} border-offline/30 bg-offline-muted text-offline-foreground`,
  },
  syncing: {
    badge: `${BASE_BADGE} bg-syncing-muted text-syncing-foreground ring-syncing/30`,
    badgeRing: `${BASE_BADGE} bg-syncing-muted text-syncing-foreground ring-syncing/40`,
    dot: `${BASE_DOT} bg-syncing`,
    icon: `${BASE_ICON} bg-syncing-muted text-syncing`,
    banner: `${BASE_BANNER} border-syncing/30 bg-syncing-muted text-syncing-foreground`,
  },
  paid: {
    badge: `${BASE_BADGE} bg-paid-muted text-paid-foreground ring-paid/30`,
    badgeRing: `${BASE_BADGE} bg-paid-muted text-paid-foreground ring-paid/40`,
    dot: `${BASE_DOT} bg-paid`,
    icon: `${BASE_ICON} bg-paid-muted text-paid`,
    banner: `${BASE_BANNER} border-paid/30 bg-paid-muted text-paid-foreground`,
  },
  free: {
    badge: `${BASE_BADGE} bg-free-muted text-free-foreground ring-free/30`,
    badgeRing: `${BASE_BADGE} bg-free-muted text-free-foreground ring-free/40`,
    dot: `${BASE_DOT} bg-free`,
    icon: `${BASE_ICON} bg-free-muted text-free`,
    banner: `${BASE_BANNER} border-free/30 bg-free-muted text-free-foreground`,
  },
  business: {
    badge: `${BASE_BADGE} bg-business-muted text-business-foreground ring-business/30`,
    badgeRing: `${BASE_BADGE} bg-business-muted text-business-foreground ring-business/40`,
    dot: `${BASE_DOT} bg-business`,
    icon: `${BASE_ICON} bg-business-muted text-business`,
    banner: `${BASE_BANNER} border-business/30 bg-business-muted text-business-foreground`,
  },
  vip: {
    badge: `${BASE_BADGE} bg-vip-muted text-vip-foreground ring-vip/30`,
    badgeRing: `${BASE_BADGE} bg-vip-muted text-vip-foreground ring-vip/40`,
    dot: `${BASE_DOT} bg-vip`,
    icon: `${BASE_ICON} bg-vip-muted text-vip`,
    banner: `${BASE_BANNER} border-vip/30 bg-vip-muted text-vip-foreground`,
  },
  active: {
    badge: `${BASE_BADGE} bg-active-muted text-active-foreground ring-active/30`,
    badgeRing: `${BASE_BADGE} bg-active-muted text-active-foreground ring-active/40`,
    dot: `${BASE_DOT} bg-active`,
    icon: `${BASE_ICON} bg-active-muted text-active`,
    banner: `${BASE_BANNER} border-active/30 bg-active-muted text-active-foreground`,
  },
  security: {
    badge: `${BASE_BADGE} bg-violet-100 text-violet-800 ring-violet-200/80 dark:bg-violet-950 dark:text-violet-200 dark:ring-violet-800/60`,
    badgeRing: `${BASE_BADGE} bg-violet-100 text-violet-800 ring-violet-200/80 dark:bg-violet-950 dark:text-violet-200 dark:ring-violet-800/60`,
    dot: `${BASE_DOT} bg-violet-500`,
    icon: `${BASE_ICON} bg-violet-100 text-violet-700 dark:bg-violet-950 dark:text-violet-300`,
    banner: `${BASE_BANNER} border-violet-200 bg-violet-50 text-violet-900 dark:border-violet-800/60 dark:bg-violet-950 dark:text-violet-200`,
  },
};

export function severityStatusBadge(severity: "completed" | "info" | "warning" | "security" | "error"): string {
  if (severity === "completed") return statusTokens.success.badgeRing;
  if (severity === "info") return statusTokens.info.badgeRing;
  if (severity === "warning") return statusTokens.warning.badgeRing;
  if (severity === "security") return statusTokens.security.badgeRing;
  return statusTokens.danger.badgeRing;
}

export function severityStatusIcon(severity: "completed" | "info" | "warning" | "security" | "error"): string {
  if (severity === "completed") return statusTokens.success.icon;
  if (severity === "info") return statusTokens.info.icon;
  if (severity === "warning") return statusTokens.warning.icon;
  if (severity === "security") return statusTokens.security.icon;
  return statusTokens.danger.icon;
}

export function saveIndicatorClasses(status: "saved" | "saving" | "pending" | "dirty"): string {
  if (status === "saved") return `${statusTokens.success.badge} px-3 py-1 text-xs font-black`;
  if (status === "saving") return "inline-flex min-h-[32px] items-center gap-1.5 rounded-full bg-muted px-3 py-1 text-xs font-black text-muted-foreground";
  return `${statusTokens.warning.badge} px-3 py-1 text-xs font-black`;
}

export function healthStatusBadge(tier: "ok" | "warning" | "critical"): string {
  if (tier === "critical") return statusTokens.danger.badgeRing;
  if (tier === "warning") return statusTokens.warning.badgeRing;
  return statusTokens.success.badgeRing;
}

export function healthStatusDot(tier: "ok" | "warning" | "critical"): string {
  if (tier === "critical") return statusTokens.danger.dot;
  if (tier === "warning") return statusTokens.warning.dot;
  return statusTokens.success.dot;
}

export function staffRiskBadge(tier: "ok" | "review" | "offender"): string {
  if (tier === "offender") return statusTokens.danger.badge;
  if (tier === "review") return statusTokens.warning.badge;
  return statusTokens.success.badge;
}

export function errorStateClasses(): { shell: string; icon: string; title: string; body: string } {
  return {
    shell: "rounded-2xl border border-danger/30 bg-danger-muted/80 px-6 py-8 text-center",
    icon: "inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-card text-danger shadow-sm ring-1 ring-danger/30",
    title: "mt-4 text-lg font-black text-danger-foreground",
    body: "mt-2 text-sm font-medium text-danger-foreground/80",
  };
}

export function emptyStateClasses(): { shell: string; icon: string; title: string; body: string } {
  return {
    shell: "flex flex-col items-center rounded-2xl border border-dashed border-border bg-surface-muted/80 px-6 py-10 text-center",
    icon: "inline-flex h-14 w-14 items-center justify-center rounded-2xl bg-card text-muted-foreground shadow-sm ring-1 ring-border/80",
    title: "mt-4 text-lg font-black text-foreground",
    body: "mt-2 max-w-md text-sm font-medium text-muted-foreground",
  };
}
