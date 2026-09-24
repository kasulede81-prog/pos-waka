/**
 * Merchant loyalty card design (B2) — client model + validators.
 * DB/RPC remains the security authority; these validators are UX guards.
 */

import {
  WAKA_BRAND_BLUE,
  WAKA_BRAND_ORANGE,
  WAKA_BRAND_ORANGE_DARK,
} from "../brandTokens";
import { hexContrastRatio, readableOnHex } from "../homeTileAccent";
import { hasSupabaseConfig, supabase } from "../supabase";

export const LOYALTY_CARD_STYLES = ["classic", "modern", "minimal", "premium"] as const;
export type LoyaltyCardStyle = (typeof LOYALTY_CARD_STYLES)[number];

export const LOYALTY_REWARD_LAYOUTS = ["list", "cards"] as const;
export type LoyaltyRewardLayout = (typeof LOYALTY_REWARD_LAYOUTS)[number];

/** Resolved presentation tokens (never null — defaults applied). */
export type LoyaltyCardDesign = {
  programDisplayName: string;
  logoUrl: string | null;
  primaryColor: string;
  accentColor: string;
  backgroundColor: string;
  textColor: string;
  welcomeMessage: string | null;
  cardStyle: LoyaltyCardStyle;
  rewardLayout: LoyaltyRewardLayout;
};

/** Form draft (empty strings allowed before normalize). */
export type LoyaltyCardDesignDraft = {
  programDisplayName: string;
  logoUrl: string;
  primaryColor: string;
  accentColor: string;
  backgroundColor: string;
  textColor: string;
  welcomeMessage: string;
  cardStyle: LoyaltyCardStyle;
  rewardLayout: LoyaltyRewardLayout;
};

/** Safe public payload shape (Edge / client). */
export type PublicCardDesignPayload = {
  logo_url: string | null;
  primary_color: string;
  accent_color: string;
  background_color: string;
  text_color: string;
  program_name: string;
  welcome_message: string | null;
  style: LoyaltyCardStyle;
  reward_layout: LoyaltyRewardLayout;
};

/**
 * Default WAKA loyalty visual theme (blue hero + orange accents + white text).
 * Merchant customization still overrides these via loyalty_card_designs.
 */
export const DEFAULT_LOYALTY_CARD_DESIGN: LoyaltyCardDesign = {
  programDisplayName: "",
  logoUrl: null,
  /** Points, stars, progress highlights */
  primaryColor: WAKA_BRAND_ORANGE,
  /** Secondary accent / deeper orange */
  accentColor: WAKA_BRAND_ORANGE_DARK,
  /** Deep WAKA blue hero */
  backgroundColor: WAKA_BRAND_BLUE,
  /** Primary text on hero */
  textColor: "#ffffff",
  welcomeMessage: null,
  cardStyle: "classic",
  rewardLayout: "list",
};

const WCAG_AA_NORMAL = 4.5;
const WCAG_AA_LARGE = 3;

/** Prefer merchant text when it meets AA; otherwise derive white/dark. */
export function contrastSafeForeground(
  backgroundHex: string,
  preferredHex?: string | null,
): string {
  const bg = normalizeHexColor(backgroundHex) ?? DEFAULT_LOYALTY_CARD_DESIGN.backgroundColor;
  const preferred = normalizeHexColor(preferredHex ?? null);
  if (preferred && hexContrastRatio(bg, preferred) >= WCAG_AA_NORMAL) {
    return preferred;
  }
  return readableOnHex(bg);
}

/** Keep accent readable on hero (large text / icons); fall back to brand orange or FG. */
export function contrastSafeAccentOnBackground(
  backgroundHex: string,
  accentHex: string,
  fallbackHex: string = DEFAULT_LOYALTY_CARD_DESIGN.primaryColor,
): string {
  const bg = normalizeHexColor(backgroundHex) ?? DEFAULT_LOYALTY_CARD_DESIGN.backgroundColor;
  const accent = normalizeHexColor(accentHex);
  if (accent && hexContrastRatio(bg, accent) >= WCAG_AA_LARGE) return accent;
  const fallback = normalizeHexColor(fallbackHex);
  if (fallback && hexContrastRatio(bg, fallback) >= WCAG_AA_LARGE) return fallback;
  return readableOnHex(bg);
}

