import { describe, expect, it } from "vitest";
import { FlutterwaveProvider, PAYMENT_PROVIDERS, getPaymentProvider } from "./index";

describe("paymentProviders", () => {
  it("registers stub providers without SDK integration", () => {
    expect(PAYMENT_PROVIDERS).toHaveLength(4);
    expect(PAYMENT_PROVIDERS.every((p) => !p.isConfigured)).toBe(true);
  });

  it("Flutterwave stub returns not implemented", async () => {
    const fw = new FlutterwaveProvider();
    const init = await fw.initPayment({
      shopId: "s1",
      organizationId: "o1",
      planCode: "business",
      amountUgx: 56000,
      billingCycle: "monthly",
    });
    expect(init.ok).toBe(false);
    expect(init.message).toContain("not implemented");
  });

  it("getPaymentProvider resolves by id", () => {
    expect(getPaymentProvider("stripe")?.displayName).toBe("Stripe");
  });
});
