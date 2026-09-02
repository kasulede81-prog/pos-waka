import { describe, expect, it } from "vitest";
import { homeWorldHasStage, resolveHomeWorldSurface } from "./homeWorldSurface";

describe("homeWorldSurface", () => {
  it("maps primary modules to stable visual zones without inventing data", () => {
    expect(resolveHomeWorldSurface("cash")).toEqual({ id: "cash", zone: "work", ink: "light" });
    expect(resolveHomeWorldSurface("inventory").zone).toBe("work");
    expect(resolveHomeWorldSurface("cashPosition").zone).toBe("live");
    expect(resolveHomeWorldSurface("reports").zone).toBe("live");
    expect(resolveHomeWorldSurface("settings").zone).toBe("admin");
  });

  it("unknown tiles stay quiet ops/dark — no random palette", () => {
    expect(resolveHomeWorldSurface("unknown-tile")).toEqual({
      id: "fallback",
      zone: "ops",
      ink: "dark",
    });
    expect(homeWorldHasStage("inventory")).toBe(true);
    expect(homeWorldHasStage("not-a-tile")).toBe(false);
  });
});
