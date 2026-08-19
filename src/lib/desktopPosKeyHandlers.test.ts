import { describe, expect, it } from "vitest";
import { mapEventToAlphaKey, mapEventToNumericKeypad } from "./desktopPosKeyHandlers";

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

  it("maps alpha keys with shift/caps", () => {
    expect(mapEventToAlphaKey(keyEvent("a"), { shift: false, capsLock: false })).toBe("a");
    expect(mapEventToAlphaKey(keyEvent("a"), { shift: true, capsLock: false })).toBe("A");
    expect(mapEventToAlphaKey(keyEvent(" "), { shift: false, capsLock: false })).toBe("space");
  });
});
