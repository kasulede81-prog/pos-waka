/**
 * Cheap Google Wallet env presence check (no Deno, no PEM, no RSA).
 * Shared by Edge public-card responses and unit tests.
 */

export function googleWalletEnvLooksConfigured(
  issuerId: string,
  serviceAccountJson: string,
): boolean {
  const id = issuerId.trim();
  const raw = serviceAccountJson.trim();
  if (!id || !raw) return false;
  // Key-name presence only — never JSON.parse the SA blob or import PEM.
  return raw.includes('"client_email"') && raw.includes('"private_key"');
}
