import { describe, expect, it } from "vitest";
import { CLOUD_ENTITY_DEFINITIONS } from "./cloudAuthorityAudit";

describe("cloudAuthorityAudit", () => {
  it("includes all PART 1 entity types", () => {
    const ids = CLOUD_ENTITY_DEFINITIONS.map((d) => d.id);
    expect(ids).toContain("products");
    expect(ids).toContain("sales");
    expect(ids).toContain("inventory_counts");
    expect(ids).toContain("shifts");
    expect(ids).toContain("day_closes");
    expect(ids).toContain("settings");
    expect(ids.length).toBeGreaterThanOrEqual(16);
  });

  it("marks operational entities as authoritative or partial", () => {
    const sales = CLOUD_ENTITY_DEFINITIONS.find((d) => d.id === "sales");
    const stock = CLOUD_ENTITY_DEFINITIONS.find((d) => d.id === "stock_movements");
    expect(sales?.tier).toBe("authoritative");
    expect(stock?.tier).toBe("authoritative");
  });
});
