import type { Language } from "../../../types";
import { t } from "../../../lib/i18n";
import type { ReportsBusinessMode } from "./reportWidgetTypes";

export function resolveReportsPageTitle(lang: Language, mode: ReportsBusinessMode): string {
  if (mode === "wholesale") return t(lang, "wholesaleReportsHubTitle");
  if (mode === "pharmacy") return t(lang, "pharmacyReportsHubTitle");
  if (mode === "hospitality") return t(lang, "hospitalityReportsPageTitle");
  return t(lang, "baPageTitle");
}
