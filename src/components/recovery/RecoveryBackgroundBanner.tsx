import type { Language } from "../../types";
import { t } from "../../lib/i18n";
import { EnterpriseFeedbackBanner } from "../enterprise/EnterpriseFeedbackBanner";
import { useCloudRecoverySession } from "../../hooks/useCloudRecoverySession";
import { isCloudRecoveryBackgroundActive } from "../../lib/cloudRecoverySession";
import { classifyRecoveryFailure } from "../../lib/recoveryFailureClassification";

type Props = {
  lang: Language;
  onRetry?: () => void;
};

export function RecoveryBackgroundBanner({ lang, onRetry }: Props) {
  const session = useCloudRecoverySession();

  if (!isCloudRecoveryBackgroundActive() && session.status !== "complete") {
    return null;
  }

  if (session.status === "complete") {
    if (!session.completedWithInventoryWarnings && session.certificationWarnings.length === 0) {
      return null;
    }
  }

  if (session.status === "certifying") {
    return (
      <div className="pointer-events-none fixed inset-x-0 top-[max(0.5rem,env(safe-area-inset-top))] z-[200] flex justify-center px-4">
        <EnterpriseFeedbackBanner tone="info" className="pointer-events-auto max-w-lg shadow-waka-md">
          {t(lang, "recoveryBannerCertifying")}
        </EnterpriseFeedbackBanner>
      </div>
    );
  }

  if (session.certificationWarnings.length > 0) {
    const presentation = classifyRecoveryFailure(session.errorKey, { coreUnlocked: true });
    return (
      <div className="fixed inset-x-0 top-[max(0.5rem,env(safe-area-inset-top))] z-[200] flex justify-center px-4">
        <EnterpriseFeedbackBanner tone="warning" className="max-w-lg shadow-waka-md">
          <span>{t(lang, presentation.subKey)}</span>
          {onRetry ? (
            <button
              type="button"
              className="ml-2 font-black underline"
              onClick={onRetry}
            >
              {t(lang, "updateRetry")}
            </button>
          ) : null}
        </EnterpriseFeedbackBanner>
      </div>
    );
  }

  if (session.status === "core_unlocked") {
    return (
      <div className="pointer-events-none fixed inset-x-0 top-[max(0.5rem,env(safe-area-inset-top))] z-[200] flex justify-center px-4">
        <EnterpriseFeedbackBanner tone="info" className="pointer-events-auto max-w-lg shadow-waka-md">
          {t(lang, "recoveryBannerBackground")}
        </EnterpriseFeedbackBanner>
      </div>
    );
  }

  return null;
}
