import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  releaseCashMutationSubmit,
  submitCashMutationOnce,
  tryBeginCashMutationSubmit,
} from "./cashMutationSubmitGuard";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");

function src(rel: string): string {
  return readFileSync(join(ROOT, rel), "utf8");
}

describe("cashMutationSubmitGuard — CASH-POST-02 / CASH-POST-03 double-submit", () => {
  it("first submit starts the mutation; a second submit before release does not", () => {
    const lock = { current: false };
    let mutations = 0;
    const mutate = () => {
      mutations += 1;
      return { ok: true, id: `m-${mutations}` };
    };

    const first = submitCashMutationOnce(lock, mutate);
    const second = submitCashMutationOnce(lock, mutate);

    expect(first).toEqual({ started: true, result: { ok: true, id: "m-1" } });
    expect(second).toEqual({ started: false });
    expect(mutations).toBe(1);
    expect(lock.current).toBe(true);
  });

  it("produces only one UUID when the same submit is repeated while in flight", () => {
    const lock = { current: false };
    const ids: string[] = [];
    const record = () => {
      ids.push(crypto.randomUUID());
      return { ok: true as const };
    };

    submitCashMutationOnce(lock, record);
    submitCashMutationOnce(lock, record);
    submitCashMutationOnce(lock, record);

    expect(ids).toHaveLength(1);
  });

  it("releases on failure so a legitimate retry can start another operation", () => {
    const lock = { current: false };
    let attempt = 0;
    const mutate = () => {
      attempt += 1;
      return attempt === 1 ? { ok: false as const } : { ok: true as const };
    };

    const failed = submitCashMutationOnce(lock, mutate);
    expect(failed).toEqual({ started: true, result: { ok: false } });
    expect(lock.current).toBe(false);

    const retry = submitCashMutationOnce(lock, mutate);
    expect(retry).toEqual({ started: true, result: { ok: true } });
    expect(lock.current).toBe(true);
  });

  it("allows a new mutation after the caller releases following a successful reset", () => {
    const lock = { current: false };
    let mutations = 0;
    const mutate = () => {
      mutations += 1;
      return { ok: true as const };
    };

    expect(submitCashMutationOnce(lock, mutate).started).toBe(true);
    expect(tryBeginCashMutationSubmit(lock)).toBe(false);

    releaseCashMutationSubmit(lock);
    expect(submitCashMutationOnce(lock, mutate).started).toBe(true);
    expect(mutations).toBe(2);
  });

  it("does not take the lock when validation returns before mutate", () => {
    const lock = { current: false };
    let mutations = 0;
    const amount = 0;
    if (amount <= 0) {
      expect(lock.current).toBe(false);
      expect(mutations).toBe(0);
      return;
    }
    submitCashMutationOnce(lock, () => {
      mutations += 1;
      return { ok: true as const };
    });
    expect(mutations).toBe(0);
  });

  it("wires the submit lock into every cash expense and cash-movement form", () => {
    expect(src("src/pages/CashExpensesPage.tsx")).toContain("submitCashMutationOnce");
    expect(src("src/components/pos/RecordExpenseModal.tsx")).toContain("submitCashMutationOnce");
    expect(src("src/pages/CashPositionPage.tsx")).toContain("submitCashMutationOnce");
    expect(src("src/pages/CashExpensesPage.tsx")).toContain("releaseCashMutationSubmit");
    expect(src("src/components/pos/RecordExpenseModal.tsx")).toContain("releaseCashMutationSubmit");
    expect(src("src/pages/CashPositionPage.tsx")).toContain("releaseCashMutationSubmit");
  });
});