/** Presentation tokens for public card + merchant live preview (same visual system). */
export type LoyaltyCardPresentation = LoyaltyCardDesign & {
  heroForeground: string;
  heroAccent: string;
  heroSecondaryAccent: string;
};

export function resolveLoyaltyPresentation(
  design: LoyaltyCardDesign | undefined | null,
): LoyaltyCardPresentation {
  const base = design ?? DEFAULT_LOYALTY_CARD_DESIGN;
  const backgroundColor =
    normalizeHexColor(base.backgroundColor) ?? DEFAULT_LOYALTY_CARD_DESIGN.backgroundColor;
  const primaryColor =
    normalizeHexColor(base.primaryColor) ?? DEFAULT_LOYALTY_CARD_DESIGN.primaryColor;
  const accentColor =
    normalizeHexColor(base.accentColor) ?? DEFAULT_LOYALTY_CARD_DESIGN.accentColor;
  const textColor = normalizeHexColor(base.textColor) ?? DEFAULT_LOYALTY_CARD_DESIGN.textColor;
  const heroForeground = contrastSafeForeground(backgroundColor, textColor);
  const heroAccent = contrastSafeAccentOnBackground(backgroundColor, primaryColor);
  const heroSecondaryAccent = contrastSafeAccentOnBackground(
    backgroundColor,
    accentColor,
    primaryColor,
  );
  return {
    ...base,
    backgroundColor,
    primaryColor,
    accentColor,
    textColor,
    heroForeground,
    heroAccent,
    heroSecondaryAccent,
  };
}

export const PROGRAM_NAME_MAX = 60;
export const WELCOME_MESSAGE_MAX = 120;
export const LOGO_URL_MAX = 2048;

const HEX_RE = /^#[0-9a-fA-F]{6}$/;

export function normalizeHexColor(input: string | null | undefined): string | null {
  if (input == null) return null;
  const c = input.trim();
  if (!c) return null;
  if (!HEX_RE.test(c)) return null;
  return c.toLowerCase();
}

export function normalizeLogoUrl(input: string | null | undefined): string | null {
  if (input == null) return null;
  const v = input.trim();
  if (!v) return null;
  if (v.length > LOGO_URL_MAX) return null;
  const lower = v.toLowerCase();
  if (!lower.startsWith("https://")) return null;
  if (lower.startsWith("javascript:") || lower.startsWith("data:") || lower.startsWith("file:")) {
    return null;
  }
  // Reject userinfo (https://user:pass@host/...)
  try {
    const u = new URL(v);
    if (u.username || u.password) return null;
    if (u.protocol !== "https:") return null;
    if (/\.svg$/i.test(u.pathname) || /\.svg$/i.test(u.pathname + u.search)) return null;
  } catch {
    return null;
  }
  if (/\.svg($|\?)/i.test(v)) return null;
  return v;
}

export type DesignValidationError =
  | "invalid_program_name"
  | "invalid_welcome_message"
  | "invalid_logo_url"
  | "invalid_color"
  | "invalid_card_style"
  | "invalid_reward_layout";

export function validateDesignDraft(draft: LoyaltyCardDesignDraft): DesignValidationError | null {
  const name = draft.programDisplayName.trim();
  if (name.length > PROGRAM_NAME_MAX) return "invalid_program_name";

  const welcome = draft.welcomeMessage.trim();
  if (welcome.length > WELCOME_MESSAGE_MAX) return "invalid_welcome_message";

  if (draft.logoUrl.trim() && !normalizeLogoUrl(draft.logoUrl)) return "invalid_logo_url";

  for (const color of [
    draft.primaryColor,
    draft.accentColor,
    draft.backgroundColor,
    draft.textColor,
  ]) {
    if (color.trim() && !normalizeHexColor(color)) return "invalid_color";
  }

  if (!LOYALTY_CARD_STYLES.includes(draft.cardStyle)) return "invalid_card_style";
  if (!LOYALTY_REWARD_LAYOUTS.includes(draft.rewardLayout)) return "invalid_reward_layout";

  return null;
}

