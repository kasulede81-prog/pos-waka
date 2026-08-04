import { getActiveAccountKey } from "../../offline/accountScope";

/** Local tenancy key for Vision registry until cloud shopId is always present. */
export function resolveVisionShopScopeId(): string {
  return getActiveAccountKey() ?? "local";
}
