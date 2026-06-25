import { describe, expect, it } from "vitest";
import { WAKA_EMAIL_FROM, WAKA_EMAIL_REPLY_TO } from "./constants";

describe("email constants", () => {
  it("uses root waka.ug domain for transactional sender", () => {
    expect(WAKA_EMAIL_FROM).toBe("Waka POS <noreply@waka.ug>");
    expect(WAKA_EMAIL_REPLY_TO).toBe("support@waka.ug");
    expect(WAKA_EMAIL_FROM).not.toContain("info.waka.ug");
  });
});
