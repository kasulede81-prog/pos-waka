import { Link } from "react-router-dom";
import clsx from "clsx";
import type { Language } from "../../types";
import { t } from "../../lib/i18n";
import { healthStatusBadge, healthStatusDot } from "../../lib/statusTokens";
import type { HomeHealthItem } from "../../hooks/useHomeBusinessHealthItems";

type Props = {
  lang: Language;
  items: readonly HomeHealthItem[];
  commandCenterTo?: string | null;
  orientation?: "rail" | "stack";
};

/** Compact live status nodes from the same health signals as HomeBusinessHealthSection. */
export function HomeLiveStatusRail({
  lang,
  items,
  commandCenterTo,
  orientation = "rail",
}: Props) {
  if (items.length === 0) return null;
  const stack = orientation === "stack";

  return (
    <div className={clsx("home-live-status-rail", stack && "home-live-status-rail--stack")}>
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <p className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
          {t(lang, "homeHealthTitle")}
        </p>
        {commandCenterTo ? (
          <Link
            to={commandCenterTo}
            className="text-[11px] font-black text-waka-800 underline-offset-2 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-waka-500"
          >
            {t(lang, "homeHealthOpenCommandCenter")}
          </Link>
        ) : null}
      </div>
      <ul className={clsx("home-live-status-rail__list", stack && "home-live-status-rail__list--stack")}>
        {items.map((item, index) => (
          <li key={item.id} className={clsx("home-live-status-rail__item", stack && "w-full")}>
            {index > 0 ? (
              <span
                className={clsx("home-live-status-rail__rule", stack && "home-live-status-rail__rule--vert")}
                aria-hidden
              />
            ) : null}
            <Link
              key={`${item.id}:${item.status}:${item.label}`}
              to={item.to}
              data-home-health-id={item.id}
              data-home-health-status={item.status}
              className={clsx(
                "home-health-chip home-health-chip--changed home-live-status-node flex min-h-[40px] items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-bold ring-1 ring-inset",
                stack && "w-full rounded-xl",
                "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-waka-500",
                healthStatusBadge(item.status),
              )}
            >
              <span className={clsx("home-live-status-node__dot", healthStatusDot(item.status))} aria-hidden />
              <span className="truncate">{item.label}</span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
