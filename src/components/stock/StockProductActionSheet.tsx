import type { Language } from "../../types";
import { t } from "../../lib/i18n";
import { AppModalOverlay } from "../layout/AppModalOverlay";

type Action = "edit" | "duplicate" | "restock" | "remove" | "sell";

type Props = {
  lang: Language;
  open: boolean;
  productName: string;
  canAdd: boolean;
  canRestock: boolean;
  canRemove: boolean;
  canSell?: boolean;
  sellLabel?: string;
  onClose: () => void;
  onAction: (action: Action) => void;
};

export function StockProductActionSheet({
  lang,
  open,
  productName,
  canAdd,
  canRestock,
  canRemove,
  canSell = false,
  sellLabel,
  onClose,
  onAction,
}: Props) {
  if (!open) return null;

  const items: { action: Action; label: string; danger?: boolean }[] = [];
  if (canSell) items.push({ action: "sell", label: sellLabel ?? t(lang, "stockCardSell") });
  if (canAdd) items.push({ action: "edit", label: t(lang, "stockCardEdit") });
  if (canAdd) items.push({ action: "duplicate", label: t(lang, "stockActionDuplicate") });
  if (canRestock) items.push({ action: "restock", label: t(lang, "stockGoRestock") });
  if (canRemove) items.push({ action: "remove", label: t(lang, "stockActionRemove"), danger: true });

  return (
    <AppModalOverlay className="z-[54] flex items-end bg-foreground/40 backdrop-blur-[2px]" clearNav={false}>
      <button type="button" className="absolute inset-0" aria-label={t(lang, "cancel")} onClick={onClose} />
      <div
        role="dialog"
        aria-modal="true"
        className="relative z-[55] w-full rounded-t-[1.75rem] border border-border bg-card px-4 pb-[calc(var(--waka-bottom-nav-h)+var(--waka-safe-bottom)+1rem)] pt-3 shadow-2xl"
      >
        <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-muted" aria-hidden />
        <p className="truncate px-1 text-sm font-black text-foreground">{productName}</p>
        <ul className="mt-2 space-y-1">
          {items.map((item) => (
            <li key={item.action}>
              <button
                type="button"
                onClick={() => {
                  onClose();
                  onAction(item.action);
                }}
                className={`flex min-h-[48px] w-full items-center rounded-xl px-3 text-left text-sm font-bold active:bg-muted ${
                  item.danger ? "text-rose-700" : "text-foreground"
                }`}
              >
                {item.label}
              </button>
            </li>
          ))}
        </ul>
        <button
          type="button"
          onClick={onClose}
          className="mt-2 flex min-h-[48px] w-full items-center justify-center rounded-xl border border-border text-sm font-bold text-muted-foreground active:bg-muted"
        >
          {t(lang, "cancel")}
        </button>
      </div>
    </AppModalOverlay>
  );
}
