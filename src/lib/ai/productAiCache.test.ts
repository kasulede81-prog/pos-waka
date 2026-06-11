import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AiProductSuggestion } from "./aiProductSchemas";
import {
  localProductAiCacheKey,
  lookupLocalProductAiCache,
  upsertLocalProductAiCache,
} from "./productAiCache";

const readKv = vi.fn();
const writeKv = vi.fn();

vi.mock("../../offline/localDb", () => ({
  readKv: (...args: unknown[]) => readKv(...args),
  writeKv: (...args: unknown[]) => writeKv(...args),
}));

const sample: AiProductSuggestion = {
  name: "Coca Cola 500ml",
  category: "Soda",
  unit: "bottle",
  sellingMode: "unit",
  packType: "crate",
  piecesPerPack: 24,
  confidence: 0.9,
};

describe("localProductAiCacheKey", () => {
  it("normalizes name and scopes by business type", () => {
    expect(localProductAiCacheKey("  Coca-Cola 500ml! ", "grocery")).toBe(
      "ai_product_cache::coca cola 500ml::grocery",
    );
  });
});

describe("lookupLocalProductAiCache", () => {
  beforeEach(() => {
    readKv.mockReset();
    writeKv.mockReset();
  });

  it("returns null when entry is missing", async () => {
    readKv.mockResolvedValue(null);
    await expect(lookupLocalProductAiCache("Sugar")).resolves.toBeNull();
  });

  it("returns null when entry is expired", async () => {
    const old = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString();
    readKv.mockResolvedValue({ suggestion: sample, cachedAt: old, businessType: "" });
    await expect(lookupLocalProductAiCache("Coca Cola")).resolves.toBeNull();
  });

  it("returns suggestion when entry is fresh", async () => {
    readKv.mockResolvedValue({
      suggestion: sample,
      cachedAt: new Date().toISOString(),
      businessType: "",
    });
    await expect(lookupLocalProductAiCache("Coca Cola")).resolves.toEqual(sample);
  });
});

describe("upsertLocalProductAiCache", () => {
  beforeEach(() => {
    writeKv.mockReset();
  });

  it("writes scoped cache entry", async () => {
    await upsertLocalProductAiCache("Coca Cola", "grocery", sample);
    expect(writeKv).toHaveBeenCalledOnce();
    const [key, payload] = writeKv.mock.calls[0] as [string, { suggestion: AiProductSuggestion }];
    expect(key).toBe("ai_product_cache::coca cola::grocery");
    expect(payload.suggestion.name).toBe("Coca Cola 500ml");
  });
});
