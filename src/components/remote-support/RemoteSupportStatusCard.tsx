import { MonitorSmartphone } from "lucide-react";
import type { Language } from "../../types";
import { t } from "../../lib/i18n";
import { openPosNeedHelpForm } from "../../lib/posSupportRequest";
import { resolveRemoteSupportStatusCardModel } from "../../lib/remoteSupport/statusCard";
import { useRemoteSupportStatusCard } from "../../hooks/useRemoteSupportStatusCard";
import { useRemoteSupportPlatformEnabled } from "../../hooks/useRemoteSupportPlatformEnabled";
import { useSubscription } from "../../context/SubscriptionContext";
import { EnterpriseCard } from "../enterprise/EnterpriseCard";
import { healthStatusBadge, healthStatusDot, statusTokens } from "../../lib/statusTokens";
import type { RemoteSupportStatusTone } from "../../lib/remoteSupport/statusCard";

type Props = { lang: Language };

function toneClasses(tone: RemoteSupportStatusTone): { badge: string; dot: string } {
  if (tone === "ok") return { badge: healthStatusBadge("ok"), dot: healthStatusDot("ok") };
  if (tone === "warning" || tone === "critical") {
    return { badge: healthStatusBadge("warning"), dot: healthStatusDot("warning") };
  }
  return { badge: statusTokens.info.badgeRing, dot: statusTokens.info.dot };
}

export function RemoteSupportStatusCard({ lang }: Props) {
  const { snapshot } = useSubscription();
  const shopId = snapshot.kind === "remote" ? snapshot.row.shop_id : null;
  const { enabled: platformEnabled, loading: switchLoading } = useRemoteSupportPlatformEnabled();
  const { inbox, uiPhase, loading, error, deviceId, electronDesktop } = useRemoteSupportStatusCard(shopId);
  const model = resolveRemoteSupportStatusCardModel({
    inbox,
    uiPhase,
    deviceId,
    electronDesktop,
  });
  const chrome = toneClasses(model.tone);

  if (switchLoading || !platformEnabled) return null;

  return (
    <EnterpriseCard
      title={t(lang, "remoteSupportStatusTitle")}
      subtitle={t(lang, "remoteSupportStatusSub")}
    >
      {loading ? (
        <p className="text-sm font-semibold text-muted-foreground">{t(lang, "remoteSupportStatusLoading")}</p>
      ) : error ? (
        <p className="text-sm font-semibold text-danger">{t(lang, "remoteSupportStatusError")}</p>
      ) : (
        <div className="space-y-3">
          <div className={`inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-bold ${chrome.badge}`}>
            <span className={`h-2 w-2 rounded-full ${chrome.dot}`} aria-hidden />
            {t(lang, model.headlineKey)}
          </div>
          <p className="text-sm font-medium text-muted-foreground">{t(lang, model.detailKey)}</p>
          {model.deviceLabel ? (
            <p className="flex items-center gap-2 text-xs font-semibold text-foreground">
              <MonitorSmartphone className="h-4 w-4" strokeWidth={2.25} aria-hidden />
              {t(lang, "remoteSupportDevice")}: {model.deviceLabel}
            </p>
          ) : (
            <p className="text-xs font-semibold text-muted-foreground">{t(lang, "remoteSupportStatusNoDevice")}</p>
          )}
        </div>
      )}
      <button
        type="button"
        onClick={() => openPosNeedHelpForm()}
        className="mt-4 min-h-[48px] w-full rounded-2xl bg-waka-600 text-sm font-black text-white active:bg-waka-700"
      >
        {t(lang, "remoteSupportRequestCta")}
      </button>
    </EnterpriseCard>
  );
}
