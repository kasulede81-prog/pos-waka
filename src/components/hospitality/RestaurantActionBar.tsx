import clsx from "clsx";
import {
  ArrowLeft,
  ChefHat,
  ClipboardList,
  GlassWater,
  ListOrdered,
  Receipt,
  Split,
  Wallet,
} from "lucide-react";
import type { Language } from "../../types";
import { t } from "../../lib/i18n";

type Props = {
  lang: Language;
  canSettle: boolean;
  canSendKitchen: boolean;
  canSendBar: boolean;
  hasLines: boolean;
  reviewMode: boolean;
  busy?: boolean;
  onToggleReview: () => void;
  onSendKitchen: () => void;
  onSendBar: () => void;
  onSplit: () => void;
  onTransfer?: () => void;
  onRequestBill: () => void;
  onSettle: () => void;
  onBackToFloor: () => void;
};

export function RestaurantActionBar({
  lang,
  canSettle,
  canSendKitchen,
  canSendBar,
  hasLines,
  reviewMode,
  busy,
  onToggleReview,
  onSendKitchen,
  onSendBar,
  onSplit,
  onTransfer,
  onRequestBill,
  onSettle,
  onBackToFloor,
}: Props) {
  const btn =
    "flex min-h-11 flex-1 flex-col items-center justify-center gap-0.5 rounded-md px-1 py-2 text-[9px] font-black uppercase leading-tight sm:min-h-12 sm:text-[10px]";

  return (
    <div className="shrink-0 border-t-2 border-sky-800 bg-sky-600 p-1 sm:p-1.5">
      <div className="mx-auto flex max-w-6xl flex-wrap gap-1">
        <button
          type="button"
          disabled={busy}
          onClick={onToggleReview}
          className={clsx(btn, reviewMode ? "bg-card text-sky-900" : "bg-sky-500 text-white")}
        >
          <ListOrdered className="h-4 w-4" />
          <span>{reviewMode ? t(lang, "restaurantMenuView") : t(lang, "restaurantReviewOrder")}</span>
        </button>
        {canSendKitchen ? (
          <button
            type="button"
            disabled={busy || !hasLines}
            onClick={onSendKitchen}
            className={clsx(btn, "bg-sky-500 text-white disabled:opacity-50")}
          >
            <ChefHat className="h-4 w-4" />
            <span>{t(lang, "tableSendKitchen")}</span>
          </button>
        ) : null}
        {canSendBar ? (
          <button
            type="button"
            disabled={busy || !hasLines}
            onClick={onSendBar}
            className={clsx(btn, "bg-sky-500 text-white disabled:opacity-50")}
          >
            <GlassWater className="h-4 w-4" />
            <span>{t(lang, "tableSendBar")}</span>
          </button>
        ) : null}
        {canSettle ? (
          <button
            type="button"
            disabled={busy || !hasLines}
            onClick={onSplit}
            className={clsx(btn, "bg-sky-500 text-white disabled:opacity-50")}
          >
            <Split className="h-4 w-4" />
            <span>{t(lang, "splitBillBtn")}</span>
          </button>
        ) : null}
        {onTransfer ? (
          <button
            type="button"
            disabled={busy}
            onClick={onTransfer}
            className={clsx(btn, "bg-sky-500 text-white")}
          >
            <ArrowLeft className="h-4 w-4 rotate-180" />
            <span>{t(lang, "tableTransferBtn")}</span>
          </button>
        ) : null}
        <button
          type="button"
          disabled={busy || !hasLines}
          onClick={onRequestBill}
          className={clsx(btn, "bg-sky-500 text-white disabled:opacity-50")}
        >
          <Receipt className="h-4 w-4" />
          <span>{t(lang, "restaurantReceiptPreview")}</span>
        </button>
        {canSettle ? (
          <button
            type="button"
            disabled={busy || !hasLines}
            onClick={onSettle}
            className={clsx(btn, "bg-emerald-600 text-white disabled:opacity-50 sm:flex-[1.2]")}
          >
            <Wallet className="h-4 w-4" />
            <span>{t(lang, "tableSettleBill")}</span>
          </button>
        ) : null}
        <button
          type="button"
          disabled={busy}
          onClick={onBackToFloor}
          className={clsx(btn, "bg-muted text-foreground")}
        >
          <ClipboardList className="h-4 w-4" />
          <span>{t(lang, "restaurantBackFloor")}</span>
        </button>
      </div>
    </div>
  );
}
