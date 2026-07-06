import { Link, useLocation } from "react-router-dom";
import clsx from "clsx";
import type { Language } from "../../types";
import { t } from "../../lib/i18n";

const NAV: { path: string; labelKey: string; permission?: string }[] = [
  { path: "/enterprise", labelKey: "enterpriseNav_dashboard" },
  { path: "/enterprise/branches", labelKey: "enterpriseNav_branches", permission: "enterprise.branches" },
  { path: "/enterprise/transfers", labelKey: "enterpriseNav_transfers", permission: "enterprise.transfers" },
  { path: "/enterprise/purchasing", labelKey: "enterpriseNav_purchasing", permission: "enterprise.purchasing" },
  { path: "/enterprise/reports", labelKey: "enterpriseNav_reports", permission: "enterprise.reports" },
  { path: "/enterprise/audit", labelKey: "enterpriseNav_audit", permission: "enterprise.audit" },
  { path: "/enterprise/health", labelKey: "enterpriseNav_health", permission: "enterprise.health" },
  { path: "/enterprise/backup", labelKey: "enterpriseNav_backup", permission: "enterprise.backup" },
];

export function EnterpriseShell({
  lang,
  title,
  subtitle,
  children,
}: {
  lang: Language;
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  const location = useLocation();

  return (
    <div className="page-content-pad flex min-h-0 flex-1 flex-col gap-4">
      <header>
        <p className="text-xs font-black uppercase tracking-wide text-waka-700">{t(lang, "enterpriseHubTitle")}</p>
        <h1 className="text-3xl font-black text-stone-950">{title}</h1>
        {subtitle ? <p className="mt-1 text-sm font-medium text-stone-600">{subtitle}</p> : null}
      </header>

      <nav className="flex flex-wrap gap-2">
        {NAV.map((item) => {
          const active =
            item.path === "/enterprise"
              ? location.pathname === "/enterprise"
              : location.pathname.startsWith(item.path);
          return (
            <Link
              key={item.path}
              to={item.path}
              className={clsx(
                "min-h-[40px] rounded-xl px-3 py-2 text-sm font-black touch-manipulation",
                active ? "bg-waka-600 text-white" : "border border-stone-200 bg-white text-stone-800",
              )}
            >
              {t(lang, item.labelKey as never)}
            </Link>
          );
        })}
      </nav>

      {children}
    </div>
  );
}
