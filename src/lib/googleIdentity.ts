/**
 * Google Sign-In via Google Identity Services (GIS) — popup UX only.
 *
 * Flow: custom Waka button → GIS popup → ID token in JS callback → Supabase signInWithIdToken.
 * Does NOT use signInWithOAuth, redirectTo, or *.supabase.co/auth/v1/callback.
 *
 * Google Cloud (Web client):
 * - Authorized JavaScript origins: https://waka-ug.com , http://localhost:5173
 * - Authorized redirect URIs: NOT required for GIS popup (do not add supabase.co)
 *
 * Supabase → Auth → Google → Authorized Client IDs: same Web Client ID
 */

import { authDevLog } from "./authConfig";

const GSI_SCRIPT = "https://accounts.google.com/gsi/client";

type GoogleCredentialResponse = {
  credential?: string;
  select_by?: string;
};

type GoogleIdApi = {
  initialize: (config: Record<string, unknown>) => void;
  renderButton: (parent: HTMLElement, options: Record<string, unknown>) => void;
  cancel: () => void;
  disableAutoSelect: () => void;
};

declare global {
  interface Window {
    google?: {
      accounts?: {
        id?: GoogleIdApi;
      };
    };
  }
}

let scriptPromise: Promise<void> | null = null;
let initializedClientId: string | null = null;
let pendingSignIn: {
  resolve: (token: string) => void;
  reject: (err: Error) => void;
} | null = null;

function loadGoogleScript(): Promise<void> {
  if (typeof window === "undefined") {
    return Promise.reject(new Error("Google Sign-In is only available in the browser."));
  }
  if (window.google?.accounts?.id) return Promise.resolve();
  if (scriptPromise) return scriptPromise;

  scriptPromise = new Promise((resolve, reject) => {
    const existing = document.querySelector(`script[src="${GSI_SCRIPT}"]`);
    if (existing) {
      existing.addEventListener("load", () => resolve(), { once: true });
      existing.addEventListener("error", () => reject(new Error("Failed to load Google Sign-In")), { once: true });
      return;
    }
    const script = document.createElement("script");
    script.src = GSI_SCRIPT;
    script.async = true;
    script.defer = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("Failed to load Google Sign-In. Check your connection."));
    document.head.appendChild(script);
  });

  return scriptPromise;
}

export function getGoogleOAuthClientId(): string | null {
  const id = import.meta.env.VITE_GOOGLE_OAUTH_CLIENT_ID?.trim();
  return id || null;
}

export function requireGoogleOAuthClientId(): string {
  const id = getGoogleOAuthClientId();
  if (!id) {
    throw new Error(
      "Google sign-in is not configured. Set VITE_GOOGLE_OAUTH_CLIENT_ID (Web client ID from Google Cloud).",
    );
  }
  return id;
}

function handleCredentialResponse(response: GoogleCredentialResponse): void {
  if (!pendingSignIn) return;
  const { resolve, reject } = pendingSignIn;
  pendingSignIn = null;

  if (response.credential) {
    authDevLog("log", "Google ID token received (GIS popup)", { select_by: response.select_by });
    resolve(response.credential);
    return;
  }
  reject(new Error("Google sign-in was cancelled."));
}

function ensureGoogleIdentityInitialized(clientId: string): GoogleIdApi {
  const googleId = window.google?.accounts?.id;
  if (!googleId) {
    throw new Error("Google Sign-In is not available on this device.");
  }

  if (initializedClientId !== clientId) {
    googleId.initialize({
      client_id: clientId,
      callback: handleCredentialResponse,
      ux_mode: "popup",
      auto_select: false,
      cancel_on_tap_outside: true,
      context: "signin",
      itp_support: true,
    });
    try {
      googleId.disableAutoSelect();
    } catch {
      /* ignore */
    }
    initializedClientId = clientId;
    authDevLog("log", "GIS initialized (popup mode)", { clientId: `${clientId.slice(0, 12)}…` });
  }

  return googleId;
}

/** Hidden host for GIS renderButton — popup opens on programmatic click. */
let buttonHost: HTMLDivElement | null = null;

function getButtonHost(): HTMLDivElement {
  if (!buttonHost) {
    buttonHost = document.createElement("div");
    buttonHost.setAttribute("aria-hidden", "true");
    buttonHost.style.cssText =
      "position:fixed;width:1px;height:1px;left:-9999px;top:0;overflow:hidden;opacity:0;pointer-events:none";
    document.body.appendChild(buttonHost);
  }
  return buttonHost;
}

/**
 * Opens the Google Sign-In popup and returns an ID token (JWT) for Supabase signInWithIdToken.
 */
export async function requestGoogleIdToken(clientId?: string): Promise<string> {
  const resolvedClientId = clientId ?? requireGoogleOAuthClientId();
  await loadGoogleScript();

  if (pendingSignIn) {
    throw new Error("Google sign-in is already in progress.");
  }

  const googleId = ensureGoogleIdentityInitialized(resolvedClientId);
  const host = getButtonHost();
  host.replaceChildren();

  return new Promise<string>((resolve, reject) => {
    const timeoutId = window.setTimeout(() => {
      if (pendingSignIn) {
        pendingSignIn.reject(new Error("Google sign-in timed out. Please try again."));
        pendingSignIn = null;
      }
    }, 120_000);

    pendingSignIn = {
      resolve: (token) => {
        window.clearTimeout(timeoutId);
        resolve(token);
      },
      reject: (err) => {
        window.clearTimeout(timeoutId);
        try {
          googleId.cancel();
        } catch {
          /* ignore */
        }
        reject(err);
      },
    };

    googleId.renderButton(host, {
      type: "standard",
      theme: "outline",
      size: "large",
      text: "signin_with",
      width: 280,
    });

    window.requestAnimationFrame(() => {
      const btn = host.querySelector('[role="button"]') as HTMLElement | null;
      if (!btn) {
        pendingSignIn?.reject(
          new Error("Google Sign-In could not start. Allow pop-ups for this site and try again."),
        );
        pendingSignIn = null;
        return;
      }
      authDevLog("log", "Opening Google Sign-In popup");
      btn.click();
    });
  });
}
