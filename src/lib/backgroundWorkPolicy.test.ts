import { describe, expect, it, vi } from "vitest";

vi.mock("./internalAdminPreview", () => ({
  isInternalAdminAppPath: (path: string) => path.startsWith("/internal"),
}));

import {
  shouldPausePosBackgroundPull,
  shouldPausePosBackgroundPush,
  shouldPausePosBackgroundWork,
} from "./backgroundWorkPolicy";

describe("backgroundWorkPolicy", () => {
  it("defers cloud pull on POS routes", () => {
    expect(shouldPausePosBackgroundPull("/pos")).toBe(true);
    expect(shouldPausePosBackgroundPull("/pos/checkout")).toBe(true);
    expect(shouldPausePosBackgroundPull("/stock")).toBe(true);
  });

  it("allows cloud pull on settings routes", () => {
    expect(shouldPausePosBackgroundPull("/settings")).toBe(false);
    expect(shouldPausePosBackgroundPull("/settings/backup")).toBe(false);
  });

  it("allows push on POS routes", () => {
    expect(shouldPausePosBackgroundPush("/pos")).toBe(false);
    expect(shouldPausePosBackgroundPush("/stock")).toBe(false);
  });

  it("blocks push on internal admin routes", () => {
    expect(shouldPausePosBackgroundPush("/internal/admin")).toBe(true);
  });

  it("keeps deprecated alias aligned with pull pause", () => {
    expect(shouldPausePosBackgroundWork("/pos")).toBe(shouldPausePosBackgroundPull("/pos"));
  });
});
