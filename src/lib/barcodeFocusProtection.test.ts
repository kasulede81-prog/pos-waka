import { describe, expect, it } from "vitest";
import { shouldBufferHidWedgeKey } from "../services/hardware/barcodeAdapter";

function mockTarget(tagName: string, contentEditable = false): EventTarget {
  return { tagName, isContentEditable: contentEditable } as unknown as EventTarget;
}

describe("barcode HID wedge focus protection", () => {
  it("does not buffer keys while focus is in search or form inputs", () => {
    expect(shouldBufferHidWedgeKey({ target: mockTarget("INPUT") })).toBe(false);
    expect(shouldBufferHidWedgeKey({ target: mockTarget("TEXTAREA") })).toBe(false);
    expect(shouldBufferHidWedgeKey({ target: mockTarget("SELECT") })).toBe(false);
  });

  it("does not buffer keys while focus is in contenteditable", () => {
    expect(shouldBufferHidWedgeKey({ target: mockTarget("DIV", true) })).toBe(false);
  });

  it("buffers keys when focus is on body (scanner wedge active)", () => {
    expect(shouldBufferHidWedgeKey({ target: mockTarget("BODY") })).toBe(true);
  });

  it("buffers keys for dedicated barcode scan field", () => {
    const field = {
      tagName: "INPUT",
      dataset: { barcodeScan: "true" },
      isContentEditable: false,
    } as unknown as EventTarget;
    expect(shouldBufferHidWedgeKey({ target: field })).toBe(true);
  });
});
