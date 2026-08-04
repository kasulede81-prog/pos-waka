import { describe, expect, it } from "vitest";
import { suggestVisionCameraProfiles } from "./profiles";

describe("suggestVisionCameraProfiles", () => {
  it("suggests pharmacy roles", () => {
    const ids = suggestVisionCameraProfiles("pharmacy", true).map((p) => p.id);
    expect(ids).toContain("dispensary");
    expect(ids).toContain("safe");
  });

  it("suggests restaurant roles", () => {
    const ids = suggestVisionCameraProfiles("restaurant", false, true).map((p) => p.id);
    expect(ids).toContain("kitchen");
    expect(ids).toContain("dining");
  });

  it("suggests retail roles by default", () => {
    const ids = suggestVisionCameraProfiles("kiosk_duka").map((p) => p.id);
    expect(ids).toEqual(["cashier", "entrance", "store", "warehouse"]);
  });
});
