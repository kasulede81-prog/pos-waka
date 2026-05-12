import { supabase } from "./supabase";

export type OrgBillingOfferRow = {
  id: string;
  organization_id: string;
  shop_id: string | null;
  amount_ugx: number;
  currency: string;
  message: string | null;
  status: string;
  created_at: string;
  created_by?: string | null;
  fulfilled_at?: string | null;
  cancelled_at?: string | null;
};

export async function fetchMyOrgBillingOffers(): Promise<OrgBillingOfferRow[]> {
  if (!supabase) return [];
  const { data, error } = await supabase.rpc("my_org_billing_offers");
  if (error || !Array.isArray(data)) return [];
  return data as OrgBillingOfferRow[];
}

export async function ownerClaimOrgBillingOfferPaid(offerId: string): Promise<{ ok: boolean; message?: string }> {
  if (!supabase) return { ok: false, message: "Offline" };
  const { data, error } = await supabase.rpc("owner_org_billing_offer_claim_paid", { p_offer_id: offerId });
  if (error) return { ok: false, message: error.message };
  const j = (data ?? {}) as { ok?: boolean; error?: string };
  if (j.ok) return { ok: true };
  return { ok: false, message: j.error ?? "Could not update offer." };
}
