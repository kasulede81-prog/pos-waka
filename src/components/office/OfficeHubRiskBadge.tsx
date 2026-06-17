import type { Language } from "../../types";
import { useOwnerRiskCards } from "../../hooks/useOwnerRiskCards";
import { OfficeNeedsAttentionBadge } from "./OfficeNeedsAttentionBadge";

export function OfficeHubRiskBadge({ lang }: { lang: Language }) {
  const { unseenCount } = useOwnerRiskCards(lang, false);
  return <OfficeNeedsAttentionBadge lang={lang} totalCount={unseenCount} />;
}
