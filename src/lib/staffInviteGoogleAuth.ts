/**
 * Which Google implementation accepts a staff invitation, per platform.
 *
 * A DISPATCHER — NOT A THIRD IMPLEMENTATION. Both branches are implementations that already
 * ship, and neither is modified here:
 *
 *   web    → Google Identity Services popup + nonce-bound `signInWithIdToken`
 *            (`requestGoogleIdTokenWithNonce` in `googleIdentity.ts`)
 *   native → Supabase OAuth in the system browser, returning through `wakapos://callback`
 *            (`signInWithGoogleNative` in `nativeGoogleAuth.ts`) — the same implementation
 *            merchant sign-in already uses, reused rather than reimplemented.
 *
 * WHY THE SPLIT IS REQUIRED. `nativeGoogleAuth.ts` exists because "GIS popup mode does not work
 * reliably inside the WebView". The invitation page called the GIS popup path unconditionally, so
 * in the Capacitor shell it depended on the one thing that does not work there. Web is unchanged.
 *
 * Dependencies are injected so this branch is unit-testable without a DOM, a device, or a real
 * Google account — the platform decision is the thing being tested, not Google.
 */

export type StaffInviteGoogleSignInDeps = {
  /** `Capacitor.isNativePlatform()` in production; a stub in tests. */
  isNativePlatform: () => boolean;
  /** System-browser OAuth return (`wakapos://callback`). Must be the merchant implementation. */
  signInWithNativeGoogle: () => Promise<void>;
  /** GIS popup + `signInWithIdToken`. Unchanged web behaviour. */
  signInWithWebGoogle: () => Promise<void>;
};

export type StaffInviteGoogleSignInVia = "native" | "web";

export async function signInForStaffInvite(
  deps: StaffInviteGoogleSignInDeps,
): Promise<StaffInviteGoogleSignInVia> {
  if (deps.isNativePlatform()) {
    await deps.signInWithNativeGoogle();
    return "native";
  }
  await deps.signInWithWebGoogle();
  return "web";
}
