import { Link } from "react-router-dom";
import clsx from "clsx";
import type { Language } from "../../types";
import { t } from "../../lib/i18n";
import { healthStatusBadge, healthStatusDot } from "../../lib/statusTokens";
import type { HomeHealthItem } from "../../hooks/useHomeBusinessHealthItems";
import type { HomeExecutiveKpi } from "../../lib/homeExecutiveKpis";

type Props = {
  lang: Language;
  items: readonly HomeHealthItem[];
  cashKpi?: HomeExecutiveKpi;
};

/** Compact live status — not the desktop Business Health card. */
export function MobileHomeStatusStrip({ lang, items, cashKpi }: Props) {
  const chips = items.filter((item) => item.id === "connectivity" || item.id === "sync" || item.id === "stock").slice(0, 3);
  if (chips.length === 0 && !cashKpi) return null;

  return (
    <section className="home-mobile-status" aria-label={t(lang, "homeHealthTitle")}>
      <ul className="home-mobile-status__list">
        {chips.map((item) => (
          <li key={item.id}>
            <Link
              to={item.to}
              className={clsx(
                "home-mobile-status__chip min-h-11",
                healthStatusBadge(item.status),
              )}
            >
              <span className={clsx("home-live-status-node__dot", healthStatusDot(item.status))} aria-hidden />
              <span className="truncate">{item.label}</span>
            </Link>
          </li>
        ))}
        {cashKpi ? (
          <li>
            <Link to={cashKpi.to} className="home-mobile-status__chip home-mobile-status__chip--cash min-h-11">
              <span className="truncate">
                {cashKpi.label}: {cashKpi.value}
              </span>
            </Link>
          </li>
        ) : null}
      </ul>
    </section>
  );
}
