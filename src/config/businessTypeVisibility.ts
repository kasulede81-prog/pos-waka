import type { BusinessType } from "../types";
import { BUSINESS_TYPE_IDS } from "./businessTypes";
import { HOSPITALITY_ONBOARDING_STYLES, HOSPITALITY_ONBOARDING_GROUP_ID } from "./hospitalityOnboarding";
import {
  ONBOARDING_BUSINESS_CARDS,
  type OnboardingBusinessCard,
} from "./onboardingFlow";
/** Types surfaced in the super-admin “Experimental” section (visibility only). */
export const EXPERIMENTAL_BUSINESS_TYPE_IDS: readonly BusinessType[] = [
  "hardware",
  "electronics",
  "salon",
  "produce_market",
  "mini_supermarket",
] as const;

/** Admin label override (enum stays `other`). */
export const EXPERIMENTAL_DISPLAY_ALIASES: Partial<Record<BusinessType, string>> = {
  produce_market: "Agriculture",
  other: "Auto Parts",
};

export type PlatformBusinessTypeSettings = {
  enabled: BusinessType[];
  showExperimental: boolean;
};

export type BusinessTypeVisibilityStatus = "enabled" | "disabled" | "experimental";

export type VisibleBusinessType = {
  id: BusinessType;
  status: BusinessTypeVisibilityStatus;
  experimental: boolean;
  selectable: boolean;
};

/** Client fallback when RPC returns no enabled array — matches DB default after migration 096. */
export const DEFAULT_PLATFORM_BUSINESS_TYPE_SETTINGS: PlatformBusinessTypeSettings = {
  enabled: BUSINESS_TYPE_IDS.filter((id) => !isExperimentalBusinessType(id)),
  showExperimental: false,
};

/** Used when platform settings cannot be loaded — do not expose all types. */
export const REGISTRATION_SAFE_BUSINESS_TYPE_SETTINGS: PlatformBusinessTypeSettings = {
  enabled: ["kiosk_duka"],
  showExperimental: false,
};

const HOSPITALITY_TYPES: BusinessType[] = ["restaurant", "bar", "restaurant_bar", "hotel"];

export function isExperimentalBusinessType(id: BusinessType): boolean {
  return (EXPERIMENTAL_BUSINESS_TYPE_IDS as readonly string[]).includes(id);
}

export function parsePlatformBusinessTypeSettings(raw: unknown): PlatformBusinessTypeSettings {
  if (!raw || typeof raw !== "object") return DEFAULT_PLATFORM_BUSINESS_TYPE_SETTINGS;
  const o = raw as { enabled?: unknown; show_experimental?: unknown };
  if (!Array.isArray(o.enabled)) {
    return {
      enabled: [...DEFAULT_PLATFORM_BUSINESS_TYPE_SETTINGS.enabled],
      showExperimental: Boolean(o.show_experimental),
    };
  }
  const enabled = o.enabled.filter(
    (id): id is BusinessType => typeof id === "string" && (BUSINESS_TYPE_IDS as readonly string[]).includes(id),
  );
  return {
    enabled,
    showExperimental: Boolean(o.show_experimental),
  };
}

export function isBusinessTypeEnabled(id: BusinessType, settings: PlatformBusinessTypeSettings): boolean {
  return settings.enabled.includes(id);
}

export function businessTypeVisibilityStatus(
  id: BusinessType,
  settings: PlatformBusinessTypeSettings,
  isSuperAdmin: boolean,
): BusinessTypeVisibilityStatus {
  const enabled = isBusinessTypeEnabled(id, settings);
  if (enabled) return "enabled";
  if (isSuperAdmin && isExperimentalBusinessType(id)) return "experimental";
  if (isSuperAdmin) return "disabled";
  return "disabled";
}

/**
 * Central visibility helper — registration / onboarding selection only.
 * Existing shops keep their stored business_type regardless of flags.
 */
export function getVisibleBusinessTypes(
  settings: PlatformBusinessTypeSettings = DEFAULT_PLATFORM_BUSINESS_TYPE_SETTINGS,
  isSuperAdmin = false,
): VisibleBusinessType[] {
  const out: VisibleBusinessType[] = [];

  for (const id of BUSINESS_TYPE_IDS) {
    const experimental = isExperimentalBusinessType(id);
    const enabled = isBusinessTypeEnabled(id, settings);

    if (!isSuperAdmin) {
      if (!enabled) continue;
      out.push({ id, status: "enabled", experimental, selectable: true });
      continue;
    }

    const status = businessTypeVisibilityStatus(id, settings, true);
    out.push({
      id,
      status,
      experimental,
      selectable: true,
    });
  }

  return out;
}

export function isBusinessTypeVisibleForOnboarding(
  id: BusinessType,
  settings: PlatformBusinessTypeSettings,
  isSuperAdmin: boolean,
): boolean {
  if (isSuperAdmin) return getVisibleBusinessTypes(settings, true).some((row) => row.id === id);
  return isBusinessTypeEnabled(id, settings);
}

export function isHospitalityOnboardingVisible(
  settings: PlatformBusinessTypeSettings,
  isSuperAdmin: boolean,
): boolean {
  if (isSuperAdmin) {
    const visible = getVisibleBusinessTypes(settings, true);
    return HOSPITALITY_TYPES.some((id) => visible.some((row) => row.id === id));
  }
  return HOSPITALITY_TYPES.some((id) => isBusinessTypeEnabled(id, settings));
}

export function filterOnboardingBusinessCards(
  cards: OnboardingBusinessCard[],
  settings: PlatformBusinessTypeSettings,
  isSuperAdmin: boolean,
): OnboardingBusinessCard[] {
  return cards.filter((card) => {
    if (card.hospitalityGroup) return isHospitalityOnboardingVisible(settings, isSuperAdmin);
    if (card.businessType) return isBusinessTypeVisibleForOnboarding(card.businessType, settings, isSuperAdmin);
    return false;
  });
}

export function filterHospitalityOnboardingStyles(
  settings: PlatformBusinessTypeSettings,
  isSuperAdmin: boolean,
) {
  return HOSPITALITY_ONBOARDING_STYLES.filter((style) =>
    isBusinessTypeVisibleForOnboarding(style.businessType, settings, isSuperAdmin),
  );
}

export function filterNonHospitalityBusinessTypeIds(
  ids: readonly BusinessType[],
  settings: PlatformBusinessTypeSettings,
  isSuperAdmin: boolean,
): BusinessType[] {
  return ids.filter((id) => isBusinessTypeVisibleForOnboarding(id, settings, isSuperAdmin));
}

/** IDs shown on onboarding cards (for tests / diagnostics). */
export function onboardingBusinessTypeIdsFromCards(
  cards: OnboardingBusinessCard[] = ONBOARDING_BUSINESS_CARDS,
): BusinessType[] {
  const ids = new Set<BusinessType>();
  for (const card of cards) {
    if (card.businessType) ids.add(card.businessType);
    if (card.hospitalityGroup) {
      for (const style of HOSPITALITY_ONBOARDING_STYLES) ids.add(style.businessType);
    }
  }
  return [...ids];
}

export { HOSPITALITY_ONBOARDING_GROUP_ID };
