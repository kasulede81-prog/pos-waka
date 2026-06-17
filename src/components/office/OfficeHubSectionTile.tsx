import { Link } from "react-router-dom";
import type { LucideIcon } from "lucide-react";
import clsx from "clsx";

type Props = {
  to: string;
  title: string;
  subtitle?: string;
  Icon: LucideIcon;
  className?: string;
};

export function OfficeHubSectionTile({ to, title, subtitle, Icon, className }: Props) {
  return (
    <Link
      to={to}
      className={clsx(
        "relative flex min-h-[118px] flex-col items-center justify-center gap-2 rounded-2xl border-2 border-white/25",
        "bg-gradient-to-br from-waka-600 via-waka-600 to-waka-700 px-4 py-5 text-center text-white shadow-[0_8px_28px_rgba(234,88,12,0.35)]",
        "transition-all hover:from-waka-500 hover:to-waka-600 active:scale-[0.98] motion-reduce:active:scale-100",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-waka-500 focus-visible:ring-offset-2",
        className,
      )}
    >
      <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-white/15">
        <Icon className="h-6 w-6 text-white" strokeWidth={2.25} aria-hidden />
      </span>
      <span className="text-base font-black uppercase leading-tight tracking-wide sm:text-lg">{title}</span>
      {subtitle ? (
        <span className="line-clamp-2 text-[11px] font-semibold leading-snug text-waka-50/90 sm:text-xs">{subtitle}</span>
      ) : null}
    </Link>
  );
}
