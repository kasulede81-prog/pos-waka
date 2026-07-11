import { describe, expect, it } from "vitest";
import { evaluateAndroidEligibility, evaluateWebEligibility, shouldLogUpdateAvailable } from "./UpdateEligibility";
import { resolveUpdateNotification, shouldShowOverlay } from "./UpdateNotifications";
import { resolveVersions } from "./UpdateVersionResolver";
import type { PlatformUpdateContext } from "./UpdatePlatformAdapter";

const basePolicy = {
  releaseId: "release-1",
  versionNumber: "1.0.12",
  releaseName: "Test",
  googlePlayVersionCode: 17,
  minimumSupportedVersion: "1.0.10",
  minimumSupportedVersionCode: 15,
  updateType: "flexible" as const,
  promptUsers: true,
  forceBelowMinimum: true,
  showWhatsNew: true,
  publicNotesHtml: "<p>Notes</p>",
  policyGeneration: 1,
  publishedAt: "2026-07-01T00:00:00.000Z",
};

function androidContext(overrides: Partial<PlatformUpdateContext> = {}): PlatformUpdateContext {
  const installed = { version: "1.0.11", versionCode: 16 };
  return {
    policy: basePolicy,
    versions: resolveVersions(installed, basePolicy),
    reason: "startup",
    offline: false,
    pwaUpdatePending: false,
    preserveDownloadingPhase: false,
    ...overrides,
  };
}

describe("evaluateAndroidEligibility", () => {
  it("prompts for flexible update when Play has newer build", async () => {
    const result = await evaluateAndroidEligibility(androidContext(), {
      updateAvailable: true,
      availableVersionCode: 17,
      installStatus: 0,
    });
    expect(result.phase).toBe("flexible_prompt");
  });

  it("blocks when below minimum version", async () => {
    const installed = { version: "1.0.9", versionCode: 14 };
    const result = await evaluateAndroidEligibility(
      androidContext({ versions: resolveVersions(installed, basePolicy) }),
      {
        updateAvailable: false,
        availableVersionCode: 0,
        installStatus: 0,
      },
    );
    expect(result.phase).toBe("force_block");
  });

  it("returns offline when device is offline", async () => {
    const result = await evaluateAndroidEligibility(androidContext({ offline: true }), {
      updateAvailable: true,
      availableVersionCode: 18,
      installStatus: 0,
    });
    expect(result.phase).toBe("offline");
  });
});

describe("evaluateWebEligibility", () => {
  it("surfaces pending PWA refresh", () => {
    const result = evaluateWebEligibility(
      androidContext({ policy: null, pwaUpdatePending: true, versions: resolveVersions({ version: "1.0.12", versionCode: 0 }, null) }),
    );
    expect(result.phase).toBe("pwa_update");
  });
});

describe("resolveUpdateNotification", () => {
  it("maps flexible prompt to i18n keys", () => {
    const notification = resolveUpdateNotification("flexible_prompt");
    expect(notification.kind).toBe("flexible_update");
    expect(notification.titleKey).toBe("updateAvailableTitle");
  });

  it("hides idle overlays", () => {
    expect(shouldShowOverlay("idle")).toBe(false);
    expect(shouldShowOverlay("flexible_prompt")).toBe(true);
  });
});

describe("shouldLogUpdateAvailable", () => {
  it("logs once per release", () => {
    expect(shouldLogUpdateAvailable("flexible_prompt", basePolicy, null)).toBe(true);
    expect(shouldLogUpdateAvailable("flexible_prompt", basePolicy, basePolicy.releaseId)).toBe(false);
  });
});
