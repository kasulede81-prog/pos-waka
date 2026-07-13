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
  it("allows cloud pull on POS and stock routes (Phase 24.1B)", () => {
    expect(shouldPausePosBackgroundPull("/pos")).toBe(false);
    expect(shouldPausePosBackgroundPull("/pos/checkout")).toBe(false);
    expect(shouldPausePosBackgroundPull("/stock")).toBe(false);
    expect(shouldPausePosBackgroundPull("/owner")).toBe(false);
  });

  it("allows cloud pull on settings routes", () => {
    expect(shouldPausePosBackgroundPull("/settings")).toBe(false);
    expect(shouldPausePosBackgroundPull("/settings/backup")).toBe(false);
  });

  it("allows push on POS routes", () => {
    expect(shouldPausePosBackgroundPush("/pos")).toBe(false);
    expect(shouldPausePosBackgroundPush("/stock")).toBe(false);
  });

  it("blocks pull and push on internal admin routes", () => {
    expect(shouldPausePosBackgroundPull("/internal/admin")).toBe(true);
    expect(shouldPausePosBackgroundPush("/internal/admin")).toBe(true);
  });

  it("keeps deprecated alias aligned with pull pause", () => {
    expect(shouldPausePosBackgroundWork("/pos")).toBe(shouldPausePosBackgroundPull("/pos"));
  });
});
