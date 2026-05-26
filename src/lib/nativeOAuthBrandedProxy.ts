import { WAKA_POS_URL } from "../config/company";

/**
 * On Android/iOS OAuth, Google's "Continue to …" shows the OAuth redirect host.
 * If we open Supabase directly, Google shows *.supabase.co.
 *
 * When `pos.waka.ug` (or `VITE_APP_URL`) proxies `/auth/v1/*` to the real Supabase project,
 * we rewrite the authorize URL host so Google shows **pos.waka.ug**.
 *
 * Requires:
 * - Vercel rewrite (see `vercel.json`) or equivalent reverse proxy at that origin
 * - Google Cloud → Authorized redirect URIs: `https://pos.waka.ug/auth/v1/callback`
 */
export function rewriteNativeOAuthAuthorizeUrl(providerUrl: string): string {
  const supabaseRaw = import.meta.env.VITE_SUPABASE_URL?.trim().replace(/\/$/, "");
  if (!supabaseRaw) return providerUrl;

  /** Always brand through pos.waka.ug (Vercel `/auth/v1` proxy + Google redirect URI). */
  const rawBrand = WAKA_POS_URL.trim().replace(/\/$/, "");

  try {
    const supOrigin = new URL(supabaseRaw).origin;
    if (!rawBrand.startsWith("https:")) return providerUrl;
    const brand = new URL(rawBrand).origin;

    const brandHost = new URL(brand).hostname;
    const supHost = new URL(supOrigin).hostname;
    if (brandHost === supHost) return providerUrl;

    /** Don't rewrite local dev origins through a public proxy */
    if (brandHost === "localhost" || brandHost === "127.0.0.1") return providerUrl;

    if (!providerUrl.includes(supOrigin) && !providerUrl.includes(encodeURIComponent(supOrigin))) {
      return providerUrl;
    }

    let out = providerUrl;
    out = out.replaceAll(supOrigin, brand);
    out = out.replaceAll(encodeURIComponent(supOrigin), encodeURIComponent(brand));

    const supHostEnc = encodeURIComponent(supHost);
    const brandHostEnc = encodeURIComponent(brandHost);
    if (out.includes(supHostEnc)) {
      out = out.replaceAll(supHostEnc, brandHostEnc);
    }

    return out;
  } catch {
    return providerUrl;
  }
}
