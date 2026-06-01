import { Link } from "react-router-dom";
import type { LucideIcon } from "lucide-react";
import clsx from "clsx";

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
          "flex min-h-[60px] items-center gap-3 rounded-2xl border px-3.5 py-2.5 transition active:scale-[0.99] motion-reduce:active:scale-100",
          highlight
            ? "border-waka-300 bg-gradient-to-r from-waka-50 to-white shadow-sm"
            : deemphasized
              ? "border-stone-100 bg-stone-50/80 shadow-none"
              : "border-stone-200/90 bg-white shadow-sm",
        )}
      >
        <span
          className={clsx(
            "flex h-10 w-10 shrink-0 items-center justify-center rounded-xl",
            highlight ? "bg-waka-600 text-white" : "bg-stone-100 text-stone-700",
          )}
        >
          <Icon className="h-5 w-5" strokeWidth={2.25} aria-hidden />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[15px] font-black leading-snug text-stone-950">{title}</span>
          {subtitle ? (
            <span className="mt-0.5 block truncate text-xs font-semibold text-stone-500">{subtitle}</span>
          ) : null}
        </span>
        {trailing ? (
          <span className="shrink-0 text-right text-xs font-black text-waka-800">{trailing}</span>
        ) : null}
      </Link>
      {nestedLink ? (
        <Link
          to={nestedLink.to}
          className="ml-14 mt-1 inline-flex min-h-[36px] items-center text-xs font-black text-waka-800 underline decoration-waka-300 underline-offset-2"
        >
          {nestedLink.label}
        </Link>
      ) : null}
    </li>
  );
}
