/**
 * Google Sign-In via Google Identity Services (GIS) — popup UX only.
 *
 * Flow: custom DKASU button → GIS popup → ID token in JS callback → Supabase signInWithIdToken.
 * Does NOT use signInWithOAuth, redirectTo, or *.supabase.co/auth/v1/callback.
 *
 * Google Cloud (Web client):
 * - Authorized JavaScript origins: https://pos.waka.ug , https://waka.ug , http://localhost:5173
 * - Authorized redirect URIs: NOT required for GIS popup (do not add supabase.co)
 *
 * Supabase → Auth → Google → Authorized Client IDs: same Web Client ID
 *
 * THE LIFECYCLE CONTRACT (G2). GIS is a single shared client on the page: one `initialize`
 * configuration, one popup flow, one callback. Every web surface — merchant and staff sign-in,
 * registration, loyalty, owner-delete re-authentication, staff invitation acceptance — contends for
 * it. `createGoogleSignInCoordinator` is the one place that arbitrates, and it guarantees:
 *
 *   - ONE ATTEMPT AT A TIME. The slot is claimed synchronously; a second attempt is rejected with
 *     `GOOGLE_SIGN_IN_IN_PROGRESS` and leaves no state behind, so it can simply be retried.
 *   - CALLBACK OWNERSHIP. The GIS callback is installed per attempt and carries that attempt's id.
 *     A credential can only settle the attempt whose configuration produced it, so a late callback
 *     from a cancelled or timed-out popup can never resolve a newer request.
 *   - CONFIG SCOPED TO THE ATTEMPT. The nonce is part of one attempt's configuration, never a
 *     mutation of shared state, so nonce and nonce-free flows cannot contaminate each other.
 *   - DETERMINISTIC TEARDOWN. Cancellation, timeout and an unopenable popup all release the slot
 *     and clear the timer, leaving the next sign-in working normally.
 */

import { authDevLog } from "./authConfig";

const GSI_SCRIPT = "https://accounts.google.com/gsi/client";

type GoogleCredentialResponse = {
  credential?: string;
  select_by?: string;
};

type GoogleIdApi = {
  initialize: (config: Record<string, unknown>) => void;
  renderButton: (parent: HTMLElement, options: Record<string, unknown>) => void;
  cancel: () => void;
  disableAutoSelect: () => void;
};

declare global {
  interface Window {
    google?: {
      accounts?: {
        id?: GoogleIdApi;
      };
    };
  }
}

let scriptPromise: Promise<void> | null = null;

/**
 * Backstop for a script load that never settles. Generous on purpose: the GIS script is a small
 * CDN asset (well under a second on a normal connection), so this only ever fires on a genuinely
 * stalled request, and the failure is recoverable — the tag is removed and a retry starts clean.
 */
const GSI_SCRIPT_TIMEOUT_MS = 30_000;

/**
 * Loads the GIS script once, with a RETRYABLE and BOUNDED failure.
 *
 * Three details here are load-bearing (G2):
 *
 *  - The failed `<script>` is REMOVED. Left in the document, the next attempt would adopt it and
 *    wait on a `load` event that has already fired (or never will), hanging that attempt and every
 *    one after it.
 *  - The memoised promise is CLEARED when it rejects. Held forever, one flaky network moment would
 *    make the Google button permanently dead for the life of the page: every later caller would be
 *    handed the same stored rejection, and nothing else ever resets it.
 *  - The wait is BOUNDED. This runs before the popup — and therefore before the attempt's own
 *    timeout is armed — so a request that neither loads nor errors would otherwise hang every
 *    Google entry point in the app with no way back. A tag already in the document is the case that
 *    needs it most: its `load` may have fired before these listeners were attached, and it will not
 *    fire again.
 */
function loadGoogleScript(): Promise<void> {
  if (typeof window === "undefined") {
    return Promise.reject(new Error("Google Sign-In is only available in the browser."));
  }
  if (window.google?.accounts?.id) return Promise.resolve();
  if (scriptPromise) return scriptPromise;

  const pending = new Promise<void>((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(`script[src="${GSI_SCRIPT}"]`);
    const script = existing ?? document.createElement("script");
    let timer: number | null = null;

    const succeed = () => {
      if (timer !== null) window.clearTimeout(timer);
      resolve();
    };
    const fail = (message: string) => {
      if (timer !== null) window.clearTimeout(timer);
      script.remove();
      reject(new Error(message));
    };

    script.addEventListener("load", succeed, { once: true });
    script.addEventListener("error", () => fail("Failed to load Google Sign-In. Check your connection."), { once: true });
    timer = window.setTimeout(
      () => fail("Timed out loading Google Sign-In. Check your connection."),
      GSI_SCRIPT_TIMEOUT_MS,
    );

    if (!existing) {
      script.src = GSI_SCRIPT;
      script.async = true;
      script.defer = true;
      document.head.appendChild(script);
    }
  });

  scriptPromise = pending.catch((err: unknown) => {
    scriptPromise = null;
    throw err;
  });
  return scriptPromise;
}

