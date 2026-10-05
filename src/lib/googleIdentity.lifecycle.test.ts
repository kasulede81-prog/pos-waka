import { describe, expect, it, vi } from "vitest";
import {
  GOOGLE_SIGN_IN_IN_PROGRESS,
  createGoogleSignInCoordinator,
  scheduleGooglePopupClick,
  sha256Hex,
  type GoogleSignInRuntime,
} from "./googleIdentity";

/**
 * The G2 lifecycle contract for the shared GIS client.
 *
 * WHY THESE ARE BEHAVIOURAL AND NOT SOURCE ASSERTIONS. Every defect they cover was invisible to a
 * source-text test. An `if (pendingSignIn) throw` guard reads as correct until you notice an `await`
 * sits between it and the assignment; a `pendingSignIn.reject(...)` inside a timeout reads as
 * correct until you notice it rejects whatever is in the slot WHEN THE TIMER FIRES rather than the
 * attempt that armed it. Both are timing bugs, so these tests drive the real coordinator through
 * real interleavings and assert on what each caller actually receives.
 *
 * The GIS surface, the script loader, the timers and the popup are injected; the code under test is
 * the production coordinator, unmodified. A credential can only ever arrive through the callback the
 * coordinator installed into `initialize`, so capturing that callback is how these tests play GIS.
 */

type Initialization = Record<string, unknown>;
type CredentialCallback = (response: { credential?: string; select_by?: string }) => void;

