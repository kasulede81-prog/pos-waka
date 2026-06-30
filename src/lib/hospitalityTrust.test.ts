import { describe, expect, it } from "vitest";
import { t } from "./i18n";

describe("hospitality customer trust copy", () => {
  it("explains cross-device staff sync", () => {
    const msg = t("en", "staffDeviceLocalTrust");
    expect(msg.toLowerCase()).toContain("device");
    expect(msg.toLowerCase()).toContain("sync");
    expect(msg.toLowerCase()).toContain("cloud");
  });

  it("shows sales hydration loading message", () => {
    expect(t("en", "salesHistoryHydrationLoading").toLowerCase()).toContain("sales");
  });
});