export function draftFromDesign(design: LoyaltyCardDesign): LoyaltyCardDesignDraft {
  return {
    programDisplayName: design.programDisplayName,
    logoUrl: design.logoUrl ?? "",
    primaryColor: design.primaryColor,
    accentColor: design.accentColor,
    backgroundColor: design.backgroundColor,
    textColor: design.textColor,
    welcomeMessage: design.welcomeMessage ?? "",
    cardStyle: design.cardStyle,
    rewardLayout: design.rewardLayout,
  };
}

export function defaultDraft(shopName?: string): LoyaltyCardDesignDraft {
  return draftFromDesign({
    ...DEFAULT_LOYALTY_CARD_DESIGN,
    programDisplayName: shopName?.trim()
      ? `${shopName.trim()} Loyalty`
      : DEFAULT_LOYALTY_CARD_DESIGN.programDisplayName,
  });
}

/** Merge nullable stored row + defaults into a resolved design. */
export function mergeDesignWithDefaults(
  partial: Partial<{
    program_display_name: string | null;
    logo_url: string | null;
    primary_color: string | null;
    accent_color: string | null;
    background_color: string | null;
    text_color: string | null;
    welcome_message: string | null;
    card_style: string | null;
    reward_layout: string | null;
  }> | null,
  shopName?: string,
): LoyaltyCardDesign {
  const base = defaultDraft(shopName);
  if (!partial) {
    return {
      programDisplayName: base.programDisplayName,
      logoUrl: null,
      primaryColor: base.primaryColor,
      accentColor: base.accentColor,
      backgroundColor: base.backgroundColor,
      textColor: base.textColor,
      welcomeMessage: null,
      cardStyle: base.cardStyle,
      rewardLayout: base.rewardLayout,
    };
  }

  const style = LOYALTY_CARD_STYLES.includes(partial.card_style as LoyaltyCardStyle)
    ? (partial.card_style as LoyaltyCardStyle)
    : DEFAULT_LOYALTY_CARD_DESIGN.cardStyle;
  const layout = LOYALTY_REWARD_LAYOUTS.includes(partial.reward_layout as LoyaltyRewardLayout)
    ? (partial.reward_layout as LoyaltyRewardLayout)
    : DEFAULT_LOYALTY_CARD_DESIGN.rewardLayout;

  return {
    programDisplayName:
      partial.program_display_name?.trim() ||
      base.programDisplayName ||
      DEFAULT_LOYALTY_CARD_DESIGN.programDisplayName,
    logoUrl: normalizeLogoUrl(partial.logo_url) ?? null,
    primaryColor:
      normalizeHexColor(partial.primary_color) ?? DEFAULT_LOYALTY_CARD_DESIGN.primaryColor,
    accentColor: normalizeHexColor(partial.accent_color) ?? DEFAULT_LOYALTY_CARD_DESIGN.accentColor,
    backgroundColor:
      normalizeHexColor(partial.background_color) ?? DEFAULT_LOYALTY_CARD_DESIGN.backgroundColor,
    textColor: normalizeHexColor(partial.text_color) ?? DEFAULT_LOYALTY_CARD_DESIGN.textColor,
    welcomeMessage: partial.welcome_message?.trim() || null,
    cardStyle: style,
    rewardLayout: layout,
  };
}

export function designToPublicPayload(
  design: LoyaltyCardDesign,
  fallbackProgramName: string,
): PublicCardDesignPayload {
  return {
    logo_url: design.logoUrl,
    primary_color: design.primaryColor,
    accent_color: design.accentColor,
    background_color: design.backgroundColor,
    text_color: design.textColor,
    program_name: design.programDisplayName.trim() || fallbackProgramName,
    welcome_message: design.welcomeMessage,
    style: design.cardStyle,
    reward_layout: design.rewardLayout,
  };
}