/** Resolves after the microtask AND task queues drain, so WebCrypto work completes too. */
async function settleTasks(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

async function flushUntil(predicate: () => boolean): Promise<void> {
  for (let i = 0; i < 100 && !predicate(); i += 1) await settleTasks();
  if (!predicate()) throw new Error("test setup: condition was never reached");
}

/** An attempt promise plus a way to ask whether it has already settled. */
function tracked<T>(promise: Promise<T>): { promise: Promise<T>; isSettled: () => boolean } {
  let settled = false;
  const wrapped = promise.then(
    (value) => {
      settled = true;
      return value;
    },
    (error) => {
      settled = true;
      throw error;
    },
  );
  // Attempts a test deliberately abandons must not surface as unhandled rejections.
  wrapped.catch(() => {});
  return { promise: wrapped, isSettled: () => settled };
}

/**
 * A runtime whose timers the test fires by hand, so timeouts are deterministic and never flaky.
 * `armedTimers()` exposes the raw handlers so a test can replay a timer that SHOULD have been
 * cleared — which is how the stale-timeout regression is pinned.
 */
function harness() {
  const initializations: Initialization[] = [];
  const cancel = vi.fn();
  const disableAutoSelect = vi.fn();
  const timers = new Map<number, () => void>();
  let nextTimerId = 1;

  const googleId = {
    initialize: (config: Initialization) => {
      initializations.push(config);
    },
    renderButton: vi.fn(),
    cancel,
    disableAutoSelect,
  };

  const runtime: GoogleSignInRuntime = {
    getGoogleId: () => googleId,
    loadScript: async () => {},
    setTimeout: (handler) => {
      const id = nextTimerId++;
      timers.set(id, handler);
      return id;
    },
    clearTimeout: (id) => {
      timers.delete(id);
    },
    clickGoogleButton: async () => {},
  };

  const coordinator = createGoogleSignInCoordinator(runtime);

  /**
   * Starts an attempt and waits until it has installed its GIS configuration. Kept as two helpers
   * rather than one with a flag so each keeps its precise result type — the nonce-bound attempt
   * returns a nonce and the nonce-free one does not, which is part of what these tests assert.
   */
  async function starting<T>(make: () => Promise<T>) {
    const before = initializations.length;
    const attempt = tracked(make());
    await flushUntil(() => initializations.length > before);
    return attempt;
  }

  return {
    coordinator,
    initializations,
    cancel,
    disableAutoSelect,
    startNonceFree: (clientId = "client-a.apps.googleusercontent.com") =>
      starting(() => coordinator.runNonceFreeAttempt(clientId)),
    startNonceBound: (clientId = "client-a.apps.googleusercontent.com") =>
      starting(() => coordinator.runNonceBoundAttempt(clientId)),
    /** Start both in the same tick, with no flush between — a rapid double-click. */
    startBothInSameTick: (clientId = "client-a.apps.googleusercontent.com") => ({
      first: tracked(coordinator.runNonceFreeAttempt(clientId)),
      second: tracked(coordinator.runNonceFreeAttempt(clientId)),
    }),
    /** The GIS callback installed by the initialization at `index`. */
    callback: (index: number): CredentialCallback => initializations[index]!.callback as CredentialCallback,
    armedTimers: () => [...timers.values()],
    fireTimeout: () => {
      const pending = [...timers.values()];
      timers.clear();
      pending.forEach((handler) => handler());
    },
    pendingTimers: () => timers.size,
  };
}

describe("G2 — one attempt, one caller", () => {
  it("resolves a normal Google sign-in with the credential from its own popup", async () => {
    const h = harness();

    const attempt = await h.startNonceFree();
    h.callback(0)({ credential: "id.token.a", select_by: "btn" });

    await expect(attempt.promise).resolves.toEqual({ idToken: "id.token.a" });
    expect(h.coordinator.isInProgress()).toBe(false);
  });

  it("rejects a cancellation and clears the attempt so a later sign-in works", async () => {
    const h = harness();

    const attempt = await h.startNonceFree();
    h.callback(0)({}); // GIS delivers no credential: the person dismissed the popup.

    await expect(attempt.promise).rejects.toThrow("Google sign-in was cancelled.");
    expect(h.coordinator.isInProgress()).toBe(false);
    expect(h.pendingTimers()).toBe(0);
    expect(h.cancel).toHaveBeenCalled();

    // Retry after a cancellation must work normally.
    const retry = await h.startNonceFree();
    h.callback(1)({ credential: "id.token.retry" });
    await expect(retry.promise).resolves.toEqual({ idToken: "id.token.retry" });
  });

  it("rejects a second simultaneous attempt deterministically, leaving the first intact", async () => {
    const h = harness();

    const first = await h.startNonceFree();

    await expect(h.coordinator.runNonceFreeAttempt("client-b.apps.googleusercontent.com")).rejects.toThrow(
      GOOGLE_SIGN_IN_IN_PROGRESS,
    );

    // …and the first is untouched: still active, still resolvable by its own callback.
    expect(h.coordinator.isInProgress()).toBe(true);
    expect(h.initializations).toHaveLength(1); // the rejected caller never re-initialised GIS
    h.callback(0)({ credential: "id.token.first" });
    await expect(first.promise).resolves.toEqual({ idToken: "id.token.first" });
  });

  it("produces the same deterministic outcome for a rapid double-click", async () => {
    const h = harness();

    // Two clicks in the same tick. The per-button `busy` guards are assumed ABSENT here, because
    // the layer must be safe without every surface remembering to guard.
    const { first, second } = h.startBothInSameTick();
    await flushUntil(() => !second.isSettled());

    await expect(second.promise).rejects.toThrow(GOOGLE_SIGN_IN_IN_PROGRESS);
    expect(h.initializations).toHaveLength(1);

    h.callback(0)({ credential: "id.token.first" });
    await expect(first.promise).resolves.toEqual({ idToken: "id.token.first" });

    // Recoverable: once settled, the next click works.
    const third = await h.startNonceFree();
    h.callback(1)({ credential: "id.token.third" });
    await expect(third.promise).resolves.toEqual({ idToken: "id.token.third" });
  });
});

describe("G2 — callback ownership", () => {
  it("ignores a late callback from a timed-out attempt and never resolves a newer one", async () => {
    const h = harness();

    const stale = await h.startNonceFree("client-a.apps.googleusercontent.com");
    const staleCallback = h.callback(0);

    h.fireTimeout();
    await expect(stale.promise).rejects.toThrow("Google sign-in timed out. Please try again.");

    // A fresh attempt starts on the same coordinator.
    const fresh = await h.startNonceFree("client-b.apps.googleusercontent.com");

    // THE REGRESSION: the abandoned popup finally delivers. It must not resolve the new attempt.
    staleCallback({ credential: "id.token.stale" });
    await settleTasks();
    expect(fresh.isSettled()).toBe(false);
    expect(h.coordinator.isInProgress()).toBe(true);

    // Only the current attempt's own callback settles it.
    h.callback(1)({ credential: "id.token.fresh" });
    await expect(fresh.promise).resolves.toEqual({ idToken: "id.token.fresh" });
  });

  it("ignores a late callback from a cancelled attempt", async () => {
    const h = harness();

    const cancelled = await h.startNonceFree();
    const cancelledCallback = h.callback(0);
    cancelledCallback({}); // the person dismissed the popup
    await expect(cancelled.promise).rejects.toThrow("Google sign-in was cancelled.");

    const next = await h.startNonceFree();
    cancelledCallback({ credential: "id.token.zombie" });
    await settleTasks();
    expect(next.isSettled()).toBe(false);

    h.callback(1)({ credential: "id.token.live" });
    await expect(next.promise).resolves.toEqual({ idToken: "id.token.live" });
  });

  it("gives each surface its own credential and its own configuration", async () => {
    const h = harness();

    // Surface 1 — merchant login.
    const merchant = await h.startNonceFree("merchant.apps.googleusercontent.com");
    h.callback(0)({ credential: "id.token.merchant" });
    await expect(merchant.promise).resolves.toEqual({ idToken: "id.token.merchant" });

    // Surface 2 — owner-delete re-authentication, after the first has settled.
    const ownerReauth = await h.startNonceFree("owner.apps.googleusercontent.com");
    h.callback(1)({ credential: "id.token.owner" });

    await expect(ownerReauth.promise).resolves.toEqual({ idToken: "id.token.owner" });
    expect(h.initializations[0]!.client_id).toBe("merchant.apps.googleusercontent.com");
    expect(h.initializations[1]!.client_id).toBe("owner.apps.googleusercontent.com");
  });
});

describe("G2 — timeout and retry", () => {
  it("times out a hung attempt, clears its timer, and lets a fresh attempt succeed", async () => {
    const h = harness();

    const hung = await h.startNonceFree();
    expect(h.pendingTimers()).toBe(1);

    h.fireTimeout();

    await expect(hung.promise).rejects.toThrow("Google sign-in timed out. Please try again.");
    expect(h.coordinator.isInProgress()).toBe(false);
    expect(h.pendingTimers()).toBe(0); // the attempt's own cleanup ran
    expect(h.cancel).toHaveBeenCalled(); // and the popup was closed

    const fresh = await h.startNonceFree();
    h.callback(1)({ credential: "id.token.after-timeout" });
    await expect(fresh.promise).resolves.toEqual({ idToken: "id.token.after-timeout" });
  });

  it("cannot let a settled attempt's timer fire against a newer attempt", async () => {
    const h = harness();

    const first = await h.startNonceFree();
    // Captured BEFORE the attempt settles — this is the handler the old code left armed and able
    // to reject whoever happened to be in the slot when it eventually fired.
    const staleTimer = h.armedTimers()[0]!;

    h.callback(0)({});
    await expect(first.promise).rejects.toThrow("Google sign-in was cancelled.");
    expect(h.pendingTimers()).toBe(0);

    const second = await h.startNonceFree();

    // Replay it: a late timer must not touch the attempt that is live now.
    staleTimer();
    await settleTasks();
    expect(second.isSettled()).toBe(false);
    expect(h.coordinator.isInProgress()).toBe(true);

    h.callback(1)({ credential: "id.token.second" });
    await expect(second.promise).resolves.toEqual({ idToken: "id.token.second" });
  });

  it("releases the slot when the popup cannot even be opened", async () => {
    const coordinator = createGoogleSignInCoordinator({
      getGoogleId: () => ({
        initialize: () => {},
        renderButton: () => {},
        cancel: () => {},
        disableAutoSelect: () => {},
      }),
      loadScript: async () => {},
      setTimeout: () => 1,
      clearTimeout: () => {},
      clickGoogleButton: async () => {
        throw new Error("Google Sign-In could not start. Allow pop-ups for this site and try again.");
      },
    });

    await expect(coordinator.runNonceFreeAttempt("client.apps.googleusercontent.com")).rejects.toThrow(
      "could not start",
    );
    // A failed open must not wedge the module into "already in progress" forever.
    expect(coordinator.isInProgress()).toBe(false);
  });

  it("rejects when GIS is not on the page, without claiming the slot", async () => {
    const coordinator = createGoogleSignInCoordinator({
      getGoogleId: () => null,
      loadScript: async () => {},
      setTimeout: () => 1,
      clearTimeout: () => {},
      clickGoogleButton: async () => {},
    });

    await expect(coordinator.runNonceFreeAttempt("client.apps.googleusercontent.com")).rejects.toThrow(
      "Google Sign-In is not available on this device.",
    );
    expect(coordinator.isInProgress()).toBe(false);
  });

  it("propagates a script-load failure", async () => {
    const coordinator = createGoogleSignInCoordinator({
      getGoogleId: () => null,
      loadScript: async () => {
        throw new Error("Failed to load Google Sign-In. Check your connection.");
      },
      setTimeout: () => 1,
      clearTimeout: () => {},
      clickGoogleButton: async () => {},
    });

    await expect(coordinator.runNonceFreeAttempt("client.apps.googleusercontent.com")).rejects.toThrow(
      "Failed to load Google Sign-In",
    );
  });
});

describe("G2 — nonce isolation", () => {
  it("configures Google with the hashed nonce and returns the raw one", async () => {
    const h = harness();

    const attempt = await h.startNonceBound();
    const config = h.initializations[0]!;
    const gisNonce = config.nonce as string;
    expect(typeof gisNonce).toBe("string");

    h.callback(0)({ credential: "id.token.nonce" });
    const result = await attempt.promise;

    expect(result.idToken).toBe("id.token.nonce");
    // Google embedded the hash of the value Supabase will be handed.
    expect(gisNonce).toBe(await sha256Hex(result.nonce));
    expect(result.nonce).not.toBe(gisNonce);
  });

  it("does not carry a nonce into a later nonce-free attempt", async () => {
    const h = harness();

    // Staff invitation flow first…
    const nonceAttempt = await h.startNonceBound();
    expect(h.initializations[0]!.nonce).toBeTypeOf("string");
    h.callback(0)({ credential: "id.token.nonce" });
    await nonceAttempt.promise;

    // …then ordinary merchant sign-in on the same shared client.
    const plain = await h.startNonceFree();
    expect("nonce" in h.initializations[1]!).toBe(false);

    h.callback(1)({ credential: "id.token.plain" });
    await expect(plain.promise).resolves.toEqual({ idToken: "id.token.plain" });
  });

  it("does not carry a nonce into a nonce-free attempt after a CANCELLED nonce attempt", async () => {
    const h = harness();

    // The poisoned-configuration case: the nonce attempt never completes normally, so a restore
    // step that only ran on the success path would leave the nonce installed for everyone after.
    const cancelled = await h.startNonceBound();
    h.callback(0)({});
    await expect(cancelled.promise).rejects.toThrow("Google sign-in was cancelled.");

    const plain = await h.startNonceFree();
    expect("nonce" in h.initializations[1]!).toBe(false);

    h.callback(1)({ credential: "id.token.plain" });
    await expect(plain.promise).resolves.toEqual({ idToken: "id.token.plain" });
  });

  it("does not carry a nonce-free configuration into a later nonce attempt", async () => {
    const h = harness();

    const plain = await h.startNonceFree();
    h.callback(0)({ credential: "id.token.plain" });
    await expect(plain.promise).resolves.toEqual({ idToken: "id.token.plain" });
    expect("nonce" in h.initializations[0]!).toBe(false);

    // The staff invitation flow after a normal sign-in must still receive its nonce.
    const nonceAttempt = await h.startNonceBound();
    const config = h.initializations[1]!;
    expect(config.nonce).toBeTypeOf("string");

    h.callback(1)({ credential: "id.token.nonce" });
    const result = await nonceAttempt.promise;
    expect(config.nonce).toBe(await sha256Hex(result.nonce));
  });

  it("starts exactly one of a nonce and a nonce-free attempt begun in the same tick", async () => {
    const h = harness();

    /**
     * THE ORIGINAL RACE, replayed. Both surfaces are clicked before either has finished starting.
     * The old check-then-act let BOTH through — the nonce path awaited its SHA-256 between the
     * `if (pendingSignIn) throw` guard and the assignment — so the second overwrote the first's
     * pending request: the first caller's promise was left permanently unresolved, GIS ended up
     * holding whichever configuration was installed last, and a credential could land on the wrong
     * caller. Whichever attempt loses now must be refused cleanly, and the winner must keep its own
     * configuration.
     */
    const nonceAttempt = tracked(h.coordinator.runNonceBoundAttempt("client.apps.googleusercontent.com"));
    const plainAttempt = tracked(h.coordinator.runNonceFreeAttempt("client.apps.googleusercontent.com"));

    await flushUntil(() => nonceAttempt.isSettled() || plainAttempt.isSettled());
    await flushUntil(() => h.initializations.length === 1);

    const nonceWon = !nonceAttempt.isSettled();
    expect(nonceWon !== !plainAttempt.isSettled()).toBe(true); // exactly one was refused

    if (nonceWon) {
      await expect(plainAttempt.promise).rejects.toThrow(GOOGLE_SIGN_IN_IN_PROGRESS);
    } else {
      await expect(nonceAttempt.promise).rejects.toThrow(GOOGLE_SIGN_IN_IN_PROGRESS);
    }

    // GIS holds the winner's configuration only — never a blend of the two.
    const config = h.initializations[0]!;
    expect("nonce" in config).toBe(nonceWon);

    h.callback(0)({ credential: "id.token.winner" });
    if (nonceWon) {
      const result = await nonceAttempt.promise;
      expect(result.idToken).toBe("id.token.winner");
      expect(config.nonce).toBe(await sha256Hex(result.nonce));
    } else {
      await expect(plainAttempt.promise).resolves.toEqual({ idToken: "id.token.winner" });
    }
  });

  it("rejects a concurrent nonce attempt instead of contaminating the live nonce-free one", async () => {
    const h = harness();

    const plain = await h.startNonceFree();
    expect("nonce" in h.initializations[0]!).toBe(false);

    // A staff-invitation attempt arrives while the merchant popup is open. It must be rejected —
    // not allowed to re-initialise GIS with a nonce underneath the open popup.
    await expect(h.coordinator.runNonceBoundAttempt("client.apps.googleusercontent.com")).rejects.toThrow(
      GOOGLE_SIGN_IN_IN_PROGRESS,
    );

    expect(h.initializations).toHaveLength(1);
    expect("nonce" in h.initializations[0]!).toBe(false);

    h.callback(0)({ credential: "id.token.plain" });
    await expect(plain.promise).resolves.toEqual({ idToken: "id.token.plain" });
  });
});

describe("G2 — popup click scheduling", () => {
  /**
   * The popup click is issued on an animation frame, and `requestAnimationFrame` is PAUSED while
   * the document is hidden. That makes the gap between "click requested" and "click issued"
   * unbounded rather than one frame: tap Google, background the app, and the 120s attempt timeout
   * can fire long before the frame ever runs.
   *
   * These tests drive that exact ordering. The scheduling helper under test is the REAL one — only
   * the frame source is injected, so a paused frame is a queued callback the test fires by hand.
   */
  function frames() {
    const queued = new Map<number, () => void>();
    const cancelled: number[] = [];
    let nextId = 1;
    return {
      requestFrame: (callback: () => void) => {
        const id = nextId++;
        queued.set(id, callback);
        return id;
      },
      cancelFrame: (id: number) => {
        cancelled.push(id);
        queued.delete(id);
      },
      /** Hands back the queued callbacks, so a test can fire one that should never run. */
      takeQueued: () => {
        const callbacks = [...queued.values()];
        queued.clear();
        return callbacks;
      },
      queued: () => queued.size,
      cancelled,
    };
  }

  function clickHarness() {
    const initializations: Initialization[] = [];
    const clicks: string[] = [];
    const frame = frames();
    const timers = new Map<number, () => void>();
    let nextTimerId = 1;

    const googleId = {
      initialize: (config: Initialization) => initializations.push(config),
      renderButton: vi.fn(),
      cancel: vi.fn(),
      disableAutoSelect: vi.fn(),
    };

    const coordinator = createGoogleSignInCoordinator({
      getGoogleId: () => googleId,
      loadScript: async () => {},
      setTimeout: (handler) => {
        const id = nextTimerId++;
        timers.set(id, handler);
        return id;
      },
      clearTimeout: (id) => timers.delete(id),
      clickGoogleButton: (_googleId, scope) =>
        scheduleGooglePopupClick({
          scope,
          requestFrame: frame.requestFrame,
          cancelFrame: frame.cancelFrame,
          click: () => clicks.push("click"),
        }),
    });

    return {
      coordinator,
      initializations,
      clicks,
      frame,
      /** Starts an attempt and waits until it has scheduled its click on a frame. */
      start: async () => {
        const before = initializations.length;
        const attempt = tracked(coordinator.runNonceFreeAttempt("client.apps.googleusercontent.com"));
        await flushUntil(() => initializations.length > before);
        await flushUntil(() => frame.queued() === 1);
        return attempt;
      },
      credentialOf: (index: number) => (initializations[index]!.callback as CredentialCallback),
      fireTimeout: () => {
        const pending = [...timers.values()];
        timers.clear();
        pending.forEach((handler) => handler());
      },
    };
  }

  it("clicks on the next frame while the attempt is live, and a later attempt still works", async () => {
    const h = clickHarness();

    const first = await h.start();
    expect(h.frame.queued()).toBe(1); // 1. the attempt scheduled its frame

    h.frame.takeQueued().forEach((callback) => callback());
    expect(h.clicks).toEqual(["click"]); // the live attempt's popup opens

    h.credentialOf(0)({ credential: "id.token.first" });
    await expect(first.promise).resolves.toEqual({ idToken: "id.token.first" });

    // 7. and the layer is not poisoned by the attempt that just finished.
    const second = await h.start();
    h.frame.takeQueued().forEach((callback) => callback());
    expect(h.clicks).toEqual(["click", "click"]);
    h.credentialOf(1)({ credential: "id.token.second" });
    await expect(second.promise).resolves.toEqual({ idToken: "id.token.second" });
  });

  it("does not click, and reports the timeout, when the timeout settles before the frame runs", async () => {
    const h = clickHarness();

    const attempt = await h.start();
    // 4. captured BEFORE the settle: this is the frame that runs late.
    const staleFrame = h.frame.takeQueued()[0]!;

    h.fireTimeout(); // 2. the timeout wins the race
    await expect(attempt.promise).rejects.toThrow("Google sign-in timed out."); // 3. attempt settled

    // The frame was actively cancelled, so a real browser would never deliver it…
    expect(h.frame.cancelled).toEqual([1]);

    // …and even if it is delivered anyway, it must not open a popup for a settled attempt.
    staleFrame(); // 4. the stale frame fires
    expect(h.clicks).toEqual([]); // 5. no click
    expect(h.coordinator.isInProgress()).toBe(false);
  });

  it("does not click when a CANCELLED attempt's frame runs late", async () => {
    const h = clickHarness();

    const attempt = await h.start();
    const staleFrame = h.frame.takeQueued()[0]!;

    h.credentialOf(0)({}); // the person dismissed the popup
    await expect(attempt.promise).rejects.toThrow("Google sign-in was cancelled.");
    expect(h.frame.cancelled).toEqual([1]);

    staleFrame();
    expect(h.clicks).toEqual([]);
  });

  it("produces no unhandled rejection when the timeout fires while the click is still pending", async () => {
    /**
     * The guarantee is pinned INDEPENDENTLY of the cancel-on-settle path: this click helper never
     * registers a canceller and never settles, so `runAttempt` stays suspended on it and nothing
     * ever attaches the caller's handler to the attempt promise. That is precisely the window in
     * which the timeout rejects, and it must not surface as an unhandled rejection.
     */
    const reported: unknown[] = [];
    const onUnhandled = (reason: unknown) => {
      reported.push(reason);
    };
    process.on("unhandledRejection", onUnhandled);

    try {
      const timers = new Map<number, () => void>();
      let nextTimerId = 1;
      const coordinator = createGoogleSignInCoordinator({
        getGoogleId: () => ({
          initialize: () => {},
          renderButton: () => {},
          cancel: () => {},
          disableAutoSelect: () => {},
        }),
        loadScript: async () => {},
        setTimeout: (handler) => {
          const id = nextTimerId++;
          timers.set(id, handler);
          return id;
        },
        clearTimeout: (id) => timers.delete(id),
        clickGoogleButton: () => new Promise<void>(() => {}), // never settles
      });

      // Deliberately not handled here: the module must have marked it handled itself.
      void coordinator.runNonceFreeAttempt("client.apps.googleusercontent.com");

      await flushUntil(() => timers.size === 1);
      [...timers.values()].forEach((handler) => handler());

      // Give the runtime's unhandled-rejection detection room to run.
      await settleTasks();
      await settleTasks();

      expect(reported).toEqual([]);
      expect(coordinator.isInProgress()).toBe(false);
    } finally {
      process.off("unhandledRejection", onUnhandled);
    }
  });
});
