import { Link } from "react-router-dom";
import clsx from "clsx";
import type { Language } from "../../types";
import { t } from "../../lib/i18n";
import { healthStatusBadge, healthStatusDot } from "../../lib/statusTokens";
import { useHomeBusinessHealthItems } from "../../hooks/useHomeBusinessHealthItems";
import { EnterpriseCard } from "../enterprise/EnterpriseCard";

type Props = { lang: Language };

/**
 * Phase 34.1 — Business Health promoted above the fold.
 * Reuses the same sync / risk / stock / subscription signals as the former footer chips.
 * Desktop command Home folds this into LivingBusinessPulse; phone / EOD keep the card.
 */
export function HomeBusinessHealthSection({ lang }: Props) {
  const { items, commandCenterTo } = useHomeBusinessHealthItems(lang);

  return (
    <section className="mb-2.5 sm:mb-3" aria-label={t(lang, "homeHealthTitle")}>
      <EnterpriseCard
        className="!p-2.5 sm:!p-3"
        title={t(lang, "homeHealthTitle")}
        subtitle={t(lang, "homeHealthSub")}
        actions={
          commandCenterTo ? (
            <Link
              to={commandCenterTo}
              className="text-xs font-black text-waka-800 underline-offset-2 hover:underline"
            >
              {t(lang, "homeHealthOpenCommandCenter")}
            </Link>
          ) : null
        }
      >
        <ul className="grid grid-cols-2 gap-1 sm:grid-cols-3 sm:gap-1.5 lg:grid-cols-6">
          {items.map((item) => (
            <li key={item.id}>
              <Link
                to={item.to}
                className={clsx(
                  "home-health-chip flex min-h-[44px] items-center gap-1.5 rounded-xl px-2 py-1.5 text-[11px] font-bold ring-1 ring-inset",
                  "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-waka-500",
                  healthStatusBadge(item.status),
                )}
              >
                <span
                  key={`${item.id}:${item.status}:${item.label}`}
                  className={clsx("home-live-status-node__dot", healthStatusDot(item.status))}
                  aria-hidden
                />
                <span className="truncate">{item.label}</span>
              </Link>
            </li>
          ))}
        </ul>
      </EnterpriseCard>
    </section>
  );
}
