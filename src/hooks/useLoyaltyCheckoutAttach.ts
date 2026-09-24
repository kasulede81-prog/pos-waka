import { useCallback, useEffect, useRef, useState } from "react";
import { resolveShopCtx } from "../offline/cloudSync";
import { decodeLoyaltyQrPayload, lookupAccountByToken } from "../lib/loyalty/loyaltyEnrollment";

export type LoyaltyAttachState =
  | { status: "idle" }
  | { status: "resolving" }
  | { status: "error"; errorKey: string };

export type AttachedLoyaltyMember = {
  accountId: string;
  customerId: string;
  customerName: string;
  customerPhone: string | null;
  balancePoints: number;
  membershipActive: boolean;
  membershipExpiresOn: string | null;
};

type Options = {
  /** Called once a scanned token resolves to a member of THIS shop. */
  onAttach: (member: AttachedLoyaltyMember) => void;
};

/**
 * Resolve a scanned/tapped loyalty token and attach the member to the sale in
 * progress (Phase 2).
 *
 * The single attachment path for every identification channel — QR today, NFC
 * later — so there is exactly one place that turns a token into a customer.
 * No loyalty logic is duplicated here: resolution is the existing shop-scoped,
 * RLS-checked `loyalty_account_by_token` RPC, and points are never touched.
 */
export function useLoyaltyCheckoutAttach({ onAttach }: Options) {
  const [state, setState] = useState<LoyaltyAttachState>({ status: "idle" });
  const shopIdRef = useRef<string | null>(null);
  // Held in a ref so attachFromScan stays stable for the scanner effects that
  // depend on it; only ever read from the async handler, never during render.
  const onAttachRef = useRef(onAttach);
  useEffect(() => {
    onAttachRef.current = onAttach;
  }, [onAttach]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const ctx = await resolveShopCtx();
      if (!cancelled) shopIdRef.current = ctx?.shopId ?? null;
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const clearError = useCallback(() => setState({ status: "idle" }), []);

  /**
   * Returns true when `scanned` was a loyalty code — whether or not it resolved.
   * The caller uses that to stop treating the scan as a product barcode.
   */
  const attachFromScan = useCallback(async (scanned: string): Promise<boolean> => {
    const token = decodeLoyaltyQrPayload(scanned);
    if (!token) return false;

    const shopId = shopIdRef.current ?? (await resolveShopCtx())?.shopId ?? null;
    if (!shopId) {
      setState({ status: "error", errorKey: "loyaltyScanUnavailable" });
      return true;
    }
    shopIdRef.current = shopId;

    setState({ status: "resolving" });
    const result = await lookupAccountByToken(shopId, token);
    if (!result.ok) {
      setState({
        status: "error",
        errorKey: result.error === "not_found" ? "loyaltyScanNotFound" : "loyaltyScanFailed",
      });
      return true;
    }
    if (result.status === "disabled") {
      setState({ status: "error", errorKey: "loyaltyScanDisabled" });
      return true;
    }

    setState({ status: "idle" });
    onAttachRef.current({
      accountId: result.accountId,
      customerId: result.customerId,
      customerName: result.customerName,
      customerPhone: result.customerPhone,
      balancePoints: result.balancePoints,
      membershipActive: result.membershipActive,
      membershipExpiresOn: result.membershipExpiresOn,
    });
    return true;
  }, []);

  return { state, attachFromScan, clearError };
}
