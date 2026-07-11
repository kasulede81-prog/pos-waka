import { Link } from "react-router-dom";
import type { Language } from "../../types";
import { t } from "../../lib/i18n";

type Props = {
  lang: Language;
  className?: string;
};

/** Link to variance / tolerance settings — not the open-drawer flow. */
export function CashDrawerToleranceLink({ lang, className }: Props) {
  return (
    <Link
      to="/settings/cash-drawer"
      className={
        className ??
        "inline-flex min-h-[40px] items-center text-xs font-bold text-muted-foreground underline decoration-stone-300"
      }
    >
      {t(lang, "cashManageDrawerSettings")}
    </Link>
  );
}

/** @deprecated Use CashDrawerToleranceLink */
export const ManageDrawerSettingsLink = CashDrawerToleranceLink;
