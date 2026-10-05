import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Source-level wiring assertions for Phase 2 Batch 2 (Action Safety & Honest
 * Feedback). This repo has no DOM test project, so UI structure is asserted by
 * scanning the source — see the established readFileSync pattern elsewhere in
 * this codebase.
 */
const src = readFileSync(join(process.cwd(), "src/pages/LoyaltyHubPage.tsx"), "utf8");

/** Slice between two anchors so assertions target one function, not the file. */
function slice(startAnchor: string, endAnchor: string): string {
  const from = src.indexOf(startAnchor);
  expect(from, `anchor not found: ${startAnchor}`).toBeGreaterThan(-1);
  const to = src.indexOf(endAnchor, from + startAnchor.length);
  expect(to, `anchor not found: ${endAnchor}`).toBeGreaterThan(from);
  return src.slice(from, to);
}

describe("P3 — redemption confirmation dialog", () => {
  it("renders the shared ConfirmationDialog bound to the redemption intent", () => {
    expect(src).toContain("<ConfirmationDialog");
    expect(src).toContain("open={pendingRedeem != null}");
    expect(src).toContain("onConfirm={() => void confirmRedeem()}");
    expect(src).toContain("title={t(lang, \"loyaltyRedeemConfirmTitle\")}");
  });

  it("shows reward, cost, balance and balance-after before confirming", () => {
    expect(src).toContain("{pendingReward.name}");
    expect(src).toContain("loyaltyRedeemConfirm\", { points: pendingReward.pointsRequired }");
    expect(src).toContain("loyaltyRedeemConfirmBalance\"");
    expect(src).toContain("balanceAfterRedeem(entry.balancePoints, pendingReward.pointsRequired)");
  });

  it("cancel/dismiss never reaches the RPC", () => {
    const cancel = slice("const cancelRedeem", "const pendingReward");
    expect(cancel).toContain("setPendingRedeem(null)");
    expect(cancel).not.toContain("redeemLoyaltyReward(");
    expect(cancel).not.toContain("confirmRedeem");
  });

  it("confirm still executes the one existing redemption path with the same key", () => {
    const confirm = slice("const confirmRedeem", "const submitAdjust");
    expect(confirm).toContain(
      "redeemLoyaltyReward(shopId, entry.accountId, pendingRedeem.rewardId, pendingRedeem.key)",
    );
    const begin = slice("const beginRedeem", "const cancelRedeem");
    expect(begin).toContain("newRedemptionIdempotencyKey()");
  });

  it("keeps Batch 1 success/duplicate/failure feedback regions", () => {
    expect(src).toContain("loyaltyRedeemDone");
    expect(src).toContain("loyaltyRedeemAlready");
    expect(src).toContain("redeemErrorMessage(");
    // the dialog and the card share one mapping — only one implementation exists
    expect(src.match(/redeemErrorMessage\(/g)?.length).toBeGreaterThanOrEqual(2);
  });
});

describe("P4 — renew failure visibility", () => {
  it("the list-row renew reports busy, success and mapped failure", () => {
    const renew = slice("const runListRenew", "return (");
    expect(renew).toContain("setRenewBusyId(accountId)");
    expect(renew).toContain("setRenewFeedback({ accountId, ok: false, error: result.error })");
    expect(renew).toContain("onAdjusted()");
    expect(src).toContain("disabled={renewBusyId === entry.accountId}");
    expect(src).toContain("loyaltyMembershipRenewed");
    expect(src).toContain("loyaltyErrorKey(renewFeedback.error)");
  });

  it("the detail renew still surfaces success and mapped failure in a status region", () => {
    expect(src).toContain("loyaltyErrorKey(renewError)");
    const region = slice("Persistent live region: renew + lifecycle", "MemberQrBlock");
    expect(region).toContain('role="status"');
    expect(region).toContain("loyaltyMembershipRenewed");
  });
});

describe("P5 — adjust points failure visibility", () => {
  it("reports client-side validation instead of silently returning", () => {
    const adjust = slice("const submitAdjust", "return (");
    expect(adjust).toContain('setAdjustValidation("loyaltyAdjustInvalidPoints")');
    expect(adjust).toContain('setAdjustValidation("loyaltyAdjustNoteRequired")');
    expect(adjust).not.toContain("|| !adjustNote.trim()) return;");
  });

  it("maps the RPC error instead of a blanket permission message", () => {
    expect(src).toContain("loyaltyErrorKey(adjustError)");
    expect(src).not.toContain('"loyaltyAdjustForbidden"');
    const adjust = slice("const submitAdjust", "return (");
    expect(adjust).toContain("setAdjustError(result.error)");
  });

  it("keeps validation, success and error inside the role=status region", () => {
    const region = src.match(
      /<div role="status">[\s\S]{0,800}?loyaltyErrorKey\(adjustError\)[\s\S]{0,200}?<\/div>/,
    );
    expect(region, "adjust status region not found").toBeTruthy();
    const text = region![0];
    expect(text).toContain("adjustValidation");
    expect(text).toContain("loyaltySaved");
    expect(text).toContain("loyaltyErrorKey(adjustError)");
  });
});

describe("P6 — unaffordable rewards explain the shortfall", () => {
  it("renders the needs-points hint with computed shortfall and balance", () => {
    expect(src).toContain("loyaltyRewardNeedsPoints");
    expect(src).toContain("pointsStillNeeded(reward.pointsRequired, entry.balancePoints)");
    expect(src).toContain("balance: entry.balancePoints");
  });

  it("keeps the button disabled and eligibility untouched", () => {
    expect(src).toContain("const eligible = isRewardEligible(reward, entry.balancePoints)");
    expect(src).toContain("disabled={!eligible}");
  });
});
