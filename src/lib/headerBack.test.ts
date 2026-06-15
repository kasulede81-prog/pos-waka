import { describe, expect, it } from "vitest";
import { resolveHeaderBack } from "./headerBack";

describe("resolveHeaderBack", () => {
  it("shows back for nested office routes on desktop", () => {
    const r = resolveHeaderBack("/office/backup", true);
    expect(r.show).toBe(true);
    expect(r.fallback).toBe("/office");
    expect(r.labelKey).toBe("officeBackToHub");
  });

  it("shows back for top-level stock to shop hub on desktop", () => {
    const r = resolveHeaderBack("/stock", true);
    expect(r.show).toBe(true);
    expect(r.fallback).toBe("/office");
  });

  it("hides back on office hub (Exit only)", () => {
    expect(resolveHeaderBack("/office", true).show).toBe(false);
  });

  it("shows back for staff access to settings hub on desktop", () => {
    const r = resolveHeaderBack("/staff-access", true);
    expect(r.show).toBe(true);
    expect(r.fallback).toBe("/settings");
    expect(r.labelKey).toBe("settingsHubTitle");
  });

  it("hides on mobile", () => {
    expect(resolveHeaderBack("/office/backup", false).show).toBe(false);
  });
});
