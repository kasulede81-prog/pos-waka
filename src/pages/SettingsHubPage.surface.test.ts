import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Settings hub vertical-slice reconciliation guards.
 *
 * The Lovable snapshot restructured the hub into groups and added a search
 * filter. Everything else it changed (react-router-dom → routerCompat swap,
 * new hardcoded English strings) is deliberately NOT adopted. These tests pin
 * that boundary down so a later merge cannot silently reintroduce the swap or
 * regress the guards, destinations, or trailing rendering.
 */

const HUB = readFileSync(
  resolve(process.cwd(), "src/pages/SettingsHubPage.tsx"),
  "utf8",
);

const I18N = readFileSync(resolve(process.cwd(), "src/lib/i18n.ts"), "utf8");

describe("SettingsHubPage — routing", () => {
  it("routes through react-router-dom (not the Lovable routerCompat shim)", () => {
    expect(HUB).toMatch(/from "react-router-dom"/);
    expect(HUB).not.toContain("@/lib/routerCompat");
  });
});

describe("SettingsHubPage — guards preserved", () => {
  it.each([
    'searchParams.get("onboard") === "1"',
    'actorHasPermission(actor, "settings.view")',
  ])("keeps guard: %s", (fragment) => {
    expect(HUB).toContain(fragment);
  });

  it.each([
    "canShopProfile",
    "canStaff",
    "canDrawerSettings",
    "canOwnerFinanceDiagnostics",
    "canArrangeShelves",
    "canReceipt",
    "canDevices",
    "canSelling",
    "canPin",
    "canPassword",
    "canBiometric",
    "canHomeMenu",
    "canOfficeMenu",
    "canShelves",
    "canHealth",
    "canDiagnostics",
    "canRetention",
    "pilotActive",
    "showFloorSetup",
    "showPharmacySettings",
    "showHospitalitySettings",
  ])("keeps permission derivation: %s", (name) => {
    expect(HUB).toContain(`const ${name}`);
  });

  it("still uses the exact settingsCapabilityMatrix / actorHasPermission calls", () => {
    expect(HUB).toContain("canAccessSettingsCapability(actor, id, snapshot, authMode)");
    expect(HUB).toContain('actorHasPermission(actor, "shelves.customize")');
    expect(HUB).toContain("canSeeFinanceDiagnostics(authOperatorRole(actor))");
    expect(HUB).toContain("isPilotModeActive(authOperatorRole(actor), preferences)");
  });
});

describe("SettingsHubPage — destinations preserved", () => {
  const REQUIRED_DESTINATIONS = [
    "/settings/shop",
    "/settings/pharmacy",
    "/settings/hospitality",
    "/settings/floor",
    "/settings/selling",
    "/settings/receipt",
    "/settings/cash-drawer",
    "/settings/shelves",
    "/staff-center",
    "/settings/pin",
    "/settings/biometric",
    "/settings/password",
    "/settings/devices",
    "/office/hardware",
    "/office/vision",
    "/settings/appearance",
    "/settings/notifications",
    "/settings/home-menu",
    "/settings/office-menu",
    "/settings/health",
    "/settings/finance-diagnostics",
    "/settings/diagnostics",
    "/settings/retention",
    "/support-center",
    "/pilot-support",
    "/settings/shop?onboard=1",
  ];

  it.each(REQUIRED_DESTINATIONS)("keeps destination: %s", (dest) => {
    expect(HUB).toContain(`"${dest}"`);
  });
});

describe("SettingsHubPage — permission binding on each destination", () => {
  // For destinations behind a permission gate, the reconciliation must still
  // route them through THAT gate (not through 'true' or another permission).
  // This is checked by asserting the item literal carries the expected `show`.
  const REQUIRED_GATES: Array<[string, string]> = [
    ["/settings/shop", "canShopProfile"],
    ["/settings/pharmacy", "showPharmacySettings"],
    ["/settings/hospitality", "showHospitalitySettings"],
    ["/settings/floor", "showFloorSetup"],
    ["/settings/selling", "canSelling"],
    ["/settings/receipt", "canReceipt"],
    ["/settings/cash-drawer", "canDrawerSettings"],
    ["/settings/shelves", "canShelves"],
    ["/staff-center", "canStaff"],
    ["/settings/pin", "canPin"],
    ["/settings/biometric", "canBiometric"],
    ["/settings/password", "canPassword"],
    ["/settings/devices", "canDevices"],
    ["/settings/home-menu", "canHomeMenu"],
    ["/settings/office-menu", "canOfficeMenu"],
    ["/settings/health", "canHealth"],
    ["/settings/finance-diagnostics", "canOwnerFinanceDiagnostics"],
    ["/settings/retention", "canRetention"],
  ];

  it.each(REQUIRED_GATES)("gates %s through %s", (dest, gate) => {
    const re = new RegExp(`\\{[^}]*"${dest.replace(/[/-]/g, "\\$&")}"[^}]*show:\\s*${gate}\\b`);
    expect(HUB).toMatch(re);
  });

  it("/settings/diagnostics is still gated on canDiagnostics AND native platform", () => {
    expect(HUB).toMatch(/show:\s*canDiagnostics && Capacitor\.isNativePlatform\(\)/);
  });
});

describe("SettingsHubPage — trailing render preserved", () => {
  it("keeps the PilotModeToggle behind canTogglePilotMode", () => {
    expect(HUB).toContain("canTogglePilotMode(authOperatorRole(actor))");
    expect(HUB).toContain("<PilotModeToggle lang={lang}");
  });

  it("keeps the /pilot-support tile behind canTogglePilotMode", () => {
    expect(HUB).toMatch(/canTogglePilotMode[\s\S]{0,120}"\/pilot-support"/);
  });

  it("keeps SyncHealthCard and PilotSupportCard behind pilotActive", () => {
    expect(HUB).toContain("pilotActive ? <SyncHealthCard");
    expect(HUB).toContain("pilotActive ? <PilotSupportCard");
  });

  it("keeps the support-center highlight/trailing tied to supportAttentionTotal", () => {
    expect(HUB).toMatch(/highlight:\s*supportAttentionTotal > 0/);
    expect(HUB).toMatch(/trailing:\s*supportAttentionTotal > 0 \? String\(supportAttentionTotal\) : undefined/);
  });
});

describe("SettingsHubPage — search + i18n", () => {
  it("filters items and hides emptied groups", () => {
    expect(HUB).toContain("const needle = query.trim().toLowerCase()");
    expect(HUB).toContain(".filter((group) => group.items.length > 0)");
  });

  it("uses i18n keys for the new group titles and search UI, not hardcoded English", () => {
    for (const k of [
      "settingsHubGroupBusiness",
      "settingsHubGroupPos",
      "settingsHubGroupInventory",
      "settingsHubGroupStaffAccess",
      "settingsHubGroupDevices",
      "settingsHubGroupAppearance",
      "settingsHubGroupSystemData",
      "settingsHubSearchPlaceholder",
      "settingsHubSearchNoMatch",
    ]) {
      expect(HUB).toContain(k);
      expect(I18N).toContain(`${k}:`);
    }
    // No stray English fragment from the snapshot's version.
    expect(HUB).not.toMatch(/title: "Business"/);
    expect(HUB).not.toMatch(/title: "POS & sales"/);
    expect(HUB).not.toContain('placeholder="Search settings"');
  });
});
