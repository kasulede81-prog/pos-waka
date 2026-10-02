/**
 * The DKASU name — what a person is called INSIDE DKASU — as distinct from what Google says they are
 * called.
 *
 * WHY THIS IS ITS OWN MODULE. Google's name is a suggestion from an external identity provider.
 * DKASU's name is a thing the person chose. The codebase used to treat them as the same string:
 * `user_metadata.full_name` was read straight into `profiles.full_name` at provisioning, and the
 * UI displayed it directly. Two consequences, both verified against the live RPCs:
 *
 *   * a provider name arriving on a later login REPLACED a name the merchant had already chosen
 *     (`bootstrap_owner_workspace`'s upsert is `coalesce(nullif(trim(p_full_name),''), existing)`,
 *     so any non-empty incoming name wins);
 *   * because the UI read the provider-owned field, a rename at Google changed the displayed name
 *     with no DKASU write at all.
 *
 * THE MARKER AND THE VALUE ARE OURS. `waka_full_name` and `waka_name_confirmed_at` are keys Google
 * (and the auth server's provider sync) will never write. That is the whole point: whether or not
 * Supabase refreshes `full_name`/`name`/`given_name` from the provider on a later sign-in, the
 * confirmed DKASU name cannot be touched by it. This module is the single reader of that pair, so
 * every consumer agrees on what "confirmed" means.
 *
 * NOT A SECURITY BOUNDARY. Metadata is client-writable, and `profiles.full_name` is writable by
 * its owner under RLS. The marker records the person's own decision; it protects nothing from
 * them. `profiles.full_name` remains the canonical value.
 */

/** Our own metadata key holding the confirmed DKASU name. Never written by a provider. */
export const WAKA_FULL_NAME_KEY = "waka_full_name";
/** When the person confirmed it. Its presence is what makes `WAKA_FULL_NAME_KEY` authoritative. */
export const WAKA_NAME_CONFIRMED_AT_KEY = "waka_name_confirmed_at";

/** Matches the owner-name cap the merchant intent form has always enforced. */
export const FULL_NAME_MAX = 120;
/**
 * Longest a single name part may be, DERIVED so two parts plus the space between them still fit
 * `FULL_NAME_MAX`. Rounding the part limit instead would let a valid pair compose to something
 * longer than the cap every downstream writer expects.
 */
export const NAME_PART_MAX = Math.floor((FULL_NAME_MAX - 1) / 2);

export type NameParts = { firstName: string; lastName: string };

