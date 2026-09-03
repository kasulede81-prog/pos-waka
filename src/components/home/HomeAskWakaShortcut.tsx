import clsx from "clsx";
import { Sparkles } from "lucide-react";
import { useNavigate } from "react-router-dom";
import type { Language } from "../../types";
import { t } from "../../lib/i18n";
import { actorHasEffectivePermission } from "../../lib/actorAuthorization";
import { enterpriseMotion } from "../../lib/enterpriseMotion";
import { useAiFeatureGate } from "../../hooks/useAiFeatureGate";
import { useSessionActor } from "../../context/SessionActorContext";
import { useSubscription } from "../../context/SubscriptionContext";

type Props = {
  lang: Language;
  density?: "comfortable" | "compact";
};

/**
 * Home money-card shortcut into Ask WAKA.
 * Same feature + reports.view gates as the office card. Hidden when unavailable.
 */
export function HomeAskWakaShortcut({ lang, density = "comfortable" }: Props) {
  const navigate = useNavigate();
  const actor = useSessionActor();
  const { snapshot, authMode } = useSubscription();
  const gate = useAiFeatureGate("ask_waka");
  const canReports = actorHasEffectivePermission(actor, "reports.view", snapshot, authMode);

  if (gate.loading || !gate.enabled || !canReports) return null;

  const compact = density === "compact";

  return (
    <button
      type="button"
      onClick={() => navigate("/office/ask-waka")}
      className={clsx(
        "home-ask-waka-shortcut",
        compact && "home-ask-waka-shortcut--compact",
        enterpriseMotion.standard,
        enterpriseMotion.press,
        enterpriseMotion.focus,
      )}
      aria-label={t(lang, "officeCardAskWaka")}
    >
      <Sparkles className={clsx("shrink-0", compact ? "h-4 w-4" : "h-5 w-5")} strokeWidth={2.2} aria-hidden />
      <span className="home-ask-waka-shortcut__copy">
        <span className="home-ask-waka-shortcut__title">{t(lang, "officeCardAskWaka")}</span>
        {compact ? null : (
          <span className="home-ask-waka-shortcut__sub">{t(lang, "homeAskWakaShortcutSub")}</span>
        )}
      </span>
    </button>
  );
}
