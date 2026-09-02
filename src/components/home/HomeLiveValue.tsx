import clsx from "clsx";

type Props = {
  value: string;
  className?: string;
};

/**
 * Home metric value — remounts the node when the formatted string changes
 * so CSS can illuminate once, then settle. Does not count numbers.
 */
export function HomeLiveValue({ value, className }: Props) {
  return (
    <span key={value} className={clsx("home-live-value", "home-live-value--changed", className)}>
      {value}
    </span>
  );
}
