/**
 * @deprecated Isolate-local Map limiter — NOT used for production enforcement.
 * Durable Postgres limiter: publicCardDurableRateLimit.ts
 *
 * Kept only so accidental imports fail loudly rather than silently bypassing F1/W2.
 */

export function checkRateLimit(
  _key: string,
  _limit: number,
  _windowMs: number,
  _nowMs?: number,
): never {
  throw new Error(
    "isolate-local publicCardRateLimit is disabled; use publicCardDurableRateLimit (Postgres)",
  );
}

export function clientRateKey(_req: Request, _prefix: string): never {
  throw new Error(
    "isolate-local publicCardRateLimit is disabled; use publicCardDurableRateLimit (Postgres)",
  );
}
