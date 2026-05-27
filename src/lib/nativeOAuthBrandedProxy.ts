import { Capacitor, CapacitorHttp } from "@capacitor/core";
import { WAKA_POS_URL } from "../config/company";

/** Supabase → Google always uses this callback unless you set a Supabase custom auth domain. */
export function getSupabaseOAuthCallbackUrl(): string | null {
  const supabaseRaw = import.meta.env.VITE_SUPABASE_URL?.trim().replace(/\/$/, "");
  if (!supabaseRaw) return null;
  try {
    return `${new URL(supabaseRaw).origin}/auth/v1/callback`;
  } catch {
    return null;
  }
}

function readLocationHeader(headers: Record<string, string> | undefined): string | null {
  if (!headers) return null;
  const entry = Object.entries(headers).find(([key]) => key.toLowerCase() === "location");
  return entry?.[1] ?? null;
}

function supabaseAnonHeaders(): Record<string, string> {
  const anon = import.meta.env.VITE_SUPABASE_ANON_KEY?.trim();
  if (!anon) return {};
  return { apikey: anon, Authorization: `Bearer ${anon}` };
}

/**
 * GET authorize without following redirects (native HTTP on device — WebView fetch is CORS-blocked).
 */
async function fetchGoogleOAuthLocationFromAuthorize(authorizeUrl: string): Promise<string | null> {
  const headers = supabaseAnonHeaders();

  if (Capacitor.isNativePlatform()) {
    const res = await CapacitorHttp.get({
      url: authorizeUrl,
      headers,
      disableRedirects: true,
    });
    if (res.status >= 300 && res.status < 400) {
      return readLocationHeader(res.headers as Record<string, string>);
    }
    return null;
  }

  try {
    const res = await fetch(authorizeUrl, { method: "GET", redirect: "manual", headers });
    if (res.status >= 300 && res.status < 400) {
      return res.headers.get("Location");
    }
  } catch {
    /* fall through */
  }
  return null;
}

/**
 * Resolve the URL to open in the system browser for native Google OAuth.
 *
 * Opens Google's URL exactly as Supabase generated it (redirect_uri stays on *.supabase.co).
 * Do not rewrite redirect_uri to pos.waka.ug — that breaks `exchangeCodeForSession` ("Unable to exchange external code").
 */
export async function resolveNativeGoogleOAuthBrowserUrl(authorizeUrl: string): Promise<string> {
  const brandedAuthorize = rewriteNativeOAuthAuthorizeUrl(authorizeUrl);
  const location = await fetchGoogleOAuthLocationFromAuthorize(brandedAuthorize);
  if (location?.includes("accounts.google.com")) {
    return location;
  }
  return brandedAuthorize;
}

/**
 * Route native authorize through `pos.waka.ug` (Vercel `/auth/v1` proxy) before resolving Google URL.
 */
export function rewriteNativeOAuthAuthorizeUrl(providerUrl: string): string {
  const supabaseRaw = import.meta.env.VITE_SUPABASE_URL?.trim().replace(/\/$/, "");
  if (!supabaseRaw) return providerUrl;

  const rawBrand = WAKA_POS_URL.trim().replace(/\/$/, "");

  try {
    const supOrigin = new URL(supabaseRaw).origin;
    if (!rawBrand.startsWith("https:")) return providerUrl;
    const brand = new URL(rawBrand).origin;

    const brandHost = new URL(brand).hostname;
    const supHost = new URL(supOrigin).hostname;
    if (brandHost === supHost) return providerUrl;

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
