/**
 * Subscription in-app notifications — Phase 17.4
 * Dispatches local events consumed by ToastProvider (no SMS/email/push).
 */

export type SubscriptionNotificationKind =
  | "trial_ending"
  | "subscription_expired"
  | "grace_period"
  | "renewal_reminder"
  | "subscription_activated"
  | "subscription_cancelled"
  | "plan_changed";

export type SubscriptionNotificationPayload = {
  kind: SubscriptionNotificationKind;
  shopId?: string | null;
  message: string;
  daysRemaining?: number | null;
  planCode?: string | null;
};

const EVENT_NAME = "waka:subscription-notification";

export function dispatchSubscriptionNotification(payload: SubscriptionNotificationPayload): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(EVENT_NAME, { detail: payload }));
}

export function subscribeSubscriptionNotifications(
  handler: (payload: SubscriptionNotificationPayload) => void,
): () => void {
  if (typeof window === "undefined") return () => {};
  const listener = (ev: Event) => {
    const detail = (ev as CustomEvent<SubscriptionNotificationPayload>).detail;
    if (detail?.kind && detail.message) handler(detail);
  };
  window.addEventListener(EVENT_NAME, listener);
  return () => window.removeEventListener(EVENT_NAME, listener);
}

export function notificationMessageForKind(
  kind: SubscriptionNotificationKind,
  opts: { daysRemaining?: number | null; planCode?: string | null } = {},
): string {
  const plan = opts.planCode ? opts.planCode.replace(/_/g, " ") : "your plan";
  switch (kind) {
    case "trial_ending":
      return opts.daysRemaining != null
        ? `Trial ending in ${opts.daysRemaining} day${opts.daysRemaining === 1 ? "" : "s"}.`
        : "Your trial is ending soon.";
    case "subscription_expired":
      return "Your subscription has expired. Upgrade to restore full access.";
    case "grace_period":
      return "Your subscription is in the grace period. Renew soon to avoid downgrade.";
    case "renewal_reminder":
      return opts.daysRemaining != null
        ? `Subscription renews in ${opts.daysRemaining} day${opts.daysRemaining === 1 ? "" : "s"}.`
        : "Subscription renewal reminder.";
    case "subscription_activated":
      return `${plan} subscription is now active.`;
    case "subscription_cancelled":
      return "Your subscription has been cancelled.";
    case "plan_changed":
      return `Plan changed to ${plan}.`;
    default:
      return "Subscription update.";
  }
}

export function emitTrialEndingReminder(shopId: string, daysRemaining: number, planCode?: string): void {
  dispatchSubscriptionNotification({
    kind: "trial_ending",
    shopId,
    daysRemaining,
    planCode,
    message: notificationMessageForKind("trial_ending", { daysRemaining, planCode }),
  });
}

export function emitRenewalReminder(shopId: string, daysRemaining: number, planCode?: string): void {
  dispatchSubscriptionNotification({
    kind: "renewal_reminder",
    shopId,
    daysRemaining,
    planCode,
    message: notificationMessageForKind("renewal_reminder", { daysRemaining, planCode }),
  });
}

export function emitGracePeriodNotice(shopId: string, planCode?: string): void {
  dispatchSubscriptionNotification({
    kind: "grace_period",
    shopId,
    planCode,
    message: notificationMessageForKind("grace_period", { planCode }),
  });
}

export function emitSubscriptionExpired(shopId: string): void {
  dispatchSubscriptionNotification({
    kind: "subscription_expired",
    shopId,
    message: notificationMessageForKind("subscription_expired"),
  });
}

export function emitSubscriptionActivated(shopId: string, planCode: string): void {
  dispatchSubscriptionNotification({
    kind: "subscription_activated",
    shopId,
    planCode,
    message: notificationMessageForKind("subscription_activated", { planCode }),
  });
}

export function emitSubscriptionCancelled(shopId: string): void {
  dispatchSubscriptionNotification({
    kind: "subscription_cancelled",
    shopId,
    message: notificationMessageForKind("subscription_cancelled"),
  });
}

export function emitPlanChanged(shopId: string, planCode: string): void {
  dispatchSubscriptionNotification({
    kind: "plan_changed",
    shopId,
    planCode,
    message: notificationMessageForKind("plan_changed", { planCode }),
  });
}
