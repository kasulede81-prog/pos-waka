/**
 * Official URA EFRIS provider is not configured in Phase 1.
 * Do not read invented URLs, API keys, or hostnames from the environment.
 */
export function isOfficialEfrisProviderConfigured(): boolean {
  return false;
}

export const EFRIS_PROVIDER_NOT_CONFIGURED = "EFRIS_PROVIDER_NOT_CONFIGURED";
