import { describe, expect, it } from "vitest";
import { t } from "./i18n";

describe("hospitality customer trust copy", () => {
  it("explains device-local staff accounts", () => {
    const msg = t("en", "staffDeviceLocalTrust");
    expect(msg.toLowerCase()).toContain("device");
    expect(msg.toLowerCase()).toContain("sync");
  });

  it("shows sales hydration loading message", () => {
    expect(t("en", "salesHistoryHydrationLoading").toLowerCase()).toContain("sales");
  });
});
