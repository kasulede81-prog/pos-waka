import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { applyOpsLedgerLoadMore, isCurrentOpsLedgerRequest } from "./shopConsoleOpsLedgers";

describe("shop console ops ledger load-more race", () => {
  it("discards a stale load-more after a newer shop load", () => {
    let latestSeq = 0;

    latestSeq += 1;
    const shopASeq = latestSeq;
    let rows = ["A1", "A2"];

    const loadMoreASeq = shopASeq;
    expect(isCurrentOpsLedgerRequest(loadMoreASeq, latestSeq)).toBe(true);

    latestSeq += 1;
    rows = ["B1"];
    expect(isCurrentOpsLedgerRequest(loadMoreASeq, latestSeq)).toBe(false);

    const lateA = applyOpsLedgerLoadMore({
      startedSeq: loadMoreASeq,
      latestSeq,
      previous: rows,
      incoming: ["A3", "A4"],
    });

    expect(lateA.applied).toBe(false);
    expect(lateA.rows).toEqual(["B1"]);
    expect(lateA.rows).not.toContain("A3");
  });

  it("appends load-more only while the generation is still current", () => {
    const merged = applyOpsLedgerLoadMore({
      startedSeq: 4,
      latestSeq: 4,
      previous: ["A1", "A2"],
      incoming: ["A3"],
    });
    expect(merged.applied).toBe(true);
    expect(merged.rows).toEqual(["A1", "A2", "A3"]);
  });

  it("load-more in the shop console uses the generation guard", () => {
    const src = readFileSync(join(process.cwd(), "src/components/internal-admin/v2/shop-console/useShopConsoleState.ts"), "utf8");
    expect(src).toContain("isCurrentOpsLedgerRequest(seq, opsLedgerSeq.current)");
    expect(src).toContain("if (!isCurrentOpsLedgerRequest(seq, opsLedgerSeq.current)) return");
    expect(src).toContain("applyOpsLedgerLoadMore");
  });
});
