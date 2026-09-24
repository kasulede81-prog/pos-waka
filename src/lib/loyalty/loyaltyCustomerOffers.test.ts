import { describe, expect, it } from "vitest";
import { composeOfferPointsClient } from "./loyaltyCustomerOffers";

describe("composeOfferPointsClient", () => {
  it("applies one multiplier then additive flats", () => {
    expect(composeOfferPointsClient(100, 3, 150)).toBe(450);
    expect(composeOfferPointsClient(10, 2, 0)).toBe(20);
    expect(composeOfferPointsClient(0, 5, 100)).toBe(100);
  });
});
