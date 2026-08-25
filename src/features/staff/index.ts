/**
 * WAKA Staff feature boundary (Phase 2).
 *
 * Stable import surface — re-exports only. Prefer:
 *   import { … } from "../features/staff"
 * or a subdomain:
 *   import { … } from "../features/staff/identity"
 *
 * Existing `src/lib/*` and `src/components/staff/*` paths remain valid.
 * Do not change behavior here — see docs/WAKA_STAFF_SIMPLE_MODEL.md.
 */
export * from "./identity";
export * from "./roles";
export * from "./sessions";
export * from "./activity";
export * from "./management";
