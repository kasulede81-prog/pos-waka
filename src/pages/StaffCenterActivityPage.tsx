import { Link } from "react-router-dom";
import { ArrowRight, History, Percent, Receipt, RotateCcw, Shield } from "lucide-react";
import type { Language } from "../types";
import { t } from "../lib/i18n";
import { actorHasPermission } from "../lib/actorAuthorization";
import { useSessionActor } from "../context/SessionActorContext";
import { EnterpriseCard } from "../components/enterprise/EnterpriseCard";
import { Body } from "../components/enterprise/EnterpriseTypography";
import { WakaButton } from "../components/ui/wakaPrimitives";

type Props = { lang: Language };

/**
 * Staff Center → Activity (Phase 4).
 * Owner-facing gateway to existing Investigation / audit views — no new audit engine.
 */
export function StaffCenterActivityPage({ lang }: Props) {
  const actor = useSessionActor();
  const canActivity = actorHasPermission(actor, "owner.activity");

  const topics = [
    { key: "staffCenterActivitySales" as const, Icon: Receipt },
    { key: "staffCenterActivityRefunds" as const, Icon: RotateCcw },
    { key: "staffCenterActivityDiscounts" as const, Icon: Percent },
    { key: "staffCenterActivityLogins" as const, Icon: Shield },
  ];

  return (
    <div className="space-y-4" data-testid="staff-center-activity">
      <div>
        <h2 className="text-lg font-black text-foreground">{t(lang, "staffCenterActivityTitle")}</h2>
        <p className="mt-1 text-sm font-medium text-muted-foreground">{t(lang, "staffCenterActivitySub")}</p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        {topics.map(({ key, Icon }) => (
          <EnterpriseCard key={key} muted className="flex items-start gap-3 !p-4">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-waka-50 text-waka-700">
              <Icon className="h-4 w-4" aria-hidden />
            </div>
            <Body className="!text-sm !font-bold">{t(lang, key)}</Body>
          </EnterpriseCard>
        ))}
      </div>

      <EnterpriseCard muted className="!p-4">
        <Body className="!text-sm !font-medium text-muted-foreground">{t(lang, "staffCenterActivityHint")}</Body>
      </EnterpriseCard>

      {canActivity ? (
        <Link to="/office/audit-center" className="block">
          <WakaButton variant="primary" className="inline-flex w-full items-center justify-center gap-2">
            <History className="h-4 w-4" aria-hidden />
            {t(lang, "staffActivityOpenAuditCenter")}
            <ArrowRight className="h-4 w-4" aria-hidden />
          </WakaButton>
        </Link>
      ) : (
        <EnterpriseCard muted className="!p-4">
          <Body className="!text-sm !font-semibold text-muted-foreground">
            {t(lang, "staffCenterActivityNeedPerm")}
          </Body>
        </EnterpriseCard>
      )}
    </div>
  );
}
