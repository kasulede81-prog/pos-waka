import type { Language } from "../../types";
import { t } from "../../lib/i18n";
import { ShieldAlert } from "lucide-react";
import { useDeviceAuthority } from "../../context/DeviceAuthorityContext";
import { statusTokens } from "../../lib/statusTokens";
import { themeUi } from "../../lib/themeTokens";
import clsx from "clsx";

type Props = {
  lang: Language;
  className?: string;
};

/** Shown when this device is pending approval or not authorized for owner actions. */
export function DeviceNotAuthorizedBanner({ lang, className }: Props) {
  const { isDeviceAuthorized, pendingApproval } = useDeviceAuthority();
  if (isDeviceAuthorized && !pendingApproval) return null;

  return (
    <div
      className={clsx(statusTokens.warning.banner, "flex gap-3", className)}
      role="status"
    >
      <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0 text-warning" aria-hidden />
      <div>
        <p className="text-sm font-black text-warning-foreground">
          {pendingApproval ? t(lang, "devicePendingApprovalTitle") : t(lang, "deviceNotAuthorizedTitle")}
        </p>
        <p className="mt-0.5 text-xs font-medium text-warning-foreground/90">
          {pendingApproval ? t(lang, "devicePendingApprovalBody") : t(lang, "deviceNotAuthorizedBody")}
        </p>
      </div>
    </div>
  );
}

type GateProps = {
  lang: Language;
  children: React.ReactNode;
  /** When true, render children with banner instead of blocking entirely. */
  soft?: boolean;
};

/** Blocks or soft-wraps owner actions when this device is not approved. */
export function DeviceApprovedGate({ lang, children, soft = false }: GateProps) {
  const { isDeviceAuthorized, loading, pendingApproval } = useDeviceAuthority();

  if (loading) return null;
  if (pendingApproval) {
    return (
      <div className={clsx("p-6 text-center shadow-sm", themeUi.surface)}>
        <p className="text-sm font-black text-foreground">{t(lang, "devicePendingApprovalTitle")}</p>
        <p className="mt-2 text-xs font-medium text-muted-foreground">{t(lang, "devicePendingApprovalBody")}</p>
        <p className="mt-2 text-xs font-medium text-muted-foreground">{t(lang, "devicePendingApprovalHint")}</p>
      </div>
    );
  }
  if (isDeviceAuthorized) return <>{children}</>;
  if (soft) {
    return (
      <div className="space-y-4">
        <DeviceNotAuthorizedBanner lang={lang} />
        <div className="pointer-events-none opacity-50">{children}</div>
      </div>
    );
  }
  return <DeviceNotAuthorizedBanner lang={lang} />;
}
