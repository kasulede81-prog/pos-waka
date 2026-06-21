import { beforeEach, describe, expect, it } from "vitest";
import { usePosStore } from "../store/usePosStore";
import {
  readCoreStoreCounts,
  RECOVERY_EMPTY_STORE_ERROR,
  storeHasCoreRecoveryData,
  verifyRecoveryHydration,
} from "./recoveryHydration";

describe("recoveryHydration", () => {
  beforeEach(() => {
    usePosStore.setState({
      products: [],
      sales: [],
      customers: [],
    });
  });

  it("storeHasCoreRecoveryData is false when all core entities are empty", () => {
    expect(storeHasCoreRecoveryData()).toBe(false);
    expect(verifyRecoveryHydration().hydrated).toBe(false);
  });

  it("storeHasCoreRecoveryData is true when any core entity exists", () => {
    usePosStore.setState({ products: [{ id: "p1" } as never] });
    expect(storeHasCoreRecoveryData()).toBe(true);
    expect(readCoreStoreCounts().products).toBe(1);
  });

  it("exports stable empty-store error key", () => {
    expect(RECOVERY_EMPTY_STORE_ERROR).toBe("RECOVERY_COMPLETED_WITH_EMPTY_STORE");
  });
});