export function getGoogleOAuthClientId(): string | null {
  const id = import.meta.env.VITE_GOOGLE_OAUTH_CLIENT_ID?.trim();
  return id || null;
}

export function requireGoogleOAuthClientId(): string {
  const id = getGoogleOAuthClientId();
  if (!id) {
    throw new Error(
      "Google sign-in is not configured. Set VITE_GOOGLE_OAUTH_CLIENT_ID (Web client ID from Google Cloud).",
    );
  }
  return id;
}

/**
 * GIS initialisation config, built for ONE attempt.
 *
 * `callback` is REQUIRED and is bound to the attempt that is installing this config, so a
 * credential can only ever settle the request that opened the popup that produced it. A shared
 * module-level callback cannot express that: it can only ask "which attempt is current?", which is
 * exactly the question that resolves the wrong caller when a late credential arrives.
 *
 * `nonce` is optional and only supplied by the staff invitation path. It is the value Google
 * embeds verbatim in the ID token's `nonce` claim, so it MUST be the SHA-256 HEX of the raw nonce —
 * never the raw value. Supabase Auth hashes what it is given and compares that to the claim, so
 * handing Google the raw value makes the two sides unmatchable. See `createGoogleNoncePair` for the
 * contract. Absent, the key is not sent at all, which is what keeps the nonce-free config
 * byte-for-byte what every non-staff surface had before.
 */
function gisInitConfig(
  clientId: string,
  callback: (response: GoogleCredentialResponse) => void,
  nonce?: string,
): Record<string, unknown> {
  return {
    client_id: clientId,
    callback,
    ux_mode: "popup",
    auto_select: false,
    cancel_on_tap_outside: true,
    context: "signin",
    itp_support: true,
    ...(nonce ? { nonce } : {}),
  };
}

/**
 * Stand-in callback for `runNonceBoundGooglePopup`, which returns its token from the injected
 * `openPopup` and never consults the config's callback. A GIS config requires one, so this holds
 * the slot — and it reports rather than resolving something arbitrary, so wiring an unbound config
 * to a real GIS client by mistake is visible in the logs instead of silently mis-resolving.
 */
function unboundCredentialCallback(): void {
  authDevLog("error", "Google credential arrived with no attempt bound to it", {});
}

/** Hidden host for GIS renderButton — popup opens on programmatic click. */
let buttonHost: HTMLDivElement | null = null;

function getButtonHost(): HTMLDivElement {
  if (!buttonHost) {
    buttonHost = document.createElement("div");
    buttonHost.setAttribute("aria-hidden", "true");
    buttonHost.style.cssText =
      "position:fixed;width:1px;height:1px;left:-9999px;top:0;overflow:hidden;opacity:0;pointer-events:none";
    document.body.appendChild(buttonHost);
  }
  return buttonHost;
}

