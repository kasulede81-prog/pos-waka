import { useEffect, useState } from "react";
import type { Language } from "../../types";
import { t } from "../../lib/i18n";
import {
  dismissStaffCredentialRecoveryOwnerNotice,
  peekStaffCredentialRecoveryOwnerNotice,
} from "../../lib/staffCredentialRecovery";

type Props = {
  lang: Language;
  onDismiss: () => void;
};

export function StaffCredentialRecoveryBanner({ lang, onDismiss }: Props) {
  return (
    <div className="rounded-2xl border border-sky-300 bg-sky-50 px-4 py-3 text-sm text-sky-950">
      <p className="font-black">{t(lang, "staffCredentialRecoveryOwnerTitle")}</p>
      <p className="mt-0.5 font-semibold">{t(lang, "staffCredentialRecoveryOwnerBody")}</p>
      <button
        type="button"
        onClick={onDismiss}
        className="mt-2 min-h-[40px] rounded-xl border border-sky-300 bg-white px-3 text-xs font-black text-sky-900"
      >
        {t(lang, "shopSecurityPinRecoveryBannerDismiss")}
      </button>
    </div>
  );
}

export function useStaffCredentialRecoveryOwnerNotice(shopId: string | null | undefined) {
  const [noticeAt, setNoticeAt] = useState<string | null>(() =>
    shopId ? peekStaffCredentialRecoveryOwnerNotice(shopId) : null,
  );

  useEffect(() => {
    if (!shopId) {
      setNoticeAt(null);
      return;
    }
    setNoticeAt(peekStaffCredentialRecoveryOwnerNotice(shopId));

    const onRecovery = (event: Event) => {
      const detail = (event as CustomEvent<{ shopId?: string; clearedAt?: string; audience?: string }>).detail;
      if (detail?.shopId === shopId && detail.audience === "owner") {
        setNoticeAt(detail.clearedAt ?? peekStaffCredentialRecoveryOwnerNotice(shopId));
      }
    };
    const onDismiss = (event: Event) => {
      const detail = (event as CustomEvent<{ shopId?: string }>).detail;
      if (detail?.shopId === shopId) setNoticeAt(null);
    };

    window.addEventListener("waka:staff-credential-recovery", onRecovery);
    window.addEventListener("waka:staff-credential-recovery-dismissed", onDismiss);
    return () => {
      window.removeEventListener("waka:staff-credential-recovery", onRecovery);
      window.removeEventListener("waka:staff-credential-recovery-dismissed", onDismiss);
    };
  }, [shopId]);

  const dismissNotice = () => {
    if (!shopId) return;
    dismissStaffCredentialRecoveryOwnerNotice(shopId);
    setNoticeAt(null);
  };

  return { noticeAt, dismissNotice };
}
