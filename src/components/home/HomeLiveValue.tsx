import clsx from "clsx";
import type { HomeKpiAvailability } from "../../lib/homeExecutiveKpis";

type Props = {
  value: string;
  className?: string;
  availability?: HomeKpiAvailability;
};

/**
 * Home metric value — remounts the node when the formatted string changes
 * so CSS can illuminate once, then settle. Does not count numbers.
 */
export function HomeLiveValue({ value, className, availability }: Props) {
  const pending = availability === "loading" || availability === "unavailable";
  return (
    <span
      key={value}
      className={clsx("home-live-value", "home-live-value--changed", className)}
      data-home-kpi-availability={availability ?? "ready"}
      aria-busy={availability === "loading" ? true : undefined}
      title={pending ? value : undefined}
    >
      {value}
    </span>
  );
}
