import { afterEach, describe, expect, it } from "vitest";
import {
  clearDayCloseCashCountDraft,
  dayCloseCashCountDraftUgx,
  readDayCloseCashCountDraft,
  writeDayCloseCashCountDraft,
} from "./dayCloseCashCountDraft";

const DAY = "2026-06-10";

afterEach(() => {
  clearDayCloseCashCountDraft(DAY);
  sessionStorage.removeItem("waka-close-day-prefill");
  sessionStorage.removeItem("waka-close-day-prefill-date");
});

describe("dayCloseCashCountDraft", () => {
  it("round-trips counted cash for a business date", () => {
    writeDayCloseCashCountDraft(DAY, "125000");
    expect(readDayCloseCashCountDraft(DAY)).toBe("125000");
    expect(dayCloseCashCountDraftUgx(DAY)).toBe(125_000);
  });

  it("migrates the one-shot sessionStorage prefill for the same date", () => {
    sessionStorage.setItem("waka-close-day-prefill", "88000");
    sessionStorage.setItem("waka-close-day-prefill-date", DAY);
    expect(readDayCloseCashCountDraft(DAY)).toBe("88000");
    expect(sessionStorage.getItem("waka-close-day-prefill")).toBeNull();
    expect(readDayCloseCashCountDraft(DAY)).toBe("88000");
  });

  it("ignores a prefill saved for a different business date", () => {
    sessionStorage.setItem("waka-close-day-prefill", "88000");
    sessionStorage.setItem("waka-close-day-prefill-date", "2026-06-11");
    expect(readDayCloseCashCountDraft(DAY)).toBeNull();
  });
});
