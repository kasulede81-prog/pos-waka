import { describe, expect, it } from "vitest";
import { resolvePosShortcutAction } from "./posKeyboardShortcuts";

function mockTarget(tagName: string, contentEditable = false): EventTarget {
  return { tagName, isContentEditable: contentEditable } as unknown as EventTarget;
}

describe("posKeyboardShortcuts resolution", () => {
  it("ignores shortcuts when typing in text inputs", () => {
    const input = mockTarget("INPUT");
    expect(resolvePosShortcutAction({ key: "F4", ctrlKey: false, metaKey: false, altKey: false, target: input })).toBeNull();
    expect(resolvePosShortcutAction({ key: "+", ctrlKey: false, metaKey: false, altKey: false, target: input })).toBeNull();
    expect(resolvePosShortcutAction({ key: "Enter", ctrlKey: false, metaKey: false, altKey: false, target: input })).toBeNull();
  });

  it("maps POS shortcut keys when focus is not in editable fields", () => {
    const body = mockTarget("BODY");
    expect(resolvePosShortcutAction({ key: "F2", ctrlKey: false, metaKey: false, altKey: false, target: body })).toBe(
      "focus_search",
    );
    expect(resolvePosShortcutAction({ key: "F4", ctrlKey: false, metaKey: false, altKey: false, target: body })).toBe(
      "focus_checkout",
    );
    expect(resolvePosShortcutAction({ key: "Enter", ctrlKey: false, metaKey: false, altKey: false, target: body })).toBe(
      "confirm",
    );
  });
});
