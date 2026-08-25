import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { t } from "./i18n";

const ROOT = process.cwd();
const APP = readFileSync(resolve(ROOT, "src/App.tsx"), "utf8");
const LAYOUT = readFileSync(resolve(ROOT, "src/pages/StaffCenterLayout.tsx"), "utf8");
const HUB = readFileSync(resolve(ROOT, "src/pages/SettingsHubPage.tsx"), "utf8");
const OFFICE = readFileSync(resolve(ROOT, "src/components/office/OfficeHubSectionBody.tsx"), "utf8");

describe("Staff Phase 4 Staff Center UX", () => {
  it("routes Staff Center with Team / Roles / Activity / Security", () => {
    expect(APP).toMatch(/path="staff-center"/);
    expect(APP).toMatch(/path="team"/);
    expect(APP).toMatch(/path="roles"/);
    expect(APP).toMatch(/path="activity"/);
    expect(APP).toMatch(/path="security"/);
    expect(APP).toMatch(/StaffCenterLayout/);
    expect(APP).toMatch(/StaffCenterActivityPage/);
  });

  it("keeps legacy URLs via redirects", () => {
    expect(APP).toContain('path="staff-access"');
    expect(APP).toContain('to="/staff-center/team"');
    expect(APP).toContain('path="settings/staff-roles"');
    expect(APP).toContain('to="/staff-center/roles"');
    expect(APP).toContain('path="settings/staff-security"');
    expect(APP).toContain('to="/staff-center/security"');
  });

  it("nav entry points to Staff Center with owner language", () => {
    expect(HUB).toMatch(/to="\/staff-center"/);
    expect(OFFICE).toMatch(/to="\/staff-center"/);
    expect(t("en", "staffCenterTitle")).toBe("Staff Center");
    expect(t("en", "officeCardStaffAccess")).toBe("Staff Center");
    expect(LAYOUT).toMatch(/staffCenterTabTeam/);
    expect(LAYOUT).not.toMatch(/SessionActor|Path L|Path S|authRole/);
  });

  it("reuses embedded Team / Roles / Security pages", () => {
    expect(APP).toMatch(/StaffAccessPage lang=\{lang\} embedded/);
    expect(APP).toMatch(/SettingsStaffRolesPage lang=\{lang\} embedded/);
    expect(APP).toMatch(/SettingsStaffSecurityPage lang=\{lang\} embedded/);
  });
});
