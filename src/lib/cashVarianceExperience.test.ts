import { describe, expect, it } from "vitest";
import {
  buildShiftCashAuditTimeline,
  classifyCashVariance,
  computeCashVarianceThresholdUgx,
} from "./cashVarianceExperience";
import { dayCloseVarianceIsFlagged } from "./dayDrawerOpen";

const prefs = { cashVarianceThresholdPct: 5, cashVarianceThresholdUgxFixed: 5_000 };

describe("computeCashVarianceThresholdUgx", () => {
  it("matches dayCloseVarianceIsFlagged boundary", () => {
    const expected = 1_250_000;
    const threshold = computeCashVarianceThresholdUgx(expected, prefs);
    expect(threshold).toBe(62_500);
    expect(dayCloseVarianceIsFlagged(expected, 3_000, prefs)).toBe(false);
    expect(dayCloseVarianceIsFlagged(expected, threshold + 1, prefs)).toBe(true);
  });
});

describe("classifyCashVariance", () => {
  it("scenario 1: within tolerance allows shift close decision", () => {
    const assessment = classifyCashVariance(1_250_000, 1_247_000, prefs, "shift_close");
    expect(assessment.withinTolerance).toBe(true);
    expect(assessment.state).toBe("minor_variance");
    expect(assessment.decisionKey).toBe("drawerVarianceDecisionShiftCloseOk");
  });

  it("scenario 2: outside tolerance explains manager approval", () => {
    const assessment = classifyCashVariance(1_250_000, 1_180_000, prefs, "shift_close");
    expect(assessment.flagged).toBe(true);
    expect(assessment.state).toBe("outside_tolerance");
    expect(assessment.decisionKey).toBe("drawerVarianceDecisionShiftCloseOutside");
  });

  it("scenario 3: recovery uses same tolerance logic as shift close", () => {
    const normal = classifyCashVariance(500_000, 495_000, prefs, "shift_close");
    const recovery = classifyCashVariance(500_000, 495_000, prefs, "shift_recovery");
    expect(recovery.thresholdUgx).toBe(normal.thresholdUgx);
    expect(recovery.state).toBe(normal.state);
    expect(recovery.decisionKey).toBe("drawerVarianceDecisionRecoveryOk");
  });

  it("scenario 4: day close flagged state blocks without approval", () => {
    const assessment = classifyCashVariance(1_000_000, 930_000, prefs, "day_close");
    expect(assessment.flagged).toBe(true);
    expect(assessment.decisionKey).toBe("drawerVarianceDecisionDayCloseBlocked");
  });

  it("scenario 5: shift close shows tolerance explanation keys", () => {
    const assessment = classifyCashVariance(100_000, 100_000, prefs, "shift_close");
    expect(assessment.state).toBe("within_tolerance");
    expect(assessment.decisionKey).toBe("drawerVarianceDecisionShiftCloseOk");
  });

  it("scenario 6: audit timeline contains variance information", () => {
    const timeline = buildShiftCashAuditTimeline(
      {
        startAt: "2026-07-06T08:00:00.000Z",
        endAt: "2026-07-06T16:00:00.000Z",
        countedCashUgx: 1_247_000,
        cashDifferenceUgx: -3_000,
        recoveredByLabel: "Manager Jane",
        recoveredAt: "2026-07-06T16:00:00.000Z",
        recoveredByUserId: "mgr-1",
      },
      1_250_000,
      prefs,
    );
    const ids = timeline.map((e) => e.id);
    expect(ids).toEqual(["expected", "counted", "variance", "tolerance", "recovered", "closed"]);
    expect(timeline.find((e) => e.id === "variance")?.value).toContain("3,000");
    expect(timeline.find((e) => e.id === "tolerance")?.value).toContain("±");
  });
});

describe("critical variance", () => {
  it("marks very large gaps as critical", () => {
    const assessment = classifyCashVariance(1_000_000, 800_000, prefs, "shift_close");
    expect(assessment.state).toBe("critical_variance");
  });
});
