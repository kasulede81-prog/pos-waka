import type { Language } from "../../types";
import { t } from "../../lib/i18n";
import { EnterpriseActionSheet } from "../enterprise/EnterpriseActionSheet";

type Action = "edit" | "duplicate" | "restock" | "remove" | "sell";

type Props = {
  lang: Language;
  open: boolean;
  productName: string;
  canAdd: boolean;
  /** Catalog edit — store `updateProduct` requires `stock.adjust`. Defaults to `canAdd`. */
  canEdit?: boolean;
  canRestock: boolean;
  canRemove: boolean;
  canSell?: boolean;
  sellLabel?: string;
  onClose: () => void;
  onAction: (action: Action) => void;
};

export function resolveStockProductSheetActionIds(input: {
  canAdd: boolean;
  canEdit?: boolean;
  canRestock: boolean;
  canRemove: boolean;
  canSell?: boolean;
}): Action[] {
  const canEdit = input.canEdit ?? input.canAdd;
  const ids: Action[] = [];
  if (input.canSell) ids.push("sell");
  if (canEdit) ids.push("edit");
  if (input.canAdd) ids.push("duplicate");
  if (input.canRestock) ids.push("restock");
  if (input.canRemove) ids.push("remove");
  return ids;
}

export function StockProductActionSheet({
  lang,
  open,
  productName,
  canAdd,
  canEdit,
  canRestock,
  canRemove,
  canSell = false,
  sellLabel,
  onClose,
  onAction,
}: Props) {
  const actions: { id: Action; label: string; destructive?: boolean }[] = [];
  for (const id of resolveStockProductSheetActionIds({ canAdd, canEdit, canRestock, canRemove, canSell })) {
    if (id === "sell") actions.push({ id, label: sellLabel ?? t(lang, "stockCardSell") });
    else if (id === "edit") actions.push({ id, label: t(lang, "stockCardEdit") });
    else if (id === "duplicate") actions.push({ id, label: t(lang, "stockActionDuplicate") });
    else if (id === "restock") actions.push({ id, label: t(lang, "stockGoRestock") });
    else actions.push({ id, label: t(lang, "stockActionRemove"), destructive: true });
  }

  return (
    <EnterpriseActionSheet
      open={open}
      onClose={onClose}
      title={productName}
      cancelLabel={t(lang, "cancel")}
      clearNav
      zIndexClass="z-[var(--waka-z-pos-overlay,80)]"
      actions={actions.map((item) => ({
        id: item.id,
        label: item.label,
        destructive: item.destructive,
        onClick: () => onAction(item.id),
      }))}
    />
  );
}
