import { describe, expect, it } from "vitest";
import {
  POS_HOME_ROUTE,
  POS_OPERATOR_ROUTE,
  POS_RECEIPTS_ROUTE,
  POS_SELL_ROUTE,
  POS_SHOP_ROUTE,
} from "./posNavigation";

describe("posNavigation routes", () => {
  it("keeps sell entry at /pos for future operator gate compatibility", () => {
    expect(POS_SELL_ROUTE).toBe("/pos");
    expect(POS_OPERATOR_ROUTE).toBe("/pos/operator");
  });

  it("maps operational POS destinations", () => {
    expect(POS_HOME_ROUTE).toBe("/");
    expect(POS_RECEIPTS_ROUTE).toBe("/receipts");
    expect(POS_SHOP_ROUTE).toBe("/office");
  });
});
