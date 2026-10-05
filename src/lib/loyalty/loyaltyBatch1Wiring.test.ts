import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Phase 2 Batch 1 wiring — source-level regression guard (no DOM test project
 * in this repo; readFileSync + assertions is the established pattern).
 * Ensures the data-state architecture from Batch 1 stays in place.
 */

const hub = readFileSync(join(process.cwd(), "src/pages/LoyaltyHubPage.tsx"), "utf8");
const rewards = readFileSync(
  join(process.cwd(), "src/components/loyalty/LoyaltyRewardsPanel.tsx"),
  "utf8",
);
const requests = readFileSync(
  join(process.cwd(), "src/components/loyalty/LoyaltyEnrollmentRequestsPanel.tsx"),
  "utf8",
);
const programCode = readFileSync(
  join(process.cwd(), "src/components/loyalty/LoyaltyProgramCodePanel.tsx"),
  "utf8",
);
const enroll = readFileSync(
  join(process.cwd(), "src/components/loyalty/LoyaltyEnrollmentPanel.tsx"),
  "utf8",
);

describe("Batch 1 — loading skeletons", () => {
  it("hub renders EnterpriseSkeleton while loading", () => {
    expect(hub).toContain('loadState === "loading"');
    expect(hub).toContain("<EnterpriseSkeleton");
    expect(hub).toContain('variant="kpi"');
  });

  it("member history, member QR and member search have skeleton loading states", () => {
    expect(hub).toContain("<EnterpriseSkeletonList");
    expect(hub).toContain("history === null");
    expect(hub).toContain('w-[180px]'); // QR placeholder wrapper
    expect(hub).toContain("!searchDone && accounts.length === 0"); // first-search skeleton
  });

  it("rewards catalog, requests queue and program code use skeletons", () => {
    expect(rewards).toContain("!loaded");
    expect(rewards).toContain("<EnterpriseSkeletonList");
    expect(requests).toContain("<EnterpriseSkeletonList");
    expect(programCode).toContain("<EnterpriseSkeletonList");
  });

  it("member-detail redeem list distinguishes loading from empty", () => {
    expect(hub).toContain("rewards === null");
  });
});

describe("Batch 1 — error state and recovery", () => {
  it("hub failure renders EnterpriseErrorState with a Retry that re-runs the load", () => {
    expect(hub).toContain("<EnterpriseErrorState");
    expect(hub).toContain("retryLabel={t(lang, \"loyaltyRetry\")}");
    expect(hub).toContain("const loadHub = useCallback");
    expect(hub).toMatch(/onRetry=\{\(\) => \{[\s\S]{0,120}loadHub\(\)/);
  });

  it("retry flips back through the loading state without a page reload", () => {
    expect(hub).toContain('setLoadState("loading");\n            void loadHub();');
  });
});

describe("Batch 1 — empty states", () => {
  it("member search and rewards catalog use EnterpriseEmptyState", () => {
    expect(hub).toContain("<EnterpriseEmptyState");
    expect(hub).toContain("loyaltyNoMembersFound");
    expect(hub).toContain("loyaltyNoMembers");
    expect(rewards).toContain("<EnterpriseEmptyState");
    expect(rewards).toContain("loyaltyNoRewards");
  });
});

describe("Batch 1 — live status regions", () => {
  it("save, redeem and adjust feedback sit in persistent role=status regions", () => {
    const statusCount = (hub.match(/role="status"/g) ?? []).length;
    expect(statusCount, "hub role=status regions").toBeGreaterThanOrEqual(4);
    expect(hub).toContain("Persistent live region");
  });

  it("enrollment feedback is announced through role=status", () => {
    expect(enroll).toContain('role="status"');
  });

  it("renew feedback in the member list and detail is announced", () => {
    expect(hub).toContain("loyaltyMembershipRenewed");
    expect(hub).toContain("loyaltyErrorKey(renewError)");
    expect(hub).toContain("loyaltyErrorKey(renewFeedback.error)");
  });
});
