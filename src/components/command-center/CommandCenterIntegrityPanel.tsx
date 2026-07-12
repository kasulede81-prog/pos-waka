import { Link } from "react-router-dom";
import clsx from "clsx";
import type { Language } from "../../types";
import { t, tTemplate } from "../../lib/i18n";
import type { IntegritySignal } from "../../lib/ownerCommandCenterBuilders";
import { EnterpriseCard } from "../enterprise/EnterpriseCard";
import { Caption, SectionTitle } from "../enterprise/EnterpriseTypography";
import { statusTokens } from "../../lib/statusTokens";
import { Shield } from "lucide-react";

type Props = {
  lang: Language;
  signals: IntegritySignal[];
};

function signalTone(status: IntegritySignal["status"]): keyof typeof statusTokens {
  if (status === "critical") return "danger";
  if (status === "warning") return "warning";
  return "success";
}

export function CommandCenterIntegrityPanel({ lang, signals }: Props) {
  return (
    <EnterpriseCard
      title={t(lang, "cmdCenterIntegrityTitle")}
      subtitle={t(lang, "ownerIntegritySub")}
      actions={
        <Link to="/office/audit-center" className="text-[11px] font-black text-waka-700">
          {t(lang, "cmdCenterInvestigation")} →
        </Link>
      }
    >
      <ul className="grid gap-2 sm:grid-cols-2">
        {signals.map((sig) => {
          const tone = signalTone(sig.status);
          return (
            <li key={sig.id}>
              <Link
                to={sig.actionTo}
                className={clsx(
                  "flex min-h-[56px] items-center gap-3 rounded-2xl border px-3 py-2 transition active:scale-[0.99]",
                  statusTokens[tone].banner,
                  statusTokens[tone].badgeRing,
                )}
              >
                <span className={clsx("flex h-8 w-8 shrink-0 items-center justify-center rounded-xl", statusTokens[tone].icon)}>
                  <Shield className="h-4 w-4" aria-hidden />
                </span>
                <div className="min-w-0 flex-1">
                  <SectionTitle as="p" className="!text-sm">{t(lang, sig.labelKey)}</SectionTitle>
                  <Caption className="truncate normal-case">
                    {sig.detailVars ? tTemplate(lang, sig.detailKey, sig.detailVars) : t(lang, sig.detailKey)}
                  </Caption>
                </div>
              </Link>
            </li>
          );
        })}
      </ul>
    </EnterpriseCard>
  );
}
