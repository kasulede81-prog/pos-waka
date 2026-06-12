import { describe, expect, it } from "vitest";
import { posOfflineBannerVisible } from "../components/trust/PosOfflineBanner";

describe("POS offline banner", () => {
  it("appears only when offline", () => {
    expect(posOfflineBannerVisible(false)).toBe(true);
    expect(posOfflineBannerVisible(true)).toBe(false);
  });
});
