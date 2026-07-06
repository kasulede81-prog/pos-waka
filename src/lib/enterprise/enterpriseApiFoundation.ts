import type { EnterpriseApiDomain, EnterpriseApiEndpoint } from "../../types/enterprise";

/** Internal enterprise API registry — not exposed as public HTTP (Phase 10 foundation). */
export const ENTERPRISE_API_REGISTRY: EnterpriseApiEndpoint[] = [
  { domain: "sales", operation: "list", version: "v1", shopScoped: true, orgScoped: true },
  { domain: "sales", operation: "aggregate", version: "v1", shopScoped: false, orgScoped: true },
  { domain: "inventory", operation: "transfer", version: "v1", shopScoped: true, orgScoped: true },
  { domain: "inventory", operation: "stock_levels", version: "v1", shopScoped: true, orgScoped: true },
  { domain: "purchases", operation: "purchase_orders", version: "v1", shopScoped: false, orgScoped: true },
  { domain: "customers", operation: "list", version: "v1", shopScoped: true, orgScoped: true },
  { domain: "patients", operation: "list", version: "v1", shopScoped: true, orgScoped: true },
  { domain: "hospitality", operation: "floor_status", version: "v1", shopScoped: true, orgScoped: true },
  { domain: "staff", operation: "members", version: "v1", shopScoped: true, orgScoped: true },
  { domain: "devices", operation: "health", version: "v1", shopScoped: true, orgScoped: true },
  { domain: "reports", operation: "export", version: "v1", shopScoped: false, orgScoped: true },
  { domain: "authentication", operation: "session", version: "v1", shopScoped: false, orgScoped: false },
];

export function endpointsForDomain(domain: EnterpriseApiDomain): EnterpriseApiEndpoint[] {
  return ENTERPRISE_API_REGISTRY.filter((e) => e.domain === domain);
}

export function internalApiPath(endpoint: EnterpriseApiEndpoint): string {
  return `/internal/enterprise/${endpoint.version}/${endpoint.domain}/${endpoint.operation}`;
}
