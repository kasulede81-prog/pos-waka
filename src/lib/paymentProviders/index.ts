/**
 * Payment provider abstraction — Phase 17.4
 *
 * Stub implementations only. Future Payment Integration Phase will
 * replace stubs with live Flutterwave, Stripe, MTN MoMo, and Airtel Money adapters.
 */

import type { BillingCycle } from "../effectiveSubscription";
import type { SubscriptionPlanCode } from "../subscriptionEntitlements";

export type PaymentProviderId = "flutterwave" | "stripe" | "mtn_momo" | "airtel_money" | "manual";

export type PaymentInitInput = {
  shopId: string;
  organizationId: string;
  planCode: SubscriptionPlanCode;
  amountUgx: number;
  billingCycle: BillingCycle;
  customerEmail?: string | null;
  customerPhone?: string | null;
  metadata?: Record<string, string>;
};

export type PaymentInitResult = {
  ok: boolean;
  provider: PaymentProviderId;
  reference?: string;
  checkoutUrl?: string;
  message?: string;
};

export type PaymentVerifyInput = {
  externalReference: string;
  amountUgx?: number;
};

export type PaymentVerifyResult = {
  ok: boolean;
  verified: boolean;
  provider: PaymentProviderId;
  externalReference: string;
  message?: string;
};

export type RefundInput = {
  externalReference: string;
  amountUgx: number;
  reason?: string;
};

export type RefundResult = {
  ok: boolean;
  provider: PaymentProviderId;
  message?: string;
};

/**
 * PaymentProvider interface — implement for each gateway in the Payment Integration Phase.
 *
 * Lifecycle:
 * 1. `initPayment` — create checkout / payment request
 * 2. Provider webhook verifies payment
 * 3. Webhook handler calls `subscriptionEngine.onPaymentSuccess(...)`
 */
export interface PaymentProvider {
  readonly id: PaymentProviderId;
  readonly displayName: string;
  /** True when live SDK/API credentials are configured. */
  readonly isConfigured: boolean;
  initPayment(input: PaymentInitInput): Promise<PaymentInitResult>;
  verifyPayment(input: PaymentVerifyInput): Promise<PaymentVerifyResult>;
  refund(input: RefundInput): Promise<RefundResult>;
}

const NOT_IMPLEMENTED = "Payment provider not implemented — Phase 17.4 stub only.";

function stubResult(provider: PaymentProviderId): PaymentInitResult {
  return { ok: false, provider, message: NOT_IMPLEMENTED };
}

export class FlutterwaveProvider implements PaymentProvider {
  readonly id = "flutterwave" as const;
  readonly displayName = "Flutterwave";
  readonly isConfigured = false;

  async initPayment(_input: PaymentInitInput): Promise<PaymentInitResult> {
    return stubResult("flutterwave");
  }

  async verifyPayment(input: PaymentVerifyInput): Promise<PaymentVerifyResult> {
    return {
      ok: false,
      verified: false,
      provider: "flutterwave",
      externalReference: input.externalReference,
      message: NOT_IMPLEMENTED,
    };
  }

  async refund(_input: RefundInput): Promise<RefundResult> {
    return { ok: false, provider: "flutterwave", message: NOT_IMPLEMENTED };
  }
}

export class StripeProvider implements PaymentProvider {
  readonly id = "stripe" as const;
  readonly displayName = "Stripe";
  readonly isConfigured = false;

  async initPayment(_input: PaymentInitInput): Promise<PaymentInitResult> {
    return stubResult("stripe");
  }

  async verifyPayment(input: PaymentVerifyInput): Promise<PaymentVerifyResult> {
    return {
      ok: false,
      verified: false,
      provider: "stripe",
      externalReference: input.externalReference,
      message: NOT_IMPLEMENTED,
    };
  }

  async refund(_input: RefundInput): Promise<RefundResult> {
    return { ok: false, provider: "stripe", message: NOT_IMPLEMENTED };
  }
}

export class MtnMoMoProvider implements PaymentProvider {
  readonly id = "mtn_momo" as const;
  readonly displayName = "MTN Mobile Money";
  readonly isConfigured = false;

  async initPayment(_input: PaymentInitInput): Promise<PaymentInitResult> {
    return stubResult("mtn_momo");
  }

  async verifyPayment(input: PaymentVerifyInput): Promise<PaymentVerifyResult> {
    return {
      ok: false,
      verified: false,
      provider: "mtn_momo",
      externalReference: input.externalReference,
      message: NOT_IMPLEMENTED,
    };
  }

  async refund(_input: RefundInput): Promise<RefundResult> {
    return { ok: false, provider: "mtn_momo", message: NOT_IMPLEMENTED };
  }
}

export class AirtelMoneyProvider implements PaymentProvider {
  readonly id = "airtel_money" as const;
  readonly displayName = "Airtel Money";
  readonly isConfigured = false;

  async initPayment(_input: PaymentInitInput): Promise<PaymentInitResult> {
    return stubResult("airtel_money");
  }

  async verifyPayment(input: PaymentVerifyInput): Promise<PaymentVerifyResult> {
    return {
      ok: false,
      verified: false,
      provider: "airtel_money",
      externalReference: input.externalReference,
      message: NOT_IMPLEMENTED,
    };
  }

  async refund(_input: RefundInput): Promise<RefundResult> {
    return { ok: false, provider: "airtel_money", message: NOT_IMPLEMENTED };
  }
}

export const PAYMENT_PROVIDERS: PaymentProvider[] = [
  new FlutterwaveProvider(),
  new StripeProvider(),
  new MtnMoMoProvider(),
  new AirtelMoneyProvider(),
];

export function getPaymentProvider(id: PaymentProviderId): PaymentProvider | undefined {
  return PAYMENT_PROVIDERS.find((p) => p.id === id);
}
