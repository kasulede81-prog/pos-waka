import type { Language } from "../../../../types";
import { t } from "../../../../lib/i18n";

export function productNameFromPayload(
  lang: Language,
  payload: Record<string, unknown>,
  productById: Map<string, { name: string }>,
): string {
  const id = typeof payload.productId === "string" ? payload.productId : "";
  const fromMap = id ? productById.get(id)?.name : undefined;
  const n = typeof payload.name === "string" ? payload.name : typeof payload.productName === "string" ? payload.productName : "";
  return fromMap ?? n ?? t(lang, "productUnnamed");
}
