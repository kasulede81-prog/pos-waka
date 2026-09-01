import { afterEach, describe, expect, it, vi } from "vitest";
import type { AppReleaseClientPolicy } from "../appReleaseClient";
import { isPlayUpdateAvailable } from "../appReleaseVersion";
import {
  resolveAndroidUpdateDecision,
  resolvePlayUpdateAvailable,
  type AndroidDecisionInput,
  type PlayCheckSnapshot,
} from "./UpdateDecision";
import { markUpdateDismissed, readUpdateDismissed, updateDismissalKey } from "./UpdateDismissal";
import { isUpdateOverlayAllowed, shouldRenderAndroidUpdateOverlay } from "./UpdateInteractiveGate";
import { resolveConnectivity } from "./UpdateNetwork";
import {
  openPlayStoreListingWith,
  PLAY_APPLICATION_ID,
  PLAY_MARKET_URL,
  PLAY_WEB_URL,
} from "./PlayStoreFallback";
import { evaluateAndroidEligibility } from "./UpdateEligibility";
import { resolveVersions } from "./UpdateVersionResolver";
import type { PlatformUpdateContext } from "./UpdatePlatformAdapter";

const prefsStore = new Map<string, string>();

vi.mock("@capacitor/preferences", () => ({
  Preferences: {
    get: async ({ key }: { key: string }) => ({ value: prefsStore.get(key) ?? null }),
    set: async ({ key, value }: { key: string; value: string }) => {
      prefsStore.set(key, value);
    },
    remove: async ({ key }: { key: string }) => {
      prefsStore.delete(key);
    },
  },
}));

vi.mock("@capacitor/core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@capacitor/core")>();
  return {
    ...actual,
    Capacitor: {
      ...actual.Capacitor,
      isNativePlatform: () => false,
      getPlatform: () => "web",
    },
  };
});

const policy: AppReleaseClientPolicy = {
  releaseId: "release-p1",
  versionNumber: "1.0.13",
  releaseName: "P1",
  googlePlayVersionCode: 20,
  minimumSupportedVersion: "1.0.10",
  minimumSupportedVersionCode: 15,
  updateType: "flexible",
  promptUsers: false,
  forceBelowMinimum: true,
  showWhatsNew: false,
  publicNotesHtml: "",
  policyGeneration: 2,
  publishedAt: "2026-08-01T00:00:00.000Z",
};

function play(over: Partial<PlayCheckSnapshot> = {}): PlayCheckSnapshot {
  return {
    updateAvailable: true,
    availableVersionCode: 20,
    installStatus: 0,
    flexibleAllowed: true,
    immediateAllowed: true,
    ...over,
  };
}

function input(over: Partial<AndroidDecisionInput> = {}): AndroidDecisionInput {
  return {
    policy,
    installedVersionCode: 19,
    play: play(),
    offline: false,
    preserveDownloadingPhase: false,
    dismissed: false,
    ignoreDismissal: false,
    whatsNewSeen: true,
    ...over,
  };
}

function androidContext(over: Partial<PlatformUpdateContext> = {}): PlatformUpdateContext {
  const installed = { version: "1.0.12", versionCode: 19 };
  const resolvedPolicy = (over.policy === undefined ? policy : over.policy) as AppReleaseClientPolicy | null;
  return {
    policy: resolvedPolicy,
    versions: resolveVersions(installed, resolvedPolicy),
    reason: "startup",
    offline: false,
    pwaUpdatePending: false,
    preserveDownloadingPhase: false,
    ...over,
  };
}

afterEach(() => {
  prefsStore.clear();
});

describe("ANDROID-UPDATE-P1 T1 newer Play version detected", () => {
  it("availableVersionCode > installedVersionCode is an update even when prompt_users is false", () => {
    const decision = resolveAndroidUpdateDecision(input({ policy: { ...policy, promptUsers: false } }));
    expect(decision.playUpdateAvailable).toBe(true);
    expect(decision.phase).toBe("flexible_prompt");
    expect(decision.severity).toBe("recommended");
    expect(decision.source).toBe("play");
  });
});

