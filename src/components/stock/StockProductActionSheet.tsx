import type { Language } from "../../types";
import { t } from "../../lib/i18n";
import { EnterpriseActionSheet } from "../enterprise/EnterpriseActionSheet";

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
  const actions: { id: Action; label: string; destructive?: boolean }[] = [];
  if (canSell) actions.push({ id: "sell", label: sellLabel ?? t(lang, "stockCardSell") });
  if (canAdd) actions.push({ id: "edit", label: t(lang, "stockCardEdit") });
  if (canAdd) actions.push({ id: "duplicate", label: t(lang, "stockActionDuplicate") });
  if (canRestock) actions.push({ id: "restock", label: t(lang, "stockGoRestock") });
  if (canRemove) actions.push({ id: "remove", label: t(lang, "stockActionRemove"), destructive: true });

  return (
    <EnterpriseActionSheet
      open={open}
      onClose={onClose}
      title={productName}
      cancelLabel={t(lang, "cancel")}
      clearNav={false}
      actions={actions.map((item) => ({
        id: item.id,
        label: item.label,
        destructive: item.destructive,
        onClick: () => onAction(item.id),
      }))}
    />
  );
}
