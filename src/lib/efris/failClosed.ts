import { EFRIS_PROVIDER_NOT_CONFIGURED } from "./types";
import { isOfficialEfrisProviderConfigured } from "./providerConfig";

export type EfrisSubmitDecision =
  | {
      action: "reject";
      code: "unauthorized" | "forbidden" | "invalid_body" | "efris_disabled" | "outbox_not_found";
    }
  | { action: "fail_closed"; code: typeof EFRIS_PROVIDER_NOT_CONFIGURED };

/**
 * Server-side submit decision. Never returns accept/submit-to-URA.
 * Official provider configuration is absent in Phase 1.
 */
export function decideEfrisSubmit(input: {
  authenticated: boolean;
  shopAuthorized: boolean;
  shopId: string | null | undefined;
  saleId: string | null | undefined;
  enabled: boolean | null;
  outboxExists: boolean;
}): EfrisSubmitDecision {
  if (!input.authenticated) return { action: "reject", code: "unauthorized" };
  const shopId = typeof input.shopId === "string" ? input.shopId.trim() : "";
  const saleId = typeof input.saleId === "string" ? input.saleId.trim() : "";
  if (!shopId || !saleId) return { action: "reject", code: "invalid_body" };
  if (!input.shopAuthorized) return { action: "reject", code: "forbidden" };
  if (input.enabled !== true) return { action: "reject", code: "efris_disabled" };
  if (!input.outboxExists) return { action: "reject", code: "outbox_not_found" };
  // Phase 1: official URA provider is never configured. Never accept or call URA.
  if (!isOfficialEfrisProviderConfigured()) {
    return { action: "fail_closed", code: EFRIS_PROVIDER_NOT_CONFIGURED };
  }
  return { action: "fail_closed", code: EFRIS_PROVIDER_NOT_CONFIGURED };
}
