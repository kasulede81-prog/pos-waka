import type { Language } from "../../types";
import { t } from "../../lib/i18n";
import { ShieldAlert } from "lucide-react";
import { useDeviceAuthority } from "../../context/DeviceAuthorityContext";

type Props = {
  lang: Language;
  className?: string;
};

/** Shown on secondary devices when a primary-only action is unavailable. */
export function ManagedByPrimaryDevice({ lang, className }: Props) {
  const { isPrimary } = useDeviceAuthority();
  if (isPrimary) return null;

  return (
    <div
      className={`flex gap-3 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 ${className ?? ""}`}
      role="status"
    >
      <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0 text-amber-700" aria-hidden />
      <div>
        <p className="text-sm font-black text-amber-950">{t(lang, "managedByPrimaryTitle")}</p>
        <p className="mt-0.5 text-xs font-medium text-amber-900">{t(lang, "managedByPrimaryBody")}</p>
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

/** Blocks or soft-wraps primary-only content on secondary devices. */
export function PrimaryDeviceGate({ lang, children, soft = false }: GateProps) {
  const { isPrimary, loading, pendingApproval } = useDeviceAuthority();

  if (loading) return null;
  if (pendingApproval) {
    return (
      <div className="rounded-2xl border border-stone-200 bg-white p-6 text-center shadow-sm">
        <p className="text-sm font-black text-stone-900">{t(lang, "devicePendingApprovalTitle")}</p>
        <p className="mt-2 text-xs font-medium text-stone-600">{t(lang, "devicePendingApprovalBody")}</p>
      </div>
    );
  }
  if (isPrimary) return <>{children}</>;
  if (soft) {
    return (
      <div className="space-y-4">
        <ManagedByPrimaryDevice lang={lang} />
        <div className="pointer-events-none opacity-50">{children}</div>
      </div>
    );
  }
  return <ManagedByPrimaryDevice lang={lang} />;
}