/** Cryptographically random hex nonce, bound to a single Google sign-in attempt. */
export function createGoogleAuthNonce(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Lowercase-hex SHA-256 of `value`.
 *
 * This is the transformation Supabase Auth itself applies to the nonce passed to
 * `signInWithIdToken` before comparing it to the `nonce` claim in the ID token:
 * GoTrue computes `fmt.Sprintf("%x", sha256.Sum256([]byte(nonce)))` and requires
 * it to equal the claim. Google embeds the nonce verbatim, so the value given to
 * Google must already be this hash.
 *
 * `crypto.subtle` is only exposed in a secure context, which every real surface
 * is (https://pos.dkasu.com, https://localhost in the Capacitor WebView). A LAN
 * dev origin over plain http is the one case that is not — it gets a clear error
 * rather than a silent `undefined` TypeError.
 */
export async function sha256Hex(value: string): Promise<string> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) {
    throw new Error("Google sign-in requires a secure context (https or localhost).");
  }
  const digest = await subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/**
 * The two forms one Google sign-in attempt needs, generated together so they can
 * never be confused:
 *
 *   rawNonce  → Supabase `signInWithIdToken({ provider: "google", token, nonce })`
 *   gisNonce  → `google.accounts.id.initialize({ …, nonce: gisNonce })`
 *
 * Generated fresh per attempt and never persisted, logged, or stored.
 */
export async function createGoogleNoncePair(): Promise<{ rawNonce: string; gisNonce: string }> {
  const rawNonce = createGoogleAuthNonce();
  const gisNonce = await sha256Hex(rawNonce);
  return { rawNonce, gisNonce };
}

/**
 * One nonce-bound GIS popup sign-in, with the GIS surface injected so the nonce
 * contract can be asserted directly in tests (no DOM, no network).
 *
 * The split is the whole point and is not negotiable:
 *   - Google is initialised with `sha256(rawNonce)` — the value it will embed.
 *   - The caller receives back the RAW nonce, which is the only value Supabase
 *     will accept alongside the token.
 *
 * Returns the ID token and the raw nonce; it does not call Supabase itself.
 */
export async function runNonceBoundGooglePopup(deps: {
  clientId: string;
  googleId: Pick<GoogleIdApi, "initialize" | "disableAutoSelect">;
  openPopup: () => Promise<string>;
}): Promise<{ idToken: string; nonce: string }> {
  const { rawNonce, gisNonce } = await createGoogleNoncePair();

  deps.googleId.initialize(gisInitConfig(deps.clientId, unboundCredentialCallback, gisNonce));
  try {
    deps.googleId.disableAutoSelect();
  } catch {
    /* ignore */
  }

  const idToken = await deps.openPopup();
  return { idToken, nonce: rawNonce };
}

/** The deterministic error a second, concurrent Google attempt is rejected with. */
export const GOOGLE_SIGN_IN_IN_PROGRESS = "Google sign-in is already in progress.";

/**
 * How long one attempt may stay open before it is rejected and torn down.
 *
 * Unchanged from the popup timeout this code already used: a person reading the consent screen on a
 * slow device needs room, and an over-eager timeout would turn a slow network into a failed sign-in.
 */
export const GOOGLE_SIGN_IN_TIMEOUT_MS = 120_000;

type AttemptOutcome = { ok: true; token: string } | { ok: false; error: Error };

/** One in-flight Google popup, owned by exactly one caller. */
type GoogleAttempt = {
  id: number;
  googleId: GoogleIdApi;
  promise: Promise<string>;
  resolve: (token: string) => void;
  reject: (error: Error) => void;
  timeoutId: number | null;
  /**
   * Set by the popup click helper so a settle can abort a click that has NOT happened yet.
   *
   * The click is issued on the next animation frame, and `requestAnimationFrame` is paused while
   * the document is hidden — so the gap between "click requested" and "click issued" is unbounded,
   * not one frame. Without this, an attempt that timed out in a backgrounded tab would still open a
   * popup when the person came back, and the caller would not learn about the timeout until then.
   */
  cancelPendingClick: (() => void) | null;
};

/**
 * The click helper's view of the attempt that asked for the popup.
 *
 * `onSettled` registers the canceller the coordinator runs if the attempt settles before the click
 * is issued; `isLive` is the same question asked at the moment of clicking. Both are needed: the
 * canceller stops the frame (and lets the caller learn the outcome), and `isLive` is the check that
 * makes "never click for a settled attempt" true at the point of clicking.
 */
export type GooglePopupScope = {
  /** False once the attempt has settled — a popup must not be opened for it after that. */
  isLive: () => boolean;
  /** Registers the canceller the coordinator runs when this attempt settles first. */
  onSettled: (cancel: () => void) => void;
};

/** Everything the coordinator touches outside itself. Injected so the lifecycle is testable. */
export type GoogleSignInRuntime = {
  getGoogleId: () => GoogleIdApi | null;
  loadScript: () => Promise<void>;
  setTimeout: (handler: () => void, ms: number) => number;
  clearTimeout: (id: number) => void;
  /** Renders the GIS button and clicks it; rejects when the button cannot be produced. */
  clickGoogleButton: (googleId: GoogleIdApi, scope: GooglePopupScope) => Promise<void>;
};

export type GoogleSignInCoordinator = {
  /** Nonce-free popup — merchant/staff login, registration, loyalty, owner-delete re-auth. */
  runNonceFreeAttempt: (clientId: string) => Promise<{ idToken: string }>;
  /** Nonce-bound popup — the staff invitation flow only. Google gets sha256(raw); the caller gets raw. */
  runNonceBoundAttempt: (clientId: string) => Promise<{ idToken: string; nonce: string }>;
  /** True while an attempt is claimed — i.e. a popup is open or about to be. */
  isInProgress: () => boolean;
};

/**
 * The Google sign-in lifecycle: ONE active attempt, owned by the caller that claimed it.
 *
 * WHY THIS IS A COORDINATOR AND NOT A MODULE-LEVEL `pendingSignIn`. The previous shape kept a single
 * module-global slot holding "the current promise's resolve/reject", and both the GIS callback and
 * the timeout closure acted on whatever was in that slot WHEN THEY FIRED. That is a cross-request
 * resolver: an attempt that timed out could reject a newer attempt's promise, and a late credential
 * from an abandoned popup could resolve a newer attempt with the old token. Nothing in the module
 * could tell the two apart, because the slot carried no identity.
 *
 * Here an attempt is a record with a unique id, and every path that can settle it — the GIS
 * callback, the timeout, a failure while opening the popup — must present that id. Anything
 * presenting an id that is not the active attempt is ignored and logged, never resolved.
 *
 * ONE ATTEMPT AT A TIME IS THE CONTRACT. GIS drives a single popup flow against a single
 * `initialize` configuration, so overlapping attempts cannot both be honoured. The second caller is
 * therefore rejected deterministically with `GOOGLE_SIGN_IN_IN_PROGRESS` rather than queueing,
 * replacing, or racing the first — the first attempt is never disturbed, and the second leaves no
 * state behind, so it can simply be retried once the first settles.
 */
export function createGoogleSignInCoordinator(runtime: GoogleSignInRuntime): GoogleSignInCoordinator {
  let active: GoogleAttempt | null = null;
  let nextAttemptId = 1;

  /**
   * Claim the single attempt slot, SYNCHRONOUSLY.
   *
   * The claim and the install that follows it must not be separated by an `await`. The old
   * check-then-act did exactly that on the nonce path — it awaited the SHA-256 of the nonce between
   * testing `pendingSignIn` and setting it — so a nonce attempt and a non-nonce attempt could both
   * pass the guard and then re-initialise the shared GIS client underneath each other.
   */
  function claimAttempt(googleId: GoogleIdApi): GoogleAttempt {
    if (active) throw new Error(GOOGLE_SIGN_IN_IN_PROGRESS);

    let resolve!: (token: string) => void;
    let reject!: (error: Error) => void;
    // The executor runs synchronously, so both are assigned before `attempt` is returned.
    const promise = new Promise<string>((res, rej) => {
      resolve = res;
      reject = rej;
    });

    /**
     * Marked handled AT CREATION, deliberately. `runAttempt` attaches its real handler only once
     * the popup click has been issued, and a settle — the 120s timeout above all — can land while
     * that is still pending: the click is issued on an animation frame, which is paused while the
     * document is hidden, so the gap is unbounded rather than one frame. Without this, that settle
     * would be reported as an unhandled rejection.
     *
     * This only marks the promise handled. It swallows nothing: `runAttempt` still awaits
     * `promise`, and the rejection still reaches the caller.
     */
    void promise.catch(() => {});

    const attempt: GoogleAttempt = {
      id: nextAttemptId++,
      googleId,
      promise,
      resolve,
      reject,
      timeoutId: null,
      cancelPendingClick: null,
    };
    active = attempt;
    return attempt;
  }

  /**
   * Settle an attempt — but ONLY if it is still the active one.
   *
   * Returns false for anything else, which is what makes a late credential from a cancelled,
   * timed-out or superseded attempt harmless: it is dropped on the floor instead of resolving the
   * request that happens to be waiting now.
   */
  function settleAttempt(attemptId: number, outcome: AttemptOutcome): boolean {
    const attempt = active;
    if (!attempt || attempt.id !== attemptId) {
      authDevLog("log", "Ignored a Google response for a stale attempt", {});
      return false;
    }

    if (attempt.timeoutId !== null) {
      runtime.clearTimeout(attempt.timeoutId);
      attempt.timeoutId = null;
    }
    // Released BEFORE settling: the slot is free the moment the outcome is decided, so a caller
    // that retries from its own rejection handler finds a clean slot rather than its own corpse.
    active = null;

    /**
     * Drop a click that has not been issued yet.
     *
     * The attempt is over, so opening its popup now would belong to nobody — and cancelling also
     * settles the click promise, which is what lets `runAttempt` continue on to this attempt's
     * outcome and hand the timeout to the caller immediately instead of whenever the person
     * happens to return to the tab.
     */
    const cancelClick = attempt.cancelPendingClick;
    attempt.cancelPendingClick = null;
    cancelClick?.();

    if (outcome.ok) {
      attempt.resolve(outcome.token);
      return true;
    }
    try {
      // Closes the popup so it cannot deliver a credential into whatever attempt comes next.
      attempt.googleId.cancel();
    } catch {
      /* ignore */
    }
    attempt.reject(outcome.error);
    return true;
  }

  /**
   * The GIS credential callback, bound per attempt through `gisInitConfig`.
   *
   * `attemptId` is captured by the closure that was installed alongside THAT attempt's
   * configuration, so this can only ever settle the attempt that opened the popup — never whichever
   * attempt happens to be current when the credential lands.
   */
  function handleCredentialResponse(attemptId: number, response: GoogleCredentialResponse | undefined): boolean {
    if (!response?.credential) {
      return settleAttempt(attemptId, { ok: false, error: new Error("Google sign-in was cancelled.") });
    }
    authDevLog("log", "Google ID token received (GIS popup)", { select_by: response.select_by });
    return settleAttempt(attemptId, { ok: true, token: response.credential });
  }

  async function runAttempt(clientId: string, bindNonce: boolean): Promise<{ idToken: string; nonce: string | null }> {
    // Both of these can await; neither touches the shared slot, so the claim below stays atomic.
    await runtime.loadScript();
    const noncePair = bindNonce ? await createGoogleNoncePair() : null;

    const googleId = runtime.getGoogleId();
    if (!googleId) throw new Error("Google Sign-In is not available on this device.");

    const attempt = claimAttempt(googleId);

    attempt.timeoutId = runtime.setTimeout(() => {
      settleAttempt(attempt.id, { ok: false, error: new Error("Google sign-in timed out. Please try again.") });
    }, GOOGLE_SIGN_IN_TIMEOUT_MS);

    try {
      /**
       * THE CONFIGURATION IS SCOPED TO THIS ATTEMPT.
       *
       * The slot is already claimed, so no other caller can reach `initialize` before this attempt
       * settles — and because the config is installed fresh for every attempt, nothing is inferred
       * from a mutable global. A nonce attempt cannot inherit a nonce-free configuration and a
       * nonce-free attempt cannot inherit a nonce one, whether they overlap or merely follow one
       * another. That is what replaced the old `initializedClientId` cache and the `initializedClientId
       * = null` poison the nonce path used to write.
       */
      googleId.initialize(
        gisInitConfig(clientId, (response) => {
          handleCredentialResponse(attempt.id, response);
        }, noncePair?.gisNonce),
      );
      try {
        googleId.disableAutoSelect();
      } catch {
        /* ignore */
      }
      authDevLog("log", "GIS initialized (popup mode)", { clientId: `${clientId.slice(0, 12)}…` });

      await runtime.clickGoogleButton(googleId, {
        isLive: () => active?.id === attempt.id,
        onSettled: (cancel) => {
          if (active?.id === attempt.id) attempt.cancelPendingClick = cancel;
          // Already settled before the click could register itself: never leave it armed.
          else cancel();
        },
      });
    } catch (err) {
      // A failure to even open the popup must settle this attempt, not leave it claimed: an
      // un-settled claim would reject every later Google sign-in with "already in progress".
      settleAttempt(attempt.id, { ok: false, error: err instanceof Error ? err : new Error(String(err)) });
    }

    const idToken = await attempt.promise;
    return { idToken, nonce: noncePair?.rawNonce ?? null };
  }

  return {
    runNonceFreeAttempt: async (clientId) => {
      const { idToken } = await runAttempt(clientId, false);
      return { idToken };
    },
    runNonceBoundAttempt: async (clientId) => {
      const { idToken, nonce } = await runAttempt(clientId, true);
      // Unreachable: `bindNonce` always produces a pair. Fails loudly rather than handing Supabase
      // an empty nonce, which would silently disable the replay protection this flow exists for.
      if (nonce === null) throw new Error("Google sign-in did not produce a nonce.");
      return { idToken, nonce };
    },
    isInProgress: () => active !== null,
  };
}

/**
 * Issues `click` on the next animation frame — unless the attempt settles first, in which case the
 * frame is cancelled and the returned promise settles without clicking.
 *
 * WHY THIS IS ITS OWN FUNCTION. `requestAnimationFrame` is paused while the document is hidden, so
 * the gap between asking for the click and issuing it is unbounded: a person who taps Google and
 * immediately backgrounds the app can leave the frame queued past the 120s attempt timeout. Both
 * halves of the fix live here — the frame is actively cancelled on settle, and `isLive` is
 * re-checked at the moment of clicking so a stale frame can never open a popup for an attempt that
 * is already over.
 *
 * The frame source is injected so this exact case — frame scheduled, attempt settles, frame runs
 * late — can be driven directly in tests, without a DOM.
 */
export function scheduleGooglePopupClick(input: {
  scope: GooglePopupScope;
  requestFrame: (callback: () => void) => number;
  cancelFrame: (handle: number) => void;
  click: () => void;
}): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const frame = input.requestFrame(() => {
      try {
        // Normally unreachable — the canceller below stops the frame entirely. It is kept so the
        // guarantee holds even for a settle path that failed to cancel.
        if (input.scope.isLive()) input.click();
        resolve();
      } catch (err) {
        reject(err instanceof Error ? err : new Error(String(err)));
      }
    });

    input.scope.onSettled(() => {
      input.cancelFrame(frame);
      resolve();
    });
  });
}

