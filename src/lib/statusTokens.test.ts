import { describe, expect, it } from "vitest";
import {
  emptyStateClasses,
  errorStateClasses,
  healthStatusBadge,
  healthStatusDot,
  saveIndicatorClasses,
  severityStatusBadge,
  severityStatusIcon,
  staffRiskBadge,
  statusTokens,
  type StatusKind,
} from "./statusTokens";

const ALL_KINDS: StatusKind[] = [
  "success",
  "warning",
  "danger",
  "info",
  "draft",
  "pending",
  "trial",
  "expired",
  "cancelled",
  "offline",
  "syncing",
  "paid",
  "free",
  "business",
  "vip",
  "active",
  "security",
];

describe("statusTokens", () => {
  it("defines theme-aware classes for every status kind", () => {
    for (const kind of ALL_KINDS) {
      const entry = statusTokens[kind];
      expect(entry.badge).toMatch(/bg-\w+/);
      expect(entry.badge).not.toMatch(/bg-card|bg-stone|text-stone|violet|emerald|rose|amber-/);
      expect(entry.dot).toContain("rounded-full");
      // Phase 29.1: on-muted badges must not use inverse *-foreground (white-on-pastel)
      if (kind !== "warning" && kind !== "pending") {
        expect(entry.badge).not.toMatch(/text-\w+-foreground/);
      }
    }
  });

  it("maps investigation severities to semantic badges", () => {
    expect(severityStatusBadge("completed")).toContain("success");
    expect(severityStatusBadge("warning")).toContain("warning");
    expect(severityStatusBadge("error")).toContain("danger");
    // Security maps to trial (purple semantic) — no hard-coded violet palette
    expect(severityStatusIcon("security")).toContain("trial");
  });

  it("maps health tiers consistently", () => {
    expect(healthStatusBadge("ok")).toContain("success");
    expect(healthStatusBadge("critical")).toContain("danger");
    expect(healthStatusDot("warning")).toContain("warning");
  });

  it("maps staff risk tiers", () => {
    expect(staffRiskBadge("offender")).toContain("danger");
    expect(staffRiskBadge("review")).toContain("warning");
    expect(staffRiskBadge("ok")).toContain("success");
  });

  it("provides save indicator states", () => {
    expect(saveIndicatorClasses("saved")).toContain("success");
    expect(saveIndicatorClasses("saving")).toContain("muted");
    expect(saveIndicatorClasses("dirty")).toContain("warning");
  });

  it("provides semantic empty and error state shells", () => {
    expect(emptyStateClasses().shell).toContain("border-border");
    expect(errorStateClasses().shell).toContain("danger");
  });
});
