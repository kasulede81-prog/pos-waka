import { describe, expect, it } from "vitest";
import { pullEntitySafe } from "./pullEntitySafe";

describe("pullEntitySafe", () => {
  it("returns value on success", async () => {
    const errors: Record<string, string> = {};
    const value = await pullEntitySafe("products", errors, async () => ({ count: 3 }));
    expect(value).toEqual({ count: 3 });
    expect(Object.keys(errors)).toHaveLength(0);
  });

  it("records error and returns undefined without throwing", async () => {
    const errors: Record<string, string> = {};
    const value = await pullEntitySafe("sales", errors, async () => {
      throw new Error("rpc timeout");
    });
    expect(value).toBeUndefined();
    expect(errors.sales).toBe("rpc timeout");
  });

  it("isolates failures so other entities can succeed", async () => {
    const errors: Record<string, string> = {};
    const a = await pullEntitySafe("a", errors, async () => "ok-a");
    const b = await pullEntitySafe("b", errors, async () => {
      throw new Error("fail-b");
    });
    const c = await pullEntitySafe("c", errors, async () => "ok-c");
    expect(a).toBe("ok-a");
    expect(b).toBeUndefined();
    expect(c).toBe("ok-c");
    expect(errors).toEqual({ b: "fail-b" });
  });
});
