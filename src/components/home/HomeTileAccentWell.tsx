import type { ReactNode } from "react";
import clsx from "clsx";
import type { HomeTileAccent } from "../../lib/homeTileAccent";

type Props = {
  accent: HomeTileAccent;
  size?: "md" | "lg";
  children: ReactNode;
};

/** Shared icon well for live Home and Settings preview — accent fill + readable icon. */
export function HomeTileAccentWell({ accent, size = "md", children }: Props) {
  return (
    <span
      className={clsx(
        "flex shrink-0 items-center justify-center rounded-xl",
        size === "lg" ? "h-12 w-12" : "h-9 w-9",
      )}
      style={accent.wellStyle}
      data-home-tile-accent={accent.hex}
      data-home-tile-accent-fg={accent.iconHex}
    >
      {children}
    </span>
  );
}