export function publicPayloadToDesign(
  payload: PublicCardDesignPayload | null | undefined,
  fallbackProgramName: string,
): LoyaltyCardDesign | undefined {
  if (!payload) return undefined;
  return mergeDesignWithDefaults(
    {
      program_display_name: payload.program_name,
      logo_url: payload.logo_url,
      primary_color: payload.primary_color,
      accent_color: payload.accent_color,
      background_color: payload.background_color,
      text_color: payload.text_color,
      welcome_message: payload.welcome_message,
      card_style: payload.style,
      reward_layout: payload.reward_layout,
    },
    fallbackProgramName.replace(/\s+Loyalty$/i, ""),
  );
}

export async function fetchLoyaltyCardDesign(
  shopId: string,
): Promise<LoyaltyCardDesign | null> {
  if (!hasSupabaseConfig || !supabase || !shopId) return null;
  try {
    const { data, error } = await supabase
      .from("loyalty_card_designs")
      .select(
        "program_display_name, logo_url, primary_color, accent_color, background_color, text_color, welcome_message, card_style, reward_layout",
      )
      .eq("shop_id", shopId)
      .maybeSingle();
    if (error) return null;
    if (!data) return null;
    return mergeDesignWithDefaults(data as Record<string, string | null>);
  } catch {
    return null;
  }
}

export type DesignSaveResult =
  | { ok: true; design: LoyaltyCardDesign }
  | { ok: false; error: string };

export async function saveLoyaltyCardDesign(
  shopId: string,
  draft: LoyaltyCardDesignDraft,
): Promise<DesignSaveResult> {
  const invalid = validateDesignDraft(draft);
  if (invalid) return { ok: false, error: invalid };
  if (!hasSupabaseConfig || !supabase || !shopId) {
    return { ok: false, error: "unavailable" };
  }

  try {
    const { data, error } = await supabase.rpc("loyalty_upsert_card_design", {
      p_shop_id: shopId,
      p_program_display_name: draft.programDisplayName.trim() || null,
      p_logo_url: draft.logoUrl.trim() || null,
      p_primary_color: draft.primaryColor.trim() || null,
      p_accent_color: draft.accentColor.trim() || null,
      p_background_color: draft.backgroundColor.trim() || null,
      p_text_color: draft.textColor.trim() || null,
      p_welcome_message: draft.welcomeMessage.trim() || null,
      p_card_style: draft.cardStyle,
      p_reward_layout: draft.rewardLayout,
    });
    if (error) return { ok: false, error: error.code ?? "save_failed" };
    const result = (data ?? {}) as {
      ok?: boolean;
      error?: string;
      design?: Record<string, string | null>;
    };
    if (!result.ok) return { ok: false, error: result.error ?? "save_failed" };
    return {
      ok: true,
      design: mergeDesignWithDefaults(result.design ?? null),
    };
  } catch {
    return { ok: false, error: "save_failed" };
  }
}

export type DesignResetResult = { ok: true } | { ok: false; error: string };

export async function resetLoyaltyCardDesign(shopId: string): Promise<DesignResetResult> {
  if (!hasSupabaseConfig || !supabase || !shopId) {
    return { ok: false, error: "unavailable" };
  }
  try {
    const { data, error } = await supabase.rpc("loyalty_reset_card_design", {
      p_shop_id: shopId,
    });
    if (error) return { ok: false, error: error.code ?? "reset_failed" };
    const result = (data ?? {}) as { ok?: boolean; error?: string };
    if (!result.ok) return { ok: false, error: result.error ?? "reset_failed" };
    return { ok: true };
  } catch {
    return { ok: false, error: "reset_failed" };
  }
}

/** Fixture card for merchant live preview (no network, no real tokens). */
export const PREVIEW_PUBLIC_CARD_FIXTURE = {
  customer_name: "Denis",
  shop_name: "Demo Shop",
  program_name: "Demo Shop Loyalty",
  balance_points: 405,
  account_active: true,
  program_enabled: true,
  membership_active: true,
  membership_expires_on: null,
  qr_payload: "WAKA-LOYALTY:preview-placeholder",
  rewards: [
    { name: "Sugar", points_required: 100, description: "1kg sugar" },
    { name: "Rice", points_required: 200, description: null },
    { name: "Soap", points_required: 300, description: null },
  ],
  wallet_configured: true,
} as const;
