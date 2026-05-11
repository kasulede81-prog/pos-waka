/** NFC / card terminal abstraction (future Tap & Pay integrations). */
export async function requestCardPayment(_amountUgx: number): Promise<{ ok: boolean; error?: string }> {
  return { ok: false, error: "Payment terminal not configured." };
}
