import { Link } from "react-router-dom";
import type { Language } from "../../types";
import { t } from "../../lib/i18n";

type Props = {
  lang: Language;
  className?: string;
};

/** Single link to drawer configuration — replaces scattered settings on cash pages. */
export function ManageDrawerSettingsLink({ lang, className }: Props) {
  return (
    <Link
      to="/settings/cash-drawer"
      className={
        className ??
        "inline-flex min-h-[44px] items-center justify-center rounded-2xl border-2 border-stone-200 bg-white px-4 text-sm font-black text-stone-900"
      }
    >
      {t(lang, "cashManageDrawerSettings")} →
    </Link>
  );
}