/** Trim and collapse internal runs of whitespace, so " John   Smith " and "John Smith" agree. */
export function normalizeNamePart(raw: string | null | undefined): string {
  return String(raw ?? "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Split a provider display name into first/last suggestions.
 *
 * Everything after the first token becomes the family name. A three-part name is far more often
 * "Mary Jane Watson" (given middle surname) or "John van der Berg" than a two-token given name, and
 * keeping the remainder whole means no part of what Google gave us is silently dropped — the
 * person can move anything they disagree with before confirming.
 *
 * A single-word name yields an empty family name rather than guessing; the review step requires it
 * to be filled in.
 */
export function suggestNameParts(providerName: string | null | undefined): NameParts {
  const normalized = normalizeNamePart(providerName);
  if (!normalized) return { firstName: "", lastName: "" };
  const tokens = normalized.split(" ");
  if (tokens.length === 1) return { firstName: tokens[0]!, lastName: "" };
  return { firstName: tokens[0]!, lastName: tokens.slice(1).join(" ") };
}

/** Compose the canonical DKASU name from its parts. */
export function composeFullName(firstName: string, lastName: string): string {
  return normalizeNamePart([normalizeNamePart(firstName), normalizeNamePart(lastName)].filter(Boolean).join(" "));
}

export type NameProblem = {
  field: "firstName" | "lastName";
  /** An i18n key — the caller translates it. */
  messageKey: string;
};

/**
 * What still stops the review from being confirmed, or `null` when it can proceed.
 *
 * Both parts are required, because the split is what the person was asked to check: accepting a
 * blank family name would persist a name they never actually confirmed. Length is capped at the
 * same limit the merchant intent form has always enforced, so nothing downstream can be handed a
 * name longer than the column it lands in expects.
 */
export function namePartsProblem(input: { firstName: string; lastName: string }): NameProblem | null {
  const first = normalizeNamePart(input.firstName);
  const last = normalizeNamePart(input.lastName);
  if (!first) return { field: "firstName", messageKey: "nameReviewFirstNameRequired" };
  if (first.length > NAME_PART_MAX) return { field: "firstName", messageKey: "nameReviewFirstNameTooLong" };
  if (!last) return { field: "lastName", messageKey: "nameReviewLastNameRequired" };
  if (last.length > NAME_PART_MAX) return { field: "lastName", messageKey: "nameReviewLastNameTooLong" };
  return null;
}

/**
 * The confirmed DKASU name, or `null` when this session has none.
 *
 * BOTH keys must be present and non-empty. A marker without a value means we cannot say what was
 * confirmed, and the safe reading of that is "not confirmed" — which re-runs the review rather than
 * silently keeping a provider name.
 */
export function readConfirmedWakaName(
  metadata: Record<string, unknown> | null | undefined,
): string | null {
  const m = metadata ?? {};
  const at = m[WAKA_NAME_CONFIRMED_AT_KEY];
  if (typeof at !== "string" || !at.trim()) return null;
  const name = m[WAKA_FULL_NAME_KEY];
  if (typeof name !== "string") return null;
  const trimmed = normalizeNamePart(name);
  return trimmed ? trimmed.slice(0, FULL_NAME_MAX) : null;
}

/**
 * The best name to SUGGEST in the review, from provider data only.
 *
 * Split claims are preferred when both are present, because they need no guessing; otherwise the
 * display name is split. `given_name`/`family_name` are declared by the auth server's claim struct
 * but are not guaranteed to be populated for every provider or flow, so neither path is assumed.
 */
export function providerNameSuggestion(
  metadata: Record<string, unknown> | null | undefined,
): NameParts {
  const m = metadata ?? {};
  const given = typeof m.given_name === "string" ? normalizeNamePart(m.given_name) : "";
  const family = typeof m.family_name === "string" ? normalizeNamePart(m.family_name) : "";
  // Both split claims present: nothing to guess.
  if (given && family) return { firstName: given, lastName: family };

  const display =
    (typeof m.full_name === "string" && m.full_name) ||
    (typeof m.name === "string" && m.name) ||
    "";
  const split = suggestNameParts(typeof display === "string" ? display : "");

  // A split that found a surname is used whole, so the two parts always share one provenance
  // rather than mixing a provider claim with a guess. A lone `given_name` only wins when the
  // display name has no surname to offer — otherwise it would throw one away.
  if (split.lastName) return split;
  if (given) return { firstName: given, lastName: "" };
  return split;
}

/**
 * What the review screen should start with: the name this account already confirmed if it has one,
 * otherwise the provider's suggestion. Never the other way round — a returning person's own choice
 * is not something a provider gets to overwrite, not even as a prefill.
 */
export function reviewPrefill(metadata: Record<string, unknown> | null | undefined): NameParts {
  const confirmed = readConfirmedWakaName(metadata);
  if (confirmed) return suggestNameParts(confirmed);
  return providerNameSuggestion(metadata);
}

/**
 * Does THIS session have to review its name before it can be given a DKASU identity?
 *
 * A loyalty member is never asked: membership has its own `display_name` and its own registration
 * form, and the member surface must not acquire a merchant step.
 *
 * Anyone who already has a tenancy is never asked either. They have a DKASU identity by
 * construction, and re-asking a working merchant to re-confirm their name on the strength of
 * metadata alone would be exactly the repeated prompt this must not do.
 */
export function needsNameReview(input: {
  kind: "merchant" | "member" | "unknown";
  /** True when the session already belongs to an organization or shop. */
  hasTenancy?: boolean;
  metadata: Record<string, unknown> | null | undefined;
}): boolean {
  if (input.kind === "member") return false;
  if (input.hasTenancy) return false;
  return readConfirmedWakaName(input.metadata) === null;
}

/**
 * The name the provisioning RPCs may write into `profiles.full_name`.
 *
 * THIS IS THE PROVIDER ISOLATION POINT. It returns a name ONLY when the person confirmed one, so a
 * raw Google name can never reach the profile through bootstrap, repair or the bundle self-heal —
 * whether or not the provider refreshes its claims on a later sign-in.
 */
export function provisionableWakaName(
  metadata: Record<string, unknown> | null | undefined,
): string | undefined {
  return readConfirmedWakaName(metadata) ?? undefined;
}

/**
 * The name to DISPLAY for this session. Prefers the confirmed DKASU name, then falls back to the
 * provider's suggestion — a display fallback is harmless for someone who has not confirmed yet, and
 * is never written back anywhere.
 */
export function displayWakaName(
  metadata: Record<string, unknown> | null | undefined,
  fallback?: string | null,
): string | null {
  const confirmed = readConfirmedWakaName(metadata);
  if (confirmed) return confirmed;
  const m = metadata ?? {};
  const provider =
    normalizeNamePart(typeof m.full_name === "string" ? m.full_name : "") ||
    normalizeNamePart(typeof m.name === "string" ? m.name : "");
  return provider || (fallback ? String(fallback).trim() : null) || null;
}
