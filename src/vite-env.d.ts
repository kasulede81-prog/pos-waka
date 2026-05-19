/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/client" />

interface ImportMetaEnv {
  readonly MODE: string;
  readonly DEV: boolean;
  readonly PROD: boolean;
  /** Supabase project URL (public) */
  readonly VITE_SUPABASE_URL?: string;
  /** Supabase anon key — safe for browser; never use service role here */
  readonly VITE_SUPABASE_ANON_KEY?: string;
  /** Canonical origin for auth redirects (no trailing slash), e.g. https://pos.example.com */
  readonly VITE_APP_URL?: string;
  /** PWA display name override */
  readonly VITE_APP_NAME?: string;
  readonly VITE_APP_SHORT_NAME?: string;
  /** Release label (from package.json or CI override) */
  readonly VITE_APP_VERSION?: string;
  /** Optional HTTPS endpoint for reportMonitoringEvent JSON POST */
  readonly VITE_MONITORING_INGEST_URL?: string;
  /**
   * Google OAuth Web client ID (public). Used for branded Sign in with Google (GIS → Supabase signInWithIdToken).
   * Same Client ID must be listed in Supabase Auth → Google → Authorized Client IDs.
   */
  readonly VITE_GOOGLE_OAUTH_CLIENT_ID?: string;
  /** Mapbox public token for internal ops live map (tiles + geocoder only in-app) */
  readonly VITE_MAPBOX_ACCESS_TOKEN?: string;
  /** Preferred alias for Mapbox token (either this or VITE_MAPBOX_ACCESS_TOKEN may be set). */
  readonly VITE_MAPBOX_TOKEN?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