describe("ANDROID-UPDATE-P1 T2 same version no prompt", () => {
  it("does not prompt when Play version equals installed version", () => {
    const decision = resolveAndroidUpdateDecision(
      input({
        installedVersionCode: 20,
        play: play({ updateAvailable: false, availableVersionCode: 20 }),
        policy: { ...policy, googlePlayVersionCode: 20 },
      }),
    );
    expect(decision.playUpdateAvailable).toBe(false);
    expect(decision.phase).toBe("no_update");
    expect(decision.severity).toBe("none");
  });
});

describe("ANDROID-UPDATE-P1 T3 policy missing but Play version newer still handled", () => {
  it("does not go idle when policy is null and Play has a newer build", () => {
    const decision = resolveAndroidUpdateDecision(input({ policy: null }));
    expect(decision.phase).toBe("flexible_prompt");
    expect(decision.playUpdateAvailable).toBe(true);
    expect(decision.source).toBe("play");
    expect(decision.reason).toBe("play_update_available_no_policy");
  });

  it("evaluateAndroidEligibility no longer short-circuits to idle without a policy", async () => {
    const result = await evaluateAndroidEligibility(androidContext({ policy: null }), play());
    expect(result.phase).toBe("flexible_prompt");
    expect(result.playAvailableVersionCode).toBe(20);
    expect(result.decision?.source).toBe("play");
  });
});

describe("ANDROID-UPDATE-P1 T4 force update cannot dismiss", () => {
  it("marks immediate / below-minimum as mandatory and not dismissible", () => {
    const immediate = resolveAndroidUpdateDecision(input({ policy: { ...policy, updateType: "immediate" } }));
    expect(immediate.phase).toBe("force_block");
    expect(immediate.severity).toBe("mandatory");
    expect(immediate.dismissible).toBe(false);

    const belowMin = resolveAndroidUpdateDecision(
      input({
        installedVersionCode: 14,
        play: play({ updateAvailable: false, availableVersionCode: 0 }),
      }),
    );
    expect(belowMin.phase).toBe("force_block");
    expect(belowMin.severity).toBe("mandatory");
    expect(belowMin.dismissible).toBe(false);
  });

  it("a persisted dismissal does not hide a mandatory update", () => {
    const decision = resolveAndroidUpdateDecision(
      input({
        policy: { ...policy, updateType: "immediate" },
        dismissed: true,
      }),
    );
    expect(decision.phase).toBe("force_block");
    expect(decision.dismissed).toBe(false);
  });
});

describe("ANDROID-UPDATE-P1 T5 recommended update dismissal persists", () => {
  it("namespaces the key by versionCode (or release id) and remembers the skip", async () => {
    const key = updateDismissalKey({ availableVersionCode: 20, releaseId: "release-p1" });
    expect(key).toBe("waka-update-dismissed-vc-20");
    expect(await readUpdateDismissed(key)).toBe(false);
    expect(await markUpdateDismissed(key)).toBe(true);
    expect(await readUpdateDismissed(key)).toBe(true);

    const decision = resolveAndroidUpdateDecision(input({ dismissed: true }));
    expect(decision.phase).toBe("no_update");
    expect(decision.dismissed).toBe(true);
    expect(decision.playUpdateAvailable).toBe(true);
  });

  it("manual check re-surfaces a dismissed recommended update", () => {
    const decision = resolveAndroidUpdateDecision(input({ dismissed: true, ignoreDismissal: true }));
    expect(decision.phase).toBe("flexible_prompt");
    expect(decision.dismissed).toBe(false);
  });
});

describe("ANDROID-UPDATE-P1 T6 Play Core failure opens fallback", () => {
  it("marks fallbackOnly when Play Core cannot start a detected update", () => {
    const decision = resolveAndroidUpdateDecision(
      input({
        play: play({ checkFailed: true, checkError: "flexible_not_allowed", availableVersionCode: 0, updateAvailable: false }),
      }),
    );
    expect(decision.fallbackOnly).toBe(true);
    expect(decision.playCoreUsable).toBe(false);
    expect(decision.phase).toBe("flexible_prompt");
    expect(decision.source).toBe("policy");
  });

  it("opens market:// then https listing when Play Core cannot start", async () => {
    const market = vi.fn(async () => undefined);
    const web = vi.fn(async () => undefined);
    const android = await openPlayStoreListingWith({ openMarket: market, openWeb: web }, { isAndroid: true });
    expect(android).toEqual({ opened: true, via: "market", error: null });
    expect(market).toHaveBeenCalledWith(PLAY_MARKET_URL);
    expect(web).not.toHaveBeenCalled();

    const marketFail = vi.fn(async () => {
      throw new Error("no_handler");
    });
    const webOk = vi.fn(async () => undefined);
    const recovered = await openPlayStoreListingWith({ openMarket: marketFail, openWeb: webOk }, { isAndroid: true });
    expect(recovered).toEqual({ opened: true, via: "web", error: null });
    expect(webOk).toHaveBeenCalledWith(PLAY_WEB_URL);
    expect(PLAY_APPLICATION_ID).toBe("ug.waka.pos");
    expect(PLAY_MARKET_URL).toBe("market://details?id=ug.waka.pos");
    expect(PLAY_WEB_URL).toBe("https://play.google.com/store/apps/details?id=ug.waka.pos");
  });
});

