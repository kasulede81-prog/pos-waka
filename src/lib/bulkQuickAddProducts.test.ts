import { beforeEach, describe, expect, it } from "vitest";
import { usePosStore } from "../store/usePosStore";

describe("bulkQuickAddProducts (Phase 36.1)", () => {
  beforeEach(() => {
    usePosStore.setState({
      _hydrated: true,
      products: [],
      sessionActor: { userId: "owner:1", role: "owner", displayName: "Owner" },
      preferences: {
        ...usePosStore.getState().preferences,
        businessType: "kiosk_duka",
        pharmacyModeEnabled: false,
      },
    });
  });

  it("commits many products in one catalog revision", () => {
    const before = usePosStore.getState().products;
    const { added, skipped } = usePosStore.getState().bulkQuickAddProducts(
      Array.from({ length: 25 }, (_, i) => ({
        name: `Bulk ${i}`,
        priceUgx: 1000 + i,
        stockQty: 2,
        category: "General",
      })),
    );
    expect(added).toBe(25);
    expect(skipped).toBe(0);
    const after = usePosStore.getState().products;
    expect(after).toHaveLength(25);
    expect(after).not.toBe(before);
    // Matches legacy N× prepend: last row ends up first.
    expect(after[0]?.name).toBe("Bulk 24");
    expect(after[24]?.name).toBe("Bulk 0");
    expect(new Set(after.map((p) => p.sku)).size).toBe(25);
  });
});
