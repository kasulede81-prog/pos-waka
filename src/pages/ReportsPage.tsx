import type { Language } from "../types";
import { EnterpriseReportsShell } from "../features/business-analytics/EnterpriseReportsShell";

/** Business-agnostic Enterprise Reports entry point. */
export function ReportsPage({ lang }: { lang: Language }) {
  return <EnterpriseReportsShell lang={lang} />;
}
