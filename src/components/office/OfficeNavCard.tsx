import { Link } from "react-router-dom";
import type { LucideIcon } from "lucide-react";
import clsx from "clsx";
import { wakaUi } from "../../lib/brandTokens";
import { enterpriseIconClass } from "../../lib/enterpriseIcons";
import { enterpriseTypeClass } from "../../lib/enterpriseTypography";
import { Caption } from "../enterprise/EnterpriseTypography";

type Props = {
  to: string;
  title: string;
  subtitle?: string;
  Icon: LucideIcon;
  highlight?: boolean;
  deemphasized?: boolean;
  trailing?: string;
  nestedLink?: { to: string; label: string };
};

export function OfficeNavCard({ to, title, subtitle, Icon, highlight, deemphasized, trailing, nestedLink }: Props) {
  return (
    <li className={deemphasized ? "opacity-60" : undefined}>
      <Link
        to={to}
        className={clsx(
          wakaUi.surface,
          "relative flex min-h-[80px] flex-col justify-between gap-1 rounded-xl border p-2.5 transition active:scale-[0.99] motion-reduce:active:scale-100",
          highlight
            ? "border-waka-300 bg-gradient-to-br from-waka-50 to-card shadow-sm"
            : deemphasized
              ? "border-border bg-muted/80 shadow-none"
              : "border-border/90 shadow-sm",
        )}
      >
        {trailing ? (
          <Caption className="absolute right-2 top-2 normal-case leading-none text-waka-800">{trailing}</Caption>
        ) : null}
        <span
          className={clsx(
            "flex h-8 w-8 shrink-0 items-center justify-center rounded-lg",
            highlight ? "bg-waka-600 text-white" : "bg-muted text-muted-foreground",
          )}
        >
          <Icon className={enterpriseIconClass("md")} strokeWidth={2.25} aria-hidden />
        </span>
        <span className="min-w-0 flex-1">
          <span className={enterpriseTypeClass("body", "line-clamp-2 text-xs !font-black leading-tight")}>
            {title}
          </span>
          {subtitle ? (
            <Caption className="mt-0.5 line-clamp-1 normal-case leading-snug">{subtitle}</Caption>
          ) : null}
        </span>
      </Link>
      {nestedLink ? (
        <Link
          to={nestedLink.to}
          className="mt-1 inline-flex min-h-[32px] items-center px-0.5 text-[10px] font-black text-waka-800 underline decoration-waka-300 underline-offset-2"
        >
          {nestedLink.label}
        </Link>
      ) : null}
    </li>
  );
}
