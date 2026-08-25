import { NavLink, Outlet } from "react-router-dom";
import clsx from "clsx";
import type { Language } from "../types";
import { t } from "../lib/i18n";
import { EnterprisePageContainer } from "../components/layout/EnterprisePageContainer";
import { EnterprisePageHeader } from "../components/enterprise/EnterprisePageHeader";
import { DeviceApprovedGate } from "../components/device/DeviceApprovedGate";

const TABS = [
  { to: "/staff-center/team", labelKey: "staffCenterTabTeam" as const },
  { to: "/staff-center/roles", labelKey: "staffCenterTabRoles" as const },
  { to: "/staff-center/activity", labelKey: "staffCenterTabActivity" as const },
  { to: "/staff-center/security", labelKey: "staffCenterTabSecurity" as const },
];

type Props = { lang: Language };

/**
 * Unified Staff Center shell (Phase 4 UX).
 * Owner language only — Team / Roles / Activity / Security.
 * Existing section pages render in the outlet (embedded mode).
 */
export function StaffCenterLayout({ lang }: Props) {
  return (
    <DeviceApprovedGate lang={lang}>
      <EnterprisePageContainer className="space-y-5 pb-8">
        <EnterprisePageHeader
          lang={lang}
          title={t(lang, "staffCenterTitle")}
          subtitle={t(lang, "staffCenterSub")}
          backFallback="/settings"
        />

        <nav
          className="flex flex-wrap gap-2 rounded-2xl border border-border bg-card p-1.5"
          aria-label={t(lang, "staffCenterTitle")}
          data-testid="staff-center-tabs"
        >
          {TABS.map((tab) => (
            <NavLink
              key={tab.to}
              to={tab.to}
              className={({ isActive }) =>
                clsx(
                  "min-h-[44px] flex-1 rounded-xl px-3 py-2.5 text-center text-sm font-bold transition",
                  isActive
                    ? "bg-waka-600 text-white shadow-sm"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground",
                )
              }
            >
              {t(lang, tab.labelKey)}
            </NavLink>
          ))}
        </nav>

        <Outlet />
      </EnterprisePageContainer>
    </DeviceApprovedGate>
  );
}
