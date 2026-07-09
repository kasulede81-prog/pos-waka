import { describe, expect, it } from "vitest";
import { ENTERPRISE_UX_PRIMITIVES } from "./enterpriseUxRules";

describe("enterprise UX foundation", () => {
  it("declares mandatory UX primitives for new pages", () => {
    expect(ENTERPRISE_UX_PRIMITIVES).toContain("EnterprisePageContainer");
    expect(ENTERPRISE_UX_PRIMITIVES).toContain("WakaSwitch");
    expect(ENTERPRISE_UX_PRIMITIVES).toContain("WakaCheckbox");
    expect(ENTERPRISE_UX_PRIMITIVES).toContain("EnterpriseScrollControls");
    expect(ENTERPRISE_UX_PRIMITIVES).toContain("EnterpriseEmptyState");
    expect(ENTERPRISE_UX_PRIMITIVES).toContain("EnterpriseListToolbar");
    expect(ENTERPRISE_UX_PRIMITIVES).toContain("SettingsAutoSaveShell");
  });

  it("includes EnterpriseSaveIndicator in mandatory primitives", () => {
    expect(ENTERPRISE_UX_PRIMITIVES).toContain("EnterpriseSaveIndicator");
    expect(ENTERPRISE_UX_PRIMITIVES).toContain("EnterpriseSkeleton");
    expect(ENTERPRISE_UX_PRIMITIVES).toContain("EnterpriseListFooter");
  });
});