/** Renders the GIS button into the hidden host and clicks it, which opens the popup. */
function clickGoogleButton(googleId: GoogleIdApi, scope: GooglePopupScope): Promise<void> {
  const host = getButtonHost();
  host.replaceChildren();

  googleId.renderButton(host, {
    type: "standard",
    theme: "outline",
    size: "large",
    text: "signin_with",
    width: 280,
  });

  return scheduleGooglePopupClick({
    scope,
    requestFrame: (callback) => window.requestAnimationFrame(callback),
    cancelFrame: (handle) => window.cancelAnimationFrame(handle),
    click: () => {
      const btn = host.querySelector('[role="button"]') as HTMLElement | null;
      if (!btn) {
        throw new Error("Google Sign-In could not start. Allow pop-ups for this site and try again.");
      }
      authDevLog("log", "Opening Google Sign-In popup");
      btn.click();
    },
  });
}

/**
 * The process-wide coordinator. Every web Google entry point shares it, deliberately: the
 * one-attempt-at-a-time rule is only meaningful if the surfaces contend for the same slot.
 */
const googleSignIn = createGoogleSignInCoordinator({
  getGoogleId: () => window.google?.accounts?.id ?? null,
  loadScript: loadGoogleScript,
  setTimeout: (handler, ms) => window.setTimeout(handler, ms),
  clearTimeout: (id) => window.clearTimeout(id),
  clickGoogleButton,
});

