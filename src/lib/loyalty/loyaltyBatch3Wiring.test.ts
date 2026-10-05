import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Phase 2 Batch 3 wiring — design system, accessibility, touch targets and
 * navigation. Source-level assertions per this repository's test convention.
 */

const hub = readFileSync(join(process.cwd(), "src/pages/LoyaltyHubPage.tsx"), "utf8");
const tabbar = readFileSync(
  join(process.cwd(), "src/components/shared/HorizontalTabBar.tsx"),
  "utf8",
);
const dialog = readFileSync(
  join(process.cwd(), "src/components/layout/ConfirmationDialog.tsx"),
  "utf8",
);
const enroll = readFileSync(
  join(process.cwd(), "src/components/loyalty/LoyaltyEnrollmentPanel.tsx"),
  "utf8",
);

function loyaltyComponents(): string[] {
  return readdirSync("src/components/loyalty")
    .filter((f) => f.endsWith(".tsx"))
    .map((f) => readFileSync(join(process.cwd(), "src/components/loyalty", f), "utf8"));
}

describe("Batch 3 — design system alignment", () => {
  it("hub actions use WakaButton / WakaInput primitives", () => {
    const buttonCount = (hub.match(/<WakaButton[\s>]/g) ?? []).length;
    expect(buttonCount, "hub WakaButton count").toBeGreaterThanOrEqual(10);
    expect(hub).toContain("<WakaInput");
    expect(enroll).toContain("<WakaButton");
    expect(enroll).toContain("<WakaInput");
  });

  it("no new dialog or state primitives were introduced", () => {
    expect(hub).toContain("<ConfirmationDialog"); // Batch 2 dialog, reused
    expect(hub).toContain("<EnterpriseSkeleton");
    expect(hub).toContain("<EnterpriseErrorState");
    expect(hub).toContain("<EnterpriseEmptyState");
  });
});

describe("Batch 3 — accessible names and semantics", () => {
  it("search inputs and adjust inputs carry accessible labels", () => {
    expect(hub).toContain('aria-label={t(lang, "loyaltyMembersSearchLabel")}');
    expect(hub).toContain('aria-label={t(lang, "loyaltyAdjustPointsLabel")}');
    expect(hub).toContain('aria-label={t(lang, "loyaltyAdjustNotePlaceholder")}');
    expect(enroll).toContain('aria-label={t(lang, "loyaltyEnrollSearchLabel")}');
  });

  it("toggle chips expose pressed state", () => {
    expect(hub).toContain("aria-pressed={statusFilter === f}");
    const withPressed = loyaltyComponents().filter((s) => s.includes("aria-pressed="));
    expect(withPressed.length, "components with aria-pressed").toBeGreaterThanOrEqual(3);
  });

  it("section cards use heading elements under the shell h1", () => {
    expect(hub).toContain("<h2");
    expect(hub).toContain("<h3");
    expect(enroll).toContain("<h2");
  });
});

describe("Batch 3 — touch targets", () => {
  it("no sub-44px control heights remain in the Loyalty surface", () => {
    const files = ["src/pages/LoyaltyHubPage.tsx"];
    for (const f of readdirSync("src/components/loyalty")) {
      if (f.endsWith(".tsx")) files.push(`src/components/loyalty/${f}`);
    }
    for (const f of files) {
      const src = readFileSync(join(process.cwd(), f), "utf8");
      for (const px of ["32", "36", "40", "41", "42", "43"]) {
        expect(src, `${f} contains min-h-[${px}px]`).not.toContain(`min-h-[${px}px]`);
      }
    }
  });
});

describe("Batch 3 — navigation accessibility", () => {
  it("tab bar implements the WAI-ARIA tabs pattern", () => {
    expect(tabbar).toContain('role="tablist"');
    expect(tabbar).toContain("aria-selected={active}");
    expect(tabbar).toContain("tabIndex={active ? 0 : -1}"); // roving tabindex
    expect(tabbar).toContain("data-tab={tab.id}"); // focus target for arrows
  });

  it("supports ArrowLeft/ArrowRight/Home/End with focus following selection", () => {
    expect(tabbar).toContain('"ArrowRight"');
    expect(tabbar).toContain('"ArrowLeft"');
    expect(tabbar).toContain('"Home"');
    expect(tabbar).toContain('"End"');
    expect(tabbar).toContain("focusTab(next.id)");
  });

  it("LoyaltyShell still drives URL-backed sections (IA preserved)", () => {
    expect(hub).toContain("resolveLoyaltySection");
    expect(hub).toContain("loyaltySectionPath");
  });
});

describe("Batch 3 — dialog keyboard accessibility (ConfirmationDialog)", () => {
  it("keeps Batch 2 confirmation wiring while adding focus management", () => {
    expect(hub).toContain("<ConfirmationDialog");
    expect(hub).toContain("onConfirm={() => void confirmRedeem()}");
    // Batch 3 additions:
    expect(dialog).toContain('"Escape"'); // Escape closes via onClose (cancel)
    expect(dialog).toContain("closest('[role=\"dialog\"]')"); // trap scoped to the dialog
    expect(dialog).toContain("previous.focus()"); // focus restored on close
    expect(dialog).toContain("bodyRef.current?.focus()"); // initial focus
  });

  it("still renders with the shared ModalSheet portal (no new modal system)", () => {
    expect(dialog).toContain("<ModalSheet");
    expect(dialog).toContain("<WakaButton");
  });
});

describe("Batch 3 — enrollment discoverability (P12)", () => {
  it("member list offers an Enroll CTA that scrolls to the anchored panel", () => {
    expect(hub).toContain("loyaltyEnrollCta");
    expect(hub).toContain("scrollIntoView");
    expect(enroll).toContain('id="loyalty-enroll"'); // anchor lives on the panel
  });
});
