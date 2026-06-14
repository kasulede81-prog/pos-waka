import { Link } from "react-router-dom";
import { AlertTriangle } from "lucide-react";
import type { Language } from "../../types";
import { t, tTemplate } from "../../lib/i18n";

type Props = {
  lang: Language;
  totalCount: number;
};

export function OfficeNeedsAttentionBadge({ lang, totalCount }: Props) {
  if (totalCount <= 0) return null;

  return (
    <Link
      to="/owner"
      className="flex items-start gap-3 rounded-2xl border-2 border-amber-300 bg-gradient-to-r from-amber-50 to-rose-50/80 px-4 py-3 shadow-sm transition-colors hover:border-amber-400 hover:bg-amber-50 active:scale-[0.99]"
    >
      <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-700" aria-hidden />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-black text-amber-950">
          {tTemplate(lang, "officeNeedsAttentionBadge", { count: String(totalCount) })}
        </p>
        <p className="mt-0.5 text-xs font-semibold text-amber-900/80">{t(lang, "officeNeedsAttentionBadgeSub")}</p>
      </div>
      <span className="shrink-0 rounded-full bg-amber-200 px-2.5 py-1 text-sm font-black text-amber-950">
        {totalCount}
      </span>
    </Link>
  );
}
