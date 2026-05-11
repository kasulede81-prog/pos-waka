import { Link } from "react-router-dom";
import {
  Package,
  Truck,
  Users,
  BarChart3,
  CalendarCheck,
  Settings,
  LayoutDashboard,
  ScrollText,
} from "lucide-react";
import type { Language } from "../types";
import { t } from "../lib/i18n";
import { useSessionActor } from "../context/SessionActorContext";
import { hasPermission } from "../lib/permissions";

type Card = {
  to: string;
  titleKey: string;
  subKey?: string;
  Icon: typeof Package;
  perm: boolean;
};

export function OfficeHubPage({ lang }: { lang: Language }) {
  const actor = useSessionActor();

  const cards: Card[] = [
    { to: "/stock", titleKey: "officeCardStock", Icon: Package, perm: hasPermission(actor.role, "stock.view") },
    { to: "/restock", titleKey: "officeCardRestock", Icon: Truck, perm: hasPermission(actor.role, "purchases.record") },
    { to: "/suppliers", titleKey: "officeCardSuppliers", Icon: Users, perm: hasPermission(actor.role, "suppliers.view") },
    { to: "/reports", titleKey: "officeCardReports", Icon: BarChart3, perm: hasPermission(actor.role, "reports.view") },
    { to: "/close-day", titleKey: "officeCardCloseDay", Icon: CalendarCheck, perm: hasPermission(actor.role, "day.close") },
    { to: "/settings", titleKey: "officeCardSettings", Icon: Settings, perm: hasPermission(actor.role, "settings.view") },
    {
      to: "/owner",
      titleKey: "officeCardOwner",
      Icon: LayoutDashboard,
      perm: hasPermission(actor.role, "owner.dashboard"),
    },
    {
      to: "/owner/activity",
      titleKey: "officeCardActivity",
      Icon: ScrollText,
      perm: hasPermission(actor.role, "owner.activity"),
    },
  ];

  const visible = cards.filter((c) => c.perm);

  return (
    <div className="space-y-6 pb-10">
      <div>
        <h1 className="text-3xl font-black text-stone-900">{t(lang, "officeHubTitle")}</h1>
        <p className="mt-2 text-base font-medium text-stone-600">{t(lang, "officeHubSub")}</p>
      </div>

      {visible.length === 0 ? (
        <p className="rounded-2xl bg-amber-50 px-4 py-4 text-sm font-bold text-amber-950">{t(lang, "officeHubEmpty")}</p>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2">
          {visible.map((c) => (
            <li key={c.to}>
              <Link
                to={c.to}
                className="flex min-h-[88px] items-center gap-4 rounded-3xl border border-stone-200 bg-white p-4 shadow-waka-sm transition-waka active:scale-[0.99] motion-reduce:active:scale-100"
              >
                <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-waka-50 text-waka-700">
                  <c.Icon className="h-7 w-7" strokeWidth={2.25} aria-hidden />
                </span>
                <span className="min-w-0">
                  <span className="block text-lg font-black text-stone-900">{t(lang, c.titleKey)}</span>
                  {c.subKey ? (
                    <span className="mt-0.5 block text-xs font-semibold text-stone-500">{t(lang, c.subKey)}</span>
                  ) : null}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}

      <Link to="/" className="inline-flex min-h-[48px] items-center rounded-2xl font-bold text-waka-800 underline">
        ← {t(lang, "officeBackHome")}
      </Link>
    </div>
  );
}