/**
 * Opens the Google Sign-In popup and returns an ID token (JWT) for Supabase signInWithIdToken.
 */
export async function requestGoogleIdToken(clientId?: string): Promise<string> {
  const resolvedClientId = clientId ?? requireGoogleOAuthClientId();
  const { idToken } = await googleSignIn.runNonceFreeAttempt(resolvedClientId);
  return idToken;
}

/**
 * Like requestGoogleIdToken, but binds the returned ID token to a fresh nonce.
 * A replayed or substituted token then fails.
 *
 * THE NONCE CONTRACT. Supabase Auth hashes the nonce it is given (SHA-256,
 * lowercase hex) and compares that to the `nonce` claim inside the ID token.
 * Google embeds whatever value it was initialised with, verbatim. So the two
 * sides receive DIFFERENT forms of the same nonce:
 *
 *   rawNonce                       → supabase.auth.signInWithIdToken({ nonce })
 *   sha256Hex(rawNonce)            → google.accounts.id.initialize({ nonce })
 *
 * Passing the raw value to both — which this function used to do — cannot match
 * under any circumstances: either the hashes differ ("Nonces mismatch"), or, if
 * Google embedded nothing, the grant is rejected because a nonce was supplied
 * for a token that carries none. `createGoogleNoncePair` owns the split.
 *
 * Scoped to the staff invitation flow. The nonce is installed on a configuration
 * private to this attempt, so it cannot leak into a concurrent or later attempt
 * on any other surface, and no restore step is needed when it ends.
 *
 * Neither nonce form is ever logged or persisted.
 */
export async function requestGoogleIdTokenWithNonce(
  clientId?: string,
): Promise<{ idToken: string; nonce: string }> {
  const resolvedClientId = clientId ?? requireGoogleOAuthClientId();
  return googleSignIn.runNonceBoundAttempt(resolvedClientId);
}
