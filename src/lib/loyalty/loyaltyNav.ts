/**
 * Loyalty merchant IA (Phase 1).
 *
 * One hub route, six business sections. Section lives in the path so deep links,
 * refresh and browser back/forward work. No data or permissions live here — this
 * is navigation shape only.
 */

export type LoyaltySectionId =
  | "overview"
  | "members"
  | "rewards"
  | "activity"
  | "cards"
  | "settings";

export const LOYALTY_SECTION_IDS: LoyaltySectionId[] = [
  "overview",
  "members",
  "rewards",
  "activity",
  "cards",
  "settings",
];

export const LOYALTY_HUB_BASE_PATH = "/office/loyalty";

export function loyaltySectionPath(section: LoyaltySectionId): string {
  return `${LOYALTY_HUB_BASE_PATH}/${section}`;
}

/** i18n key for the section's header subtitle. */
export function loyaltySectionSubKey(section: LoyaltySectionId): string {
  switch (section) {
    case "overview":
      return "loyaltySectionOverviewSub";
    case "members":
      return "loyaltySectionMembersSub";
    case "rewards":
      return "loyaltySectionRewardsSub";
    case "activity":
      return "loyaltySectionActivitySub";
    case "cards":
      return "loyaltySectionCardsSub";
    case "settings":
      return "loyaltySectionSettingsSub";
  }
}

export function loyaltySectionLabelKey(section: LoyaltySectionId): string {
  switch (section) {
    case "overview":
      return "loyaltyTabOverview";
    case "members":
      return "loyaltyTabMembers";
    case "rewards":
      return "loyaltyTabRewards";
    case "activity":
      return "loyaltyTabActivity";
    case "cards":
      return "loyaltyTabCards";
    case "settings":
      return "loyaltyTabSettings";
  }
}

/**
 * Map a path segment (including pre-Phase-1 tab ids) onto a current section.
 * Unknown or missing → overview. Never throws.
 */
export function resolveLoyaltySection(raw: string | undefined | null): LoyaltySectionId {
  switch (raw) {
    case undefined:
    case null:
    case "":
    case "overview":
      return "overview";
    case "members":
    case "customers":
    case "customer":
      return "members";
    case "rewards":
    case "promotions":
      return "rewards";
    case "activity":
    case "history":
      return "activity";
    case "cards":
    case "card":
    case "design":
    case "requests":
    case "join":
      return "cards";
    case "settings":
    case "earn":
    case "how-points":
    case "config":
      return "settings";
    default:
      return "overview";
  }
}

export function isLoyaltySectionId(raw: string | undefined | null): raw is LoyaltySectionId {
  return (LOYALTY_SECTION_IDS as string[]).includes(raw ?? "");
}

/**
 * Sections shown in the hub tab bar.
 * Rewards is catalog management (`settings.shop`) — hide it from staff who cannot edit it.
 * Everything else is day-to-day (lookup, enroll, share a card) and stays visible.
 */
export function loyaltySectionsForActor(params: { canManage: boolean }): LoyaltySectionId[] {
  return LOYALTY_SECTION_IDS.filter((id) => (id === "rewards" ? params.canManage : true));
}
