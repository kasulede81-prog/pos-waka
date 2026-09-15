import { describe, expect, it } from "vitest";
import { EscPosBuilder, columnsForWidth, padColumns } from "./escPosBuilder";

describe("escPosBuilder", () => {
  it("uses wider columns for 80mm paper", () => {
    expect(columnsForWidth("80mm")).toBe(42);
    expect(columnsForWidth("58mm")).toBe(32);
  });

  it("pads left and right columns", () => {
    const line = padColumns("2x", "Burger", 20);
    expect(line.startsWith("2x")).toBe(true);
    expect(line.endsWith("Burger")).toBe(true);
  });

  it("includes drawer kick bytes", () => {
    const bytes = new EscPosBuilder("80mm").kickDrawer().build();
    expect(bytes.includes(0x1b)).toBe(true);
    expect(bytes.length).toBeGreaterThan(4);
  });
});
