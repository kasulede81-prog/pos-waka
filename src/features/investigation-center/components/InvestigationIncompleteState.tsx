import { EnterpriseSkeletonKpiGrid, EnterpriseSkeletonList } from "../../../components/enterprise/EnterpriseSkeleton";
import type { Language } from "../../../types";
import { t } from "../../../lib/i18n";

type Props = {
  lang: Language;
  variant?: "kpis" | "list";
};

export function InvestigationIncompleteState({ lang, variant = "list" }: Props) {
  return (
    <div className="space-y-3" role="status" aria-live="polite" aria-busy="true">
      <p className="px-0.5 text-sm font-semibold text-muted-foreground">{t(lang, "icActivityLoading")}</p>
      {variant === "kpis" ? <EnterpriseSkeletonKpiGrid count={4} /> : <EnterpriseSkeletonList count={4} />}
    </div>
  );
}
