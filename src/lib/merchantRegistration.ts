/**
 * The two decisions merchant registration makes about a signed-in person, kept pure so they can
 * be tested without rendering a route or mocking a session.
 *
 * Neither function grants anything: the first decides which screen a merchant sees while the
 * server's answer is missing, and the second decides where an already-authenticated visitor to
 * the marketing registration page is sent. Provisioning is still authorized server-side, by
 * `waka_account_identity()` through the guarded bootstrap.
 */

export type OnboardingGateDecision =
  /** The server says the business profile is complete. */
  | "complete"
  /** The server says it is NOT complete — show the wizard / the settings prompt. */
  | "incomplete"
  /** The server could not be asked. Must not be treated as complete. */
  | "unavailable";

/**
 * FAIL CLOSED. `null` is "we could not find out", and the only safe reading of that is *not*
 * complete: treating it as complete silently drops the business-profile requirement for every
 * merchant for as long as the outage lasts, which is how a shop ends up running on a profile
 * nobody ever finished.
 */
export function onboardingGateDecision(status: { complete: boolean } | null | undefined): OnboardingGateDecision {
  if (!status) return "unavailable";
  return status.complete ? "complete" : "incomplete";
}

/**
 * Where an authenticated visitor to `/register` belongs.
 *
 * `/register` is linked from the marketing pages, so most people who reach it while signed in are
 * not new owners at all — they are existing merchants following a link, or DKASU Loyalty members.
 * Only `unknown` (a session that is neither) is offered the merchant decision.
 */
export function authenticatedVisitorDestination(
  kind: "merchant" | "member" | "unknown",
): string {
  if (kind === "merchant") return "/";
  if (kind === "member") return "/member";
  return "/welcome";
}

/** `resolveAccountIdentity`'s kind, as this module names it. */
export function visitorKindFromIdentity(kind: string): "merchant" | "member" | "unknown" {
  if (kind === "merchant") return "merchant";
  if (kind === "member") return "member";
  return "unknown";
}

export type MerchantSignupMetadataInput = {
  /** Registered / legal business name — becomes `organization_name`. */
  organizationName: string;
  /** Trading name — becomes `shop_display_name`, falling back to the organization name. */
  shopDisplayName?: string;
  /**
   * The business type the person actually chose, or `null` when nobody has asked them yet.
   *
   * NULL MEANS "NOT ASKED", and it must stay absent from the metadata. `/register` has no
   * business-type field — the onboarding wizard does — so writing a default here stamped
   * `kiosk_duka` onto every pharmacy, bar and hotel at signup and created the shop with it before
   * anyone was asked. The wizard's save writes the real type; the server's own default covers the
   * window in between.
   */
  businessType: string | null;
  fullName?: string;
  phoneE164?: string | null;
  districtId?: string | null;
  gpsSkipped?: boolean;
  defaultCurrency?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  referralCode?: string | null;
};

/**
 * The metadata that declares merchant intent. It is the ONLY thing a signup writes, and it is
 * deliberately a pure function so the shape can be asserted directly rather than through a
 * rendered hook: `pos_role` + a business name is exactly what `waka_account_identity()` reads to
 * answer `merchant_intent`, and everything else is a detail the bootstrap may use.
 */
export function buildMerchantSignupMetadata(
  input: MerchantSignupMetadataInput,
): Record<string, unknown> {
  const orgLabel = String(input.organizationName ?? "").trim();
  const shopLabel = String(input.shopDisplayName ?? "").trim() || orgLabel;
  const meta: Record<string, unknown> = {
    business_name: orgLabel,
    organization_name: orgLabel,
    shop_display_name: shopLabel,
    pos_role: "owner",
  };
  if (input.businessType) meta.business_type = input.businessType;
  if (input.fullName?.trim()) {
    meta.full_name = input.fullName.trim();
    /**
     * `/register` asks for the person's name in a field they fill in themselves, so a name written
     * here is ALREADY the person's own choice — the same thing the Google review step exists to
     * obtain. Marking it confirmed there means the email/password flow keeps its current behaviour
     * exactly (no new screen, no re-asking) while still giving every merchant path a confirmed name
     * for the provisioning RPCs to carry into `profiles.full_name`.
     *
     * Both keys are written, exactly as `confirmWakaName` writes them for the Google path.
     * `waka_full_name` is the copy a provider can never touch: `full_name` is needed too, because
     * every existing reader still looks at it, but it is the former that `nameReview` treats as
     * authoritative. Writing only the marker would leave nothing confirmed to read, and the
     * bootstrap would then provision this merchant with no name at all.
     */
    meta.waka_full_name = input.fullName.trim();
    meta.waka_name_confirmed_at = new Date().toISOString();
  }
  if (input.phoneE164) meta.phone_e164 = input.phoneE164;
  if (input.districtId?.trim()) meta.district_id = input.districtId.trim();
  if (input.gpsSkipped) meta.gps_skipped = true;
  const dc = String(input.defaultCurrency ?? "").trim().toUpperCase();
  if (dc.length === 3) meta.default_currency = dc;
  if (
    input.latitude != null &&
    input.longitude != null &&
    !Number.isNaN(input.latitude) &&
    !Number.isNaN(input.longitude)
  ) {
    meta.latitude = input.latitude;
    meta.longitude = input.longitude;
  }
  const refCode = String(input.referralCode ?? "").trim().toUpperCase();
  if (refCode.length >= 3) meta.referral_code = refCode;
  return meta;
}
