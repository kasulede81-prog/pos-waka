import type { Language } from "../types";
import { useMarkOwnerRisksReviewed } from "../hooks/useMarkOwnerRisksReviewed";
import { EnterpriseInvestigationShell } from "../features/investigation-center/EnterpriseInvestigationShell";

/** Business-agnostic Enterprise Investigation Center entry point. */
export function AuditCenterPage({ lang }: { lang: Language }) {
  useMarkOwnerRisksReviewed();
  return <EnterpriseInvestigationShell lang={lang} />;
}
