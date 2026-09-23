import { describe, expect, it } from "vitest";
import { resolveAdminShortcut } from "./globalKeyboardShortcuts";

const idle = { awaitingGoKey: false, startedAt: 0 };

function key(value: string, shiftKey = false) {
  return { key: value, shiftKey };
}

describe("resolveAdminShortcut", () => {
  it("resolves G then C to Customers", () => {
    const first = resolveAdminShortcut(key("g"), idle, 100);
    expect(first.action).toBeNull();
    expect(resolveAdminShortcut(key("c"), first.state, 500).action).toBe("customers");
  });

  it("expires an unfinished G sequence", () => {
    const first = resolveAdminShortcut(key("g"), idle, 100);
    expect(resolveAdminShortcut(key("c"), first.state, 1400).action).toBeNull();
  });

  it("focuses search with slash", () => {
    expect(resolveAdminShortcut(key("/"), idle, 100).action).toBe("focus-search");
  });
});
