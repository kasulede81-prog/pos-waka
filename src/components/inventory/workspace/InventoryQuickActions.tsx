import { Link } from "react-router-dom";
import clsx from "clsx";
import type { Language } from "../../../types";
import { t } from "../../../lib/i18n";
import type { InventoryQuickActionDef } from "../../../lib/inventoryWorkspaceTiles";
import { hasActorPermission } from "../../../lib/permissions";
import { useSessionActor } from "../../../context/SessionActorContext";

type Props = {
  lang: Language;
  actions: InventoryQuickActionDef[];
  onAction: (actionId: string) => void;
};

function actionVisual(action: InventoryQuickActionDef): "lead" | "quiet" {
  return action.id === "receive" || action.id === "newProduct" ? "lead" : "quiet";
}

export function InventoryQuickActions({ lang, actions, onAction }: Props) {
  const actor = useSessionActor();
  const visible = actions.filter((a) => !a.perm || hasActorPermission(actor.role, a.perm, actor.permissions));
  if (visible.length === 0) return null;

  const featured = visible.filter((a) => actionVisual(a) === "lead");
  const rest = visible.filter((a) => actionVisual(a) === "quiet");

  const renderAction = (action: InventoryQuickActionDef) => {
    const Icon = action.Icon;
    const visual = actionVisual(action);
    const className = clsx(
      "inventory-action-tile",
      visual === "lead" ? "inventory-action-tile--lead" : "inventory-action-tile--quiet",
      "active:scale-[0.98] motion-reduce:active:scale-100",
    );
    const inner = (
      <>
        <span
          className={clsx(
            "flex h-10 w-10 shrink-0 items-center justify-center rounded-xl",
            visual === "lead" ? "bg-waka-600 text-white" : "bg-muted text-muted-foreground",
          )}
        >
          <Icon className="h-5 w-5" aria-hidden />
        </span>
        <span className="inventory-action-tile__copy">
          <span className="inventory-action-tile__title">{t(lang, action.labelKey)}</span>
          {action.hintKey ? (
            <span className="inventory-action-tile__hint">{t(lang, action.hintKey)}</span>
          ) : null}
        </span>
      </>
    );

    if (action.href) {
      return (
        <Link key={action.id} to={action.href} className={className}>
          {inner}
        </Link>
      );
    }

    return (
      <button
        key={action.id}
        type="button"
        className={className}
        onClick={() => action.actionId && onAction(action.actionId)}
      >
        {inner}
      </button>
    );
  };

  return (
    <section className="inventory-action-zone space-y-2.5">
      <h3 className="inventory-zone-label">{t(lang, "ipWhatToDo")}</h3>
      {featured.length > 0 ? (
        <div className="inventory-action-zone__featured">{featured.map(renderAction)}</div>
      ) : null}
      {rest.length > 0 ? <div className="inventory-action-zone__rest">{rest.map(renderAction)}</div> : null}
    </section>
  );
}
