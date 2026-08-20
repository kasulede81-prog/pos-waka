import type { ReactNode } from "react";
import clsx from "clsx";
import { ChevronDown, ChevronUp } from "lucide-react";
import type { Language, Product, SaleLine } from "../../types";
import { t } from "../../lib/i18n";
import type { DraftCartStats } from "../../lib/draftCart";
import { formatDraftLineQty, formatDraftLineUnitPrice } from "../../lib/draftCart";
import { resolveMobileCheckoutItemsVisibility } from "../../lib/posMobileCheckoutItems";
import { POS_CHECKOUT_SCROLL_CLASS } from "../../lib/posTouchInteraction";
import { DraftCartLineRow } from "./DraftCartLineRow";
import { VirtualizedDraftCartList } from "./VirtualizedDraftCartList";

type Props = {
  lang: Language;
  draftLines: SaleLine[];
  draftCartStats: DraftCartStats;
  productById: Map<string, Product>;
  expanded: boolean;
  onExpandedChange: (expanded: boolean) => void;
  onIncrement: (line: SaleLine) => void;
  onDecrement: (line: SaleLine) => void;
  onQtyTap: (line: SaleLine) => void;
  onLineDiscount: (line: SaleLine) => void;
  onRemoveLine: (productId: string) => void;
  onOpenCartDiscount: () => void;
  pharmacyMode?: boolean;
  onBatchTap?: (line: SaleLine) => void;
};

/** Compact verification row — name / qty×price / line total (collapsed 4+ preview only). */
function SheetCartPreviewRow({
  line,
  product,
}: {
  line: SaleLine;
  product: Product | undefined;
}): ReactNode {
  const qtyLabel = product ? formatDraftLineQty(product, line) : String(line.quantity);
  const unitHint = product ? formatDraftLineUnitPrice(product, line) : null;
  return (
    <div className="flex items-baseline justify-between gap-2 border-b border-border py-1.5 last:border-0">
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-bold leading-snug text-foreground">{line.name}</p>
        <p className="mt-0.5 text-[11px] font-semibold tabular-nums text-muted-foreground">
          {qtyLabel}
          {unitHint ? ` · ${unitHint}` : null}
        </p>
      </div>
      <p className="shrink-0 text-sm font-black tabular-nums text-foreground">
        UGX {line.lineTotalUgx.toLocaleString()}
      </p>
    </div>
  );
}

/**
 * M1.1-R4 — expandable cart items for mobile checkout sheet.
 * 1–3 lines: full editable rows (qty / discount / remove). 4+: preview + View all.
 * Expanded list scrolls; totals / payment / keypad stay outside (pinned by parent).
 */
export function MobileSheetCartItems({
  lang,
  draftLines,
  draftCartStats,
  productById,
  expanded,
  onExpandedChange,
  onIncrement,
  onDecrement,
  onQtyTap,
  onLineDiscount,
  onRemoveLine,
  onOpenCartDiscount,
  pharmacyMode = false,
  onBatchTap,
}: Props) {
  const visibility = resolveMobileCheckoutItemsVisibility(draftLines.length, expanded);

  const unitShown = Number.isInteger(draftCartStats.unitCount)
    ? String(draftCartStats.unitCount)
    : draftCartStats.unitCount.toFixed(2).replace(/\.?0+$/, "");

  const summaryLabel = `${draftCartStats.productCount} ${t(lang, "posCartProductsShort").toLowerCase()} · ${unitShown} ${t(lang, "posCartUnitsShort").toLowerCase()}`;

  const previewLines = draftLines.slice(0, visibility.previewCount);

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden" data-expanded={expanded ? "true" : "false"}>
      <div className="flex shrink-0 items-center gap-1.5">
        {visibility.showDisclosure ? (
          <button
            type="button"
            onClick={() => onExpandedChange(!expanded)}
            className="flex min-h-[44px] min-w-0 flex-1 items-center justify-between gap-2 rounded-lg border border-waka-200 bg-waka-50/90 px-2.5 py-2 text-left active:bg-waka-100"
            aria-expanded={expanded}
            aria-controls="pos-mobile-sheet-cart-list"
            aria-label={
              expanded
                ? t(lang, "posCheckoutItemsCollapseAria")
                : t(lang, "posCheckoutItemsExpandAria")
            }
          >
            <span className="min-w-0 truncate text-xs font-bold text-muted-foreground">{summaryLabel}</span>
            <span className="flex shrink-0 items-center gap-0.5 text-[11px] font-black text-waka-800">
              {expanded ? t(lang, "posCheckoutCollapseProducts") : t(lang, "posCheckoutViewAllShort")}
              {expanded ? (
                <ChevronUp className="h-4 w-4" aria-hidden />
              ) : (
                <ChevronDown className="h-4 w-4" aria-hidden />
              )}
            </span>
          </button>
        ) : (
          <div className="flex min-h-[44px] min-w-0 flex-1 items-center rounded-lg border border-waka-200 bg-waka-50/90 px-2.5 py-2">
            <span className="truncate text-xs font-bold text-muted-foreground">{summaryLabel}</span>
          </div>
        )}
        <button
          type="button"
          onClick={onOpenCartDiscount}
          className="flex min-h-[44px] shrink-0 items-center rounded-lg border border-waka-300 bg-card px-2.5 text-xs font-black text-waka-900 active:bg-waka-50"
        >
          {t(lang, "cartDiscountBtn")}
        </button>
      </div>

      <div
        id="pos-mobile-sheet-cart-list"
        className={clsx(
          "mt-1.5 min-h-0 flex-1 rounded-lg border border-waka-200 bg-card px-2 shadow-sm",
          POS_CHECKOUT_SCROLL_CLASS,
        )}
      >
        {visibility.showAllLines ? (
          <VirtualizedDraftCartList>
            lines={draftLines}
            estimateRowPx={pharmacyMode ? 108 : 92}
            listAriaLabel={t(lang, "posCartProductsShort")}
            className={clsx("h-full min-h-0", POS_CHECKOUT_SCROLL_CLASS)}
            renderRow={(line) => (
              <DraftCartLineRow
                lang={lang}
                line={line}
                product={productById.get(line.productId)}
                dock
                sidebarCompact
                pharmacyMode={pharmacyMode}
                onBatchTap={onBatchTap ? () => onBatchTap(line) : undefined}
                onIncrement={() => onIncrement(line)}
                onDecrement={() => onDecrement(line)}
                onQtyTap={() => onQtyTap(line)}
                onDiscount={() => onLineDiscount(line)}
                onRemove={() => onRemoveLine(line.productId)}
              />
            )}
          />
        ) : (
          <div role="list" aria-label={t(lang, "posCartProductsShort")}>
            {previewLines.map((line) => (
              <div key={line.productId} role="listitem">
                <SheetCartPreviewRow
                  line={line}
                  product={productById.get(line.productId)}
                />
              </div>
            ))}
            {visibility.showDisclosure && !expanded ? (
              <button
                type="button"
                onClick={() => onExpandedChange(true)}
                className="flex min-h-[44px] w-full items-center justify-between gap-2 py-1.5 text-left text-xs font-black text-waka-800 active:bg-muted"
              >
                <span>{t(lang, "posCheckoutViewAllProducts").replace("{{count}}", String(draftLines.length))}</span>
                <ChevronDown className="h-4 w-4 shrink-0" aria-hidden />
              </button>
            ) : null}
          </div>
        )}
      </div>
    </div>
  );
}
