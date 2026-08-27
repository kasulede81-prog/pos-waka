import { describe, expect, it } from "vitest";
import {
  isPosCashKeypadHardwareCapture,
  mapEventToAlphaKey,
  mapEventToNumericKeypad,
  setPosCashKeypadHardwareCapture,
} from "./desktopPosKeyHandlers";

function keyEvent(key: string): KeyboardEvent {
  return { key } as KeyboardEvent;
}

describe("desktopPosKeyHandlers", () => {
  it("maps numeric keypad keys", () => {
    expect(mapEventToNumericKeypad(keyEvent("5"), false)).toBe("5");
    expect(mapEventToNumericKeypad(keyEvent("Backspace"), false)).toBe("back");
    expect(mapEventToNumericKeypad(keyEvent("."), true)).toBe(".");
    expect(mapEventToNumericKeypad(keyEvent("a"), false)).toBeNull();
  });

  it("maps Windows numpad digit codes even when NumLock is off", () => {
    const e = { key: "End", code: "Numpad1" } as KeyboardEvent;
    expect(mapEventToNumericKeypad(e, false)).toBe("1");
    expect(mapEventToNumericKeypad({ key: "Enter", code: "NumpadEnter" } as KeyboardEvent, false)).toBe("enter");
  });

  it("maps alpha keys with shift/caps", () => {
    expect(mapEventToAlphaKey(keyEvent("a"), { shift: false, capsLock: false })).toBe("a");
    expect(mapEventToAlphaKey(keyEvent("a"), { shift: true, capsLock: false })).toBe("A");
    expect(mapEventToAlphaKey(keyEvent(" "), { shift: false, capsLock: false })).toBe("space");
  });

  it("toggles hardware capture on the document body", () => {
    setPosCashKeypadHardwareCapture(true);
    expect(isPosCashKeypadHardwareCapture()).toBe(true);
    setPosCashKeypadHardwareCapture(false);
    expect(isPosCashKeypadHardwareCapture()).toBe(false);
  });
});
