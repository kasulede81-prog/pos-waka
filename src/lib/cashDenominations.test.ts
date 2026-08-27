import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  addDenominationToCashInput,
  checkoutCoinAssetPath,
  checkoutNoteAssetPath,
  emptyDenominationCounts,
  sumDenominationCounts,
  UGX_CHECKOUT_COIN_DENOMINATIONS,
  UGX_CHECKOUT_NOTE_DENOMINATIONS,
  UGX_DENOMINATIONS,
} from "./cashDenominations";
import { parseDisplayMoney } from "./posCheckoutMoney";
import { applyCheckoutNumericKey } from "./posCheckoutKeypad";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");

describe("UGX counting denominations (drawer / cash position)", () => {
  it("keeps 100,000 and coins for counting screens", () => {
    expect(UGX_DENOMINATIONS).toEqual([100_000, 50_000, 20_000, 10_000, 5_000, 2_000, 1_000, 500, 200, 100]);
  });

  it("empty counts still sum every counting denomination including coins", () => {
    const counts = emptyDenominationCounts();
    expect(Object.keys(counts).map(Number).sort((a, b) => b - a)).toEqual([...UGX_DENOMINATIONS]);
    expect(sumDenominationCounts(counts)).toBe(0);
  });
});

describe("UGX checkout note denominations (tender helper)", () => {
  it("is banknotes only — no 100,000 and no coins", () => {
    expect([...UGX_CHECKOUT_NOTE_DENOMINATIONS]).toEqual([50_000, 20_000, 10_000, 5_000, 2_000, 1_000]);
    expect(UGX_CHECKOUT_NOTE_DENOMINATIONS).not.toContain(100_000);
    expect(UGX_CHECKOUT_NOTE_DENOMINATIONS).not.toContain(500);
  });

  it("checkout coins are 500, 200, and 100 only", () => {
    expect([...UGX_CHECKOUT_COIN_DENOMINATIONS]).toEqual([500, 200, 100]);
    expect(UGX_CHECKOUT_COIN_DENOMINATIONS).not.toContain(1_000);
    expect(UGX_CHECKOUT_COIN_DENOMINATIONS).not.toContain(100_000);
  });

  it("adds 50,000 + 20,000 = 70,000", () => {
    const after50 = addDenominationToCashInput("", 50_000);
    expect(addDenominationToCashInput(after50, 20_000)).toBe("70000");
  });

  it("repeated 10,000 taps accumulate", () => {
    let value = "";
    value = addDenominationToCashInput(value, 10_000);
    value = addDenominationToCashInput(value, 10_000);
    value = addDenominationToCashInput(value, 10_000);
    expect(value).toBe("30000");
  });

  it("adds 5,000 + 2,000 + 1,000 = 8,000", () => {
    let value = addDenominationToCashInput("", 5_000);
    value = addDenominationToCashInput(value, 2_000);
    value = addDenominationToCashInput(value, 1_000);
    expect(value).toBe("8000");
  });

  it("adds a note onto an existing manual keypad amount", () => {
    expect(addDenominationToCashInput("10000", 50_000)).toBe("60000");
    expect(addDenominationToCashInput("80,000", 20_000)).toBe("100000");
  });

  it("stays integer UGX with no floating point", () => {
    const next = addDenominationToCashInput("1", 1_000);
    expect(Number.isInteger(Number(next))).toBe(true);
    expect(next).toBe("1001");
  });

  it("does not treat empty input as exact-payable — empty stays 0 then adds the note", () => {
    expect(addDenominationToCashInput("", 50_000)).toBe("50000");
    expect(addDenominationToCashInput("0", 20_000)).toBe("20000");
  });

  it("caps at the same 10-digit checkout keypad maximum", () => {
    expect(addDenominationToCashInput("9999999999", 1_000)).toBe("9999999999");
  });

  it("checkout notes are a subset of counting denominations", () => {
    const counting = new Set<number>(UGX_DENOMINATIONS);
    for (const d of UGX_CHECKOUT_NOTE_DENOMINATIONS) {
      expect(counting.has(d)).toBe(true);
    }
  });

  it("maps each checkout note to a local public asset, not an external URL", () => {
    for (const d of UGX_CHECKOUT_NOTE_DENOMINATIONS) {
      const path = checkoutNoteAssetPath(d);
      expect(path.startsWith("currency/ugx/ugx-")).toBe(true);
      expect(path.endsWith("-front.webp")).toBe(true);
      expect(path).not.toMatch(/^https?:\/\//);
      expect(existsSync(join(ROOT, "public", path))).toBe(true);
    }
  });

  it("maps each checkout coin to a local public asset, not an external URL", () => {
    for (const d of UGX_CHECKOUT_COIN_DENOMINATIONS) {
      const path = checkoutCoinAssetPath(d);
      expect(path.startsWith("currency/ugx/ugx-")).toBe(true);
      expect(path.endsWith("-coin.webp")).toBe(true);
      expect(path).not.toMatch(/^https?:\/\//);
      expect(existsSync(join(ROOT, "public", path))).toBe(true);
    }
  });

  it("checkout coins are a subset of counting denominations", () => {
    const counting = new Set<number>(UGX_DENOMINATIONS);
    for (const d of UGX_CHECKOUT_COIN_DENOMINATIONS) {
      expect(counting.has(d)).toBe(true);
    }
  });
});

describe("checkout coin helper feeds the same cashInput path", () => {
  it("adds 500 coin exactly", () => {
    expect(addDenominationToCashInput("", 500)).toBe("500");
  });

  it("adds 200 coin exactly", () => {
    expect(addDenominationToCashInput("", 200)).toBe("200");
  });

  it("adds 100 coin exactly", () => {
    expect(addDenominationToCashInput("", 100)).toBe("100");
  });

  it("notes then coins accumulate on the same integer path", () => {
    let value = addDenominationToCashInput("", 50_000);
    value = addDenominationToCashInput(value, 20_000);
    value = addDenominationToCashInput(value, 500);
    value = addDenominationToCashInput(value, 200);
    value = addDenominationToCashInput(value, 100);
    expect(value).toBe("70800");
  });

  it("repeated coin taps accumulate", () => {
    let value = "";
    value = addDenominationToCashInput(value, 500);
    value = addDenominationToCashInput(value, 500);
    expect(value).toBe("1000");
  });
});

describe("checkout note helper feeds existing cash math", () => {
  it("tender and change still use parseDisplayMoney on cashInput", () => {
    const payable = 5_000;
    const cashInput = addDenominationToCashInput(addDenominationToCashInput("", 50_000), 20_000);
    const cash = parseDisplayMoney(cashInput);
    const totalPaid = cash > 0 ? cash : payable;
    const changeDue = Math.max(0, totalPaid - payable);
    expect(cashInput).toBe("70000");
    expect(totalPaid).toBe(70_000);
    expect(changeDue).toBe(65_000);
  });

  it("change still works after mixed note and coin taps", () => {
    const payable = 1_000;
    let cashInput = addDenominationToCashInput("", 1_000);
    cashInput = addDenominationToCashInput(cashInput, 500);
    const cash = parseDisplayMoney(cashInput);
    const totalPaid = cash > 0 ? cash : payable;
    expect(cashInput).toBe("1500");
    expect(Math.max(0, totalPaid - payable)).toBe(500);
  });

  it("keypad backspace and Clear still mutate the same cashInput string", () => {
    let value = addDenominationToCashInput("", 50_000);
    value = applyCheckoutNumericKey(value, "back");
    expect(value).toBe("5000");
    value = applyCheckoutNumericKey(value, "C");
    expect(value).toBe("");
  });

  it("empty cashInput still means exact payable after helper is unused", () => {
    const payable = 5_000;
    const cash = parseDisplayMoney("");
    const totalPaid = cash > 0 ? cash : payable;
    expect(totalPaid).toBe(payable);
    expect(Math.max(0, totalPaid - payable)).toBe(0);
  });
});
