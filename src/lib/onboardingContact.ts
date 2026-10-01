/**
 * The two contact details the business-profile save cannot be completed without, and which field
 * the merchant must be pointed at when one of them is missing.
 *
 * WHY THIS IS ITS OWN MODULE. The wizard's location step used to enforce a phone requirement while
 * rendering no input to satisfy it: a Google sign-up carries no phone in its metadata, so the step
 * resolved "no phone" and reported "enter a valid number" on a screen that had nowhere to type one
 * — with "Skip for now" running the same check and failing the same way. The rule was right and
 * the screen was wrong, and nothing could catch that because the rule lived inside a React
 * closure. It is a pure function here, so what the step accepts and what it complains about can be
 * asserted directly.
 *
 * NOTHING HERE IS AN AUTHORITY. `save_owner_business_profile_bundle` still decides what it will
 * accept: a phone in `+256` form, and a non-null district. This only decides, in advance, whether
 * there is any point asking the server — and, when there is not, which field to mark.
 *
 * The messages are returned as i18n KEYS, never as prose, so this stays pure and the caller
 * renders them in the merchant's own language.
 */

import { normalizeUgPhoneE164 } from "./businessProfile";

export type OnboardingPhoneSources = {
  /** Exactly what is in the phone field right now. */
  typed: string;
  /** What the account arrived with — signup metadata, or the cloud shop row. A seed, not a truth. */
  seeded?: string;
  /** The device's own memory of the shop's number. */
  fromLocalPrefs?: string;
  /** Auth metadata, consulted last: it is the least recent thing we know about this person. */
  fromAuthMetadata?: string;
};

/**
 * The candidates for "this merchant's number", in the order they should be believed.
 *
 * ORDER IS THE POINT. What the merchant just typed is the most recent truth about their number —
 * a value seeded from signup metadata is only what we happened to know before they were asked, and
 * a correction they made by hand must never be silently overruled by it.
 */
export function onboardingPhoneCandidates(input: OnboardingPhoneSources): string[] {
  return [
    input.typed,
    input.seeded ?? "",
    input.fromLocalPrefs ?? "",
    input.fromAuthMetadata ?? "",
  ];
}

/** The first candidate that is a usable Uganda mobile, in canonical `+256…` form. */
export function resolveOnboardingPhone(input: OnboardingPhoneSources): string | null {
  for (const raw of onboardingPhoneCandidates(input)) {
    const normalized = normalizeUgPhoneE164(raw);
    if (normalized) return normalized;
  }
  return null;
}

export type OnboardingContactProblem = {
  /** The field the merchant must be shown the message beside. */
  field: "phone" | "district";
  /** An i18n key — the caller translates it. */
  messageKey: string;
};

/**
 * What still stops this step from saving, or `null` when it can proceed.
 *
 * An empty field and an unusable value get DIFFERENT sentences, because they need different
 * actions from the merchant: one has to supply a number, the other has to correct the one they
 * typed. Both are returned for the phone field specifically, so the message can never appear
 * anywhere but on the control it is about.
 */
export function onboardingContactProblem(input: {
  /** The resolved number, or null when nothing usable was found. */
  phoneE164: string | null;
  /** The raw field contents, so "empty" can be told apart from "wrong". */
  phoneRaw: string;
  districtId: string;
}): OnboardingContactProblem | null {
  if (!input.phoneE164) {
    return {
      field: "phone",
      messageKey: input.phoneRaw.trim() ? "registerPhoneInvalid" : "onboardLocPhoneRequired",
    };
  }
  if (!input.districtId) {
    // Required by the save contract, not by this screen — which is why the step's own wording no
    // longer calls it optional.
    return { field: "district", messageKey: "businessProfileDistrictRequired" };
  }
  return null;
}
