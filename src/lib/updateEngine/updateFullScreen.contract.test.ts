import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Contract tests for the full-screen DKASU POS update surface.
 *
 * This repo has no DOM test project (vitest runs `environment: "node"`), so — like the other UI
 * contracts here — the rendered behaviour is pinned by reading the source and asserting the wiring:
 * which engine calls each button makes, where the Back listener is registered and removed, and what
 * the surface must never do (inject HTML, render on web, show Cancel on a mandatory update).
 *
 * The release-notes parser itself is covered behaviourally in `src/lib/releaseNotes.test.ts`.
 */

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../../..");
const read = (relative: string) => readFileSync(join(ROOT, relative), "utf8");

const provider = read("src/components/app-update/AppReleaseUpdateProvider.tsx");
const fullScreen = read("src/components/app-update/UpdateFullScreen.tsx");
const notes = read("src/components/app-update/ReleaseNotes.tsx");
const fallback = read("src/lib/updateEngine/PlayStoreFallback.ts");

describe("full-screen update surface", () => {
  it("1. is a true full-screen dialog, not a small centred dialog", () => {
    expect(fullScreen).toContain("fixed inset-0 flex flex-col bg-background");
    expect(fullScreen).toContain('role="dialog"');
    expect(fullScreen).toContain('aria-modal="true"');
    expect(fullScreen).toContain("aria-labelledby={labelledBy}");
  });

  it("2. shows the version from the release policy", () => {
    expect(fullScreen).toContain('t(lang, "updateWhatsNewVersion")');
    expect(fullScreen).toContain("versionLabel");
    expect(provider).toContain("policy?.versionNumber");
  });

  it("3. shows the release name when the policy provides one, and omits it otherwise", () => {
    expect(fullScreen).toMatch(/\{releaseName \? \(/);
    expect(provider).toContain("releaseName={policy?.releaseName || null}");
  });

  it("4. renders What's New from the release policy", () => {
    expect(provider).toContain("notesHtml={policy?.publicNotesHtml ?? null}");
    expect(provider).toContain("showNotes={policy ? policy.showWhatsNew !== false : false}");
    expect(fullScreen).toContain("<ReleaseNotes");
  });

  it("5. falls back gracefully when notes are missing or disabled", () => {
    expect(fullScreen).toContain('emptyLabel={t(lang, "updateWhatsNewEmpty")}');
    expect(notes).toContain("if (!hasReleaseNotes(nodes))");
  });

  it("6. the primary button calls the EXISTING engine actions, never a custom redirect", () => {
    expect(provider).toContain("EnterpriseUpdateEngine.startFlexibleUpdate()");
    expect(provider).toContain("EnterpriseUpdateEngine.startImmediateUpdate()");
    expect(provider).toMatch(/onUpdate=\{variant === "mandatory" \? handleImmediateStart : handleFlexibleStart\}/);
    // The Play listing is only ever reached through the engine's fallback entry point.
    expect(provider).toContain("EnterpriseUpdateEngine.openPlayStoreFallback()");
    expect(provider).not.toMatch(/(window\.location|window\.open)\(/);
  });

  it("7. Cancel uses the engine's dismissal, not a second mechanism", () => {
    expect(provider).toContain("EnterpriseUpdateEngine.skipUpdate()");
    expect(provider).not.toMatch(/localStorage\.(setItem|removeItem)\(/);
  });

  it("8. a mandatory update has no Cancel anywhere", () => {
    expect(fullScreen).toMatch(/\{!mandatory && !info && !failure && onCancel \?/);
    expect(provider).toMatch(/onCancel=\{variant === "flexible" \? handleCancel : undefined\}/);
    expect(fullScreen).toContain('t(lang, "updateRequiredWhy")');
  });

  it("12. the primary action cannot be double-fired while busy", () => {
    expect(fullScreen).toContain("disabled={busy}");
    expect(fullScreen).toContain("aria-busy={busy}");
    expect(provider).toMatch(/const handleFlexibleStart = useCallback\(async \(\) => \{\s*setBusy\(true\)/);
  });

  it("13/14. the failure state exposes Retry and the Play Store fallback", () => {
    expect(fullScreen).toContain('t(lang, "updateRetry")');
    expect(fullScreen).toMatch(/failure && onOpenPlayStore/);
    expect(provider).toMatch(/onRetry=\{handleRetry\}/);
    expect(provider).toContain("EnterpriseUpdateEngine.checkForUpdates()");
  });

  it("15. release notes are never injected as HTML", () => {
    for (const source of [provider, fullScreen, notes]) {
      expect(source).not.toContain("dangerouslySetInnerHTML");
    }
    expect(notes).toContain("parseReleaseNotes");
    expect(notes).toContain("node.href ?");
  });

  it("16. the surface is Android-only, matching the engine's platform gate", () => {
    expect(provider).toContain('Capacitor.getPlatform() === "android"');
    expect(provider).toMatch(/const surfaceOpen =\s*isAndroid &&/);
  });

  it("uses one defined layer instead of the old ad-hoc z-index ladder", () => {
    expect(fullScreen).toContain("export const UPDATE_LAYER");
    expect(fullScreen).toContain("z-[210]");
    expect(fullScreen).toContain("z-[205]");
    for (const stale of ["z-[180]", "z-[185]", "z-[186]", "z-[190]", "z-[200]"]) {
      expect(provider).not.toContain(stale);
      expect(fullScreen).not.toContain(stale);
    }
  });
});

describe("Android Back handling", () => {
  it("9. Back on a flexible update behaves exactly like Cancel", () => {
    expect(provider).toContain('App.addListener("backButton"');
    expect(provider).toMatch(/if \(variant === "flexible"\) \{\s*void EnterpriseUpdateEngine\.skipUpdate\(\);/);
  });

  it("10. Back cannot bypass a mandatory update", () => {
    // The handler is the only place Back is handled, and it acts for the flexible variant alone.
    const handler = provider.slice(provider.indexOf('App.addListener("backButton"'), provider.indexOf("}).then("));
    expect(handler).toContain('variant === "flexible"');
    expect(handler.match(/skipUpdate\(\)/g)?.length).toBe(1);
    expect(handler).not.toContain("startImmediateUpdate");
    expect(handler).not.toContain("dismissWhatsNew");
  });

  it("11. the Back listener exists only while a surface is open and is removed with it", () => {
    expect(provider).toMatch(/if \(!isAndroid \|\| !surfaceOpen \|\| variant === null\) return;/);
    expect(provider).toContain("void handle?.remove();");
    expect(provider).toContain("if (disposed) void h.remove();");
    // Registered once for the update surface — no second global navigation listener.
    expect(provider.match(/App\.addListener\(/g)?.length).toBe(1);
  });
});

describe("Play Store identity", () => {
  it("17. the package ID stays ug.waka.pos and is declared once", () => {
    expect(fallback).toContain('export const PLAY_APPLICATION_ID = "ug.waka.pos";');
    expect(fallback).toContain("market://details?id=${PLAY_APPLICATION_ID}");
    expect(fallback).toContain("https://play.google.com/store/apps/details?id=${PLAY_APPLICATION_ID}");
    for (const source of [provider, fullScreen, notes]) {
      expect(source).not.toMatch(/ug\.waka\.pos/);
    }
  });
});
