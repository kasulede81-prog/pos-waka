/** Internal EFRIS submission states (WAKA-owned). Not URA API enums. */
export const EFRIS_STATES = [
  "NOT_REQUIRED",
  "PENDING",
  "SUBMITTED",
  "ACCEPTED",
  "FAILED",
  "RETRY_REQUIRED",
] as const;

export type EfrisState = (typeof EFRIS_STATES)[number];

export const EFRIS_PROVIDER_NOT_CONFIGURED = "EFRIS_PROVIDER_NOT_CONFIGURED";

export function isEfrisState(value: string): value is EfrisState {
  return (EFRIS_STATES as readonly string[]).includes(value);
}
