import { describe, expect, it } from "vitest";
import {
  EscPosBuilder,
  alignColumns,
  columnsForWidth,
  defaultFinishForWidth,
  padColumns,
  wrapText,
} from "./escPosBuilder";

function hasPartialCut(bytes: Uint8Array): boolean {
  for (let i = 0; i < bytes.length - 3; i++) {
    if (bytes[i] === 0x1d && bytes[i + 1] === 0x56 && bytes[i + 2] === 0x42 && bytes[i + 3] === 0x03) return true;
  }
  return false;
}

function hasInitAndCodePage(bytes: Uint8Array): boolean {
  return bytes[0] === 0x1b && bytes[1] === 0x40 && bytes[2] === 0x1b && bytes[3] === 0x74 && bytes[4] === 0x00;
}

function hasFeed(bytes: Uint8Array, lines = 4): boolean {
  for (let i = 0; i < bytes.length - 2; i++) {
    if (bytes[i] === 0x1b && bytes[i + 1] === 0x64 && bytes[i + 2] === lines) return true;
  }
  return false;
}

describe("escPosBuilder", () => {
  it("uses wider columns for 80mm paper", () => {
    expect(columnsForWidth("80mm")).toBe(42);
    expect(columnsForWidth("58mm")).toBe(32);
  });

  it("pads left and right columns without exceeding width", () => {
    const line = padColumns("2x", "Burger", 20);
    expect(line.startsWith("2x")).toBe(true);
    expect(line.endsWith("Burger")).toBe(true);
    expect(line.length).toBe(20);
    expect(padColumns("Outstanding Debt", "UGX 12,000,000", 32).length).toBe(32);
  });

  it("wraps long product names on word boundaries", () => {
    const lines = wrapText("Very Long Pharmacy Compound Name With Extra Words", 32);
    expect(lines.every((line) => line.length <= 32)).toBe(true);
    expect(lines.join(" ")).toContain("Pharmacy");
    expect(lines.length).toBeGreaterThan(1);
  });

  it("aligns totals without clipping the amount", () => {
    const lines = alignColumns("Grand Total", "UGX 28,000", 32);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toHaveLength(32);
    expect(lines[0]?.endsWith("UGX 28,000")).toBe(true);
  });

  it("includes drawer kick bytes", () => {
    const bytes = new EscPosBuilder("80mm").kickDrawer().build();
    expect(bytes.includes(0x1b)).toBe(true);
    expect(bytes.length).toBeGreaterThan(4);
  });

  it("initializes ESC/POS with PC437 and content-dependent finish", () => {
    const narrow = new EscPosBuilder("58mm").textLine("WAKA TEST").finalize().build();
    const wide = new EscPosBuilder("80mm").textLine("WAKA TEST").finalize().build();
    expect(hasInitAndCodePage(narrow)).toBe(true);
    expect(hasFeed(narrow, 4)).toBe(true);
    expect(hasPartialCut(narrow)).toBe(false);
    expect(hasPartialCut(wide)).toBe(true);
    expect(narrow.includes(0x0c)).toBe(false);
    expect(defaultFinishForWidth("58mm")).toBe("feed");
    expect(defaultFinishForWidth("80mm")).toBe("partial-cut");
  });

  it("encodes receipt text as CP437 not UTF-8", () => {
    const bytes = new EscPosBuilder("58mm").textLine("UGX é").build();
    const textStart = 5; // after ESC @ ESC t 0
    expect(Array.from(bytes.slice(textStart, textStart + 6))).toEqual([0x55, 0x47, 0x58, 0x20, 0x82, 0x0a]);
  });
});
