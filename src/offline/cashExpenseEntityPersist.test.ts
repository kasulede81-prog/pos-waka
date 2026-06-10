import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

function readSrc(relativePath: string): string {
  return readFileSync(resolve(process.cwd(), relativePath), "utf8");
}

describe("cash expense entity persistence", () => {
  it("incremental persist writes cashExpense bucket", () => {
    const src = readSrc("src/offline/incrementalPersist.ts");
    expect(src).toContain('persistArrayDelta("cashExpense"');
  });

  it("entity store migrates and assembles cashExpenses", () => {
    const entitySrc = readSrc("src/offline/entityStore.ts");
    expect(entitySrc).toContain('"cashExpense"');
    expect(entitySrc).toContain("snap.cashExpenses");
    expect(entitySrc).toContain('getEntitiesByBucket<CashExpense>("cashExpense")');
  });

  it("entity bootstrap hydrates cashExpenses from bucket", () => {
    const storeSrc = readSrc("src/store/usePosStore.ts");
    expect(storeSrc).toContain('getEntitiesByBucket<CashExpense>("cashExpense")');
    expect(storeSrc).toContain("normalizeCashExpense");
  });
});
