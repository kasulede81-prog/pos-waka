/**
 * Debt payment cloud push — payload + result interpretation.
 * Durable identity is DebtPayment.id only (never regenerated on retry).
 */

import type { DebtPayment } from "../types";

export type DebtPaymentRpcPayload = {
  payment_id: string;
  customer_id: string;
  amount_ugx: number;
  created_at: string;
  metadata?: Record<string, unknown>;
};

/** Build RPC payload. Intentionally omits expected_balance_ugx (concurrency uses row lock + PK). */
export function buildDebtPaymentRpcPayload(payment: DebtPayment): DebtPaymentRpcPayload {
  return {
    payment_id: payment.id,
    customer_id: payment.customerId,
    amount_ugx: payment.amountUgx,
    created_at: payment.createdAt,
  };
}

export type DebtPaymentRpcRaw = {
  ok?: boolean;
  idempotent?: boolean;
  error?: string;
  new_balance_ugx?: number;
  server_balance_ugx?: number;
  payment_id?: string;
} | null;

export type DebtPaymentPushDecision = {
  /** True → ACK / remove queue op. */
  ack: boolean;
  /** Optional authoritative balance to adopt locally. */
  applyBalanceUgx?: number;
  error?: string;
  idempotent?: boolean;
};

/**
 * Interpret shop_push_debt_payment result.
 * Never rebases expected balance or regenerates payment ID on failure.
 */
export function interpretDebtPaymentRpcResult(data: DebtPaymentRpcRaw): DebtPaymentPushDecision {
  if (data?.ok === true) {
    const bal =
      data.new_balance_ugx != null && Number.isFinite(Number(data.new_balance_ugx))
        ? Math.max(0, Math.floor(Number(data.new_balance_ugx)))
        : undefined;
    return {
      ack: true,
      applyBalanceUgx: bal,
      idempotent: data.idempotent === true,
    };
  }

  const error = String(data?.error ?? "unknown");
  // Fail closed — do not mutate into a different payment or rebase expected balance.
  return { ack: false, error };
}

/** Queue payload for a debt payment — paymentId must remain stable across retries. */
export function debtPaymentQueuePayload(paymentId: string): { kind: "debt_payment"; paymentId: string } {
  return { kind: "debt_payment", paymentId };
}
