import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { releaseRestockSubmit, submitRestockOnce, tryBeginRestockSubmit } from "./restockSubmitGuard";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");

function src(rel: string): string {
  return readFileSync(join(ROOT, rel), "utf8");
}

describe("restockSubmitGuard — INV-B4 double-submit", () => {
  it("first submit starts the restock; a second submit before release does not", () => {
    const lock = { current: false };
    let mutations = 0;
    const mutate = () => {
      mutations += 1;
      return { ok: true, purchaseId: `p-${mutations}` };
    };

    const first = submitRestockOnce(lock, mutate);
    const second = submitRestockOnce(lock, mutate);

    expect(first).toEqual({ started: true, result: { ok: true, purchaseId: "p-1" } });
    expect(second).toEqual({ started: false });
    expect(mutations).toBe(1);
    expect(lock.current).toBe(true);
  });

  it("produces only one purchase when the same submit is repeated while in flight", () => {
    const lock = { current: false };
    const purchases: string[] = [];
    const recordPurchase = () => {
      purchases.push(crypto.randomUUID());
      return { ok: true as const };
    };

    submitRestockOnce(lock, recordPurchase);
    submitRestockOnce(lock, recordPurchase);
    submitRestockOnce(lock, recordPurchase);

    expect(purchases).toHaveLength(1);
  });

  it("releases on failure so a legitimate retry can start another operation", () => {
    const lock = { current: false };
    let attempt = 0;
    const mutate = () => {
      attempt += 1;
      return attempt === 1 ? { ok: false as const } : { ok: true as const };
    };

    const failed = submitRestockOnce(lock, mutate);
    expect(failed).toEqual({ started: true, result: { ok: false } });
    expect(lock.current).toBe(false);

    const retry = submitRestockOnce(lock, mutate);
    expect(retry).toEqual({ started: true, result: { ok: true } });
    expect(lock.current).toBe(true);
  });

  it("allows a new restock after the caller releases following a successful reset", () => {
    const lock = { current: false };
    let mutations = 0;
    const mutate = () => {
      mutations += 1;
      return { ok: true as const };
    };

    expect(submitRestockOnce(lock, mutate).started).toBe(true);
    expect(tryBeginRestockSubmit(lock)).toBe(false);

    releaseRestockSubmit(lock);
    expect(submitRestockOnce(lock, mutate).started).toBe(true);
    expect(mutations).toBe(2);
  });

  it("wires the submit lock into every restock/receive form", () => {
    expect(src("src/pages/RestockPage.tsx")).toContain("submitRestockOnce");
    expect(src("src/pages/RestockPage.tsx")).toContain("primaryBusy={submitting}");
    expect(src("src/components/stock/SimpleProductRestockModal.tsx")).toContain("submitRestockOnce");
    expect(src("src/components/pharmacy/PharmacyReceiveBatchSheet.tsx")).toContain("submitRestockOnce");
  });
});
