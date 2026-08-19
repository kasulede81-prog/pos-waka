import clsx from "clsx";
import { Link } from "react-router-dom";
import {
  Bookmark,
  Percent,
  RotateCcw,
  Users,
} from "lucide-react";
import type { Language } from "../../../types";
import { t } from "../../../lib/i18n";
import { DesktopPosButton } from "./DesktopPosButton";

type Props = {
  lang: Language;
  canSavePending: boolean;
  pendingCount: number;
  hasCartDiscount: boolean;
  onHold: () => void;
  onCartDiscount: () => void;
  className?: string;
};

/** Quick cashier actions — hold, recall, customers, discounts. */
export function DesktopQuickActions({
  lang,
  canSavePending,
  pendingCount,
  hasCartDiscount,
  onHold,
  onCartDiscount,
  className,
}: Props) {
  return (
    <div className={clsx("desktop-pos-quick-actions grid grid-cols-2 gap-1.5 p-1.5", className)}>
      <DesktopPosButton
        size="md"
        variant="default"
        className="flex-col gap-0.5 py-2"
        disabled={!canSavePending}
        onClick={onHold}
      >
        <Bookmark className="h-4 w-4" aria-hidden />
        <span className="text-[10px] font-black uppercase">{t(lang, "saveAsPending")}</span>
      </DesktopPosButton>

      <Link
        to="/pending-sales"
        className="desktop-pos-btn inline-flex min-h-[44px] flex-col items-center justify-center gap-0.5 rounded-lg border border-border bg-card px-3 py-2 text-sm font-bold text-foreground shadow-[inset_0_1px_0_rgba(255,255,255,0.06)] active:scale-[0.98] active:bg-muted active:shadow-[inset_0_2px_4px_rgba(0,0,0,0.12)]"
      >
        <RotateCcw className="h-4 w-4" aria-hidden />
        <span className="text-[10px] font-black uppercase">
          {t(lang, "pendingSalesLink")}
          {pendingCount > 0 ? ` (${pendingCount})` : ""}
        </span>
      </Link>

      <Link
        to="/customers"
        className="desktop-pos-btn inline-flex min-h-[44px] flex-col items-center justify-center gap-0.5 rounded-lg border border-border bg-card px-3 py-2 text-sm font-bold text-foreground shadow-[inset_0_1px_0_rgba(255,255,255,0.06)] active:scale-[0.98] active:bg-muted active:shadow-[inset_0_2px_4px_rgba(0,0,0,0.12)]"
      >
        <Users className="h-4 w-4" aria-hidden />
        <span className="text-[10px] font-black uppercase">{t(lang, "customers")}</span>
      </Link>

      <DesktopPosButton size="md" variant={hasCartDiscount ? "primary" : "default"} className="flex-col gap-0.5 py-2" onClick={onCartDiscount}>
        <Percent className="h-4 w-4" aria-hidden />
        <span className="text-[10px] font-black uppercase">{t(lang, "cartDiscountBtn")}</span>
      </DesktopPosButton>
    </div>
  );
}
