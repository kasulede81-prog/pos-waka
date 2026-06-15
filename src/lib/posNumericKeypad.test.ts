import { describe, expect, it, beforeAll } from "vitest";
import {
  applyMoneyInputKey,
  isActiveMoneyInput,
  MONEY_INPUT_CLASS,
  resolveMoneyInputKey,
} from "./posKeyboardShortcuts";

function installFakeHtmlInputElement(): void {
  if (typeof globalThis.HTMLInputElement !== "undefined") return;
  const proto: object = {};
  Object.defineProperty(proto, "value", {
    configurable: true,
    get(this: { _v?: string }) {
      return this._v ?? "";
    },
    set(this: { _v?: string }, v: string) {
      this._v = v;
    },
  });
  (globalThis as typeof globalThis & { HTMLInputElement: { prototype: object } }).HTMLInputElement = {
    prototype: proto,
  } as unknown as typeof HTMLInputElement;
}

function mockMoneyInput(value = ""): HTMLInputElement {
  return {
    tagName: "INPUT",
    _v: value,
    get value() {
      return (this as { _v?: string })._v ?? "";
    },
    set value(v: string) {
      (this as { _v?: string })._v = v;
    },
    classList: { contains: (c: string) => c === MONEY_INPUT_CLASS },
    dispatchEvent: () => true,
  } as unknown as HTMLInputElement;
}

describe("pos numeric keypad (MoneyInput)", () => {
  beforeAll(() => {
    installFakeHtmlInputElement();
  });

  it("recognizes digit, backspace, and decimal keys", () => {
    expect(resolveMoneyInputKey("5")).toBe("digit");
    expect(resolveMoneyInputKey("Backspace")).toBe("backspace");
    expect(resolveMoneyInputKey(".")).toBe("decimal");
    expect(resolveMoneyInputKey("Decimal")).toBe("decimal");
    expect(resolveMoneyInputKey("F4")).toBeNull();
  });

  it("detects active MoneyInput by class", () => {
    const input = mockMoneyInput();
    expect(isActiveMoneyInput(input)).toBe(true);
    expect(
      isActiveMoneyInput({ tagName: "INPUT", classList: { contains: () => false } } as unknown as EventTarget),
    ).toBe(false);
    expect(isActiveMoneyInput({ tagName: "TEXTAREA", classList: { contains: () => true } } as unknown as EventTarget)).toBe(
      false,
    );
  });

  it("appends digits via applyMoneyInputKey", () => {
    const input = mockMoneyInput("12");
    expect(applyMoneyInputKey(input, "3")).toBe(true);
    expect(input.value).toBe("123");
  });

  it("handles backspace on MoneyInput", () => {
    const input = mockMoneyInput("120");
    expect(applyMoneyInputKey(input, "Backspace")).toBe(true);
    expect(input.value).toBe("12");
  });
});