describe("ANDROID-UPDATE-P1 T7 offline handling", () => {
  it("does not rely only on navigator.onLine — Capacitor Network wins", () => {
    expect(
      resolveConnectivity({ capacitorConnected: false, trackerOnline: true, navigatorOnline: true }),
    ).toEqual({ online: false, source: "capacitor-network" });
    expect(
      resolveConnectivity({ capacitorConnected: null, trackerOnline: false, navigatorOnline: true }),
    ).toEqual({ online: false, source: "device-online-tracker" });
    expect(
      resolveConnectivity({ capacitorConnected: true, trackerOnline: false, navigatorOnline: false }),
    ).toEqual({ online: true, source: "capacitor-network" });
  });

  it("surfaces the offline phase instead of a prompt", () => {
    const decision = resolveAndroidUpdateDecision(input({ offline: true }));
    expect(decision.phase).toBe("offline");
    expect(decision.playUpdateAvailable).toBe(false);
  });
});

describe("ANDROID-UPDATE-P1 T8 startup does not block waiting for update", () => {
  it("hides the overlay until the app is interactive and no startup surface is mounted", () => {
    expect(
      isUpdateOverlayAllowed({ phase: "flexible_prompt", interactive: false, blockingSurfaceMounted: false }),
    ).toBe(false);
    expect(
      isUpdateOverlayAllowed({ phase: "flexible_prompt", interactive: true, blockingSurfaceMounted: true }),
    ).toBe(false);
    expect(
      isUpdateOverlayAllowed({ phase: "flexible_prompt", interactive: true, blockingSurfaceMounted: false }),
    ).toBe(true);
    expect(
      isUpdateOverlayAllowed({ phase: "force_block", interactive: false, blockingSurfaceMounted: false }),
    ).toBe(false);
  });

  it("does not treat overlay gating as an evaluation gate — idle/evaluate stay independent of UI", () => {
    expect(isUpdateOverlayAllowed({ phase: "idle", interactive: true, blockingSurfaceMounted: false })).toBe(false);
  });
});

describe("ANDROID-UPDATE-P1 T9 non-Android does not show Play update", () => {
  it("never renders the Play overlay on web or iOS", () => {
    expect(
      shouldRenderAndroidUpdateOverlay({
        platform: "web",
        overlayReady: true,
        phase: "flexible_prompt",
      }),
    ).toBe(false);
    expect(
      shouldRenderAndroidUpdateOverlay({
        platform: "ios",
        overlayReady: true,
        phase: "force_block",
      }),
    ).toBe(false);
    expect(
      shouldRenderAndroidUpdateOverlay({
        platform: "android",
        overlayReady: true,
        phase: "flexible_prompt",
      }),
    ).toBe(true);
  });
});

describe("ANDROID-UPDATE-P1 T10 versionCode comparison", () => {
  it("compares integer versionCodes, not dotted strings", () => {
    expect(isPlayUpdateAvailable(19, 20)).toBe(true);
    expect(isPlayUpdateAvailable(20, 20)).toBe(false);
    expect(isPlayUpdateAvailable(21, 20)).toBe(false);
    expect(isPlayUpdateAvailable(19, 0)).toBe(false);
    expect(resolvePlayUpdateAvailable(19, { updateAvailable: true, availableVersionCode: 20 })).toBe(true);
    expect(resolvePlayUpdateAvailable(20, { updateAvailable: true, availableVersionCode: 20 })).toBe(false);
    expect(resolvePlayUpdateAvailable(19, { updateAvailable: false, availableVersionCode: 20 })).toBe(true);
  });
});
