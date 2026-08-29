import { describe, expect, it } from "vitest";
import { staffSwitchCartPlan } from "./staffSwitchCartPolicy";

describe("staffSwitchCartPlan", () => {
  it("does nothing when the same staff remains", () => {
    expect(
      staffSwitchCartPlan({
        prevStaffId: "a",
        nextStaffId: "a",
        draftLineCount: 3,
        activePendingSaleId: "sale-1",
      }),
    ).toBe("none");
  });

  it("parks unsaved lines when staff identity changes", () => {
    expect(
      staffSwitchCartPlan({
        prevStaffId: null,
        nextStaffId: "cashier-1",
        draftLineCount: 1,
        activePendingSaleId: null,
      }),
    ).toBe("park_and_detach");
  });

  it("detaches a bound pending sale without creating another", () => {
    expect(
      staffSwitchCartPlan({
        prevStaffId: "a",
        nextStaffId: "b",
        draftLineCount: 0,
        activePendingSaleId: "pending-1",
      }),
    ).toBe("detach");
  });

  it("detaches an inherited table session", () => {
    expect(
      staffSwitchCartPlan({
        prevStaffId: null,
        nextStaffId: "b",
        draftLineCount: 0,
        activePendingSaleId: null,
        activeTableSessionId: "table-1",
      }),
    ).toBe("detach");
  });
});
