import clsx from "clsx";
import type { ReactNode } from "react";
import { ModalSheet } from "../layout/ModalSheet";
import { WakaButton } from "../ui/wakaPrimitives";
import { Caption, SectionTitle } from "./EnterpriseTypography";
import { enterpriseMotion } from "../../lib/enterpriseMotion";
import { statusTokens } from "../../lib/statusTokens";

export type EnterpriseActionSheetItem = {
  id: string;
  label: string;
  onClick: () => void;
  destructive?: boolean;
  disabled?: boolean;
  icon?: ReactNode;
};

type Props = {
  open: boolean;
  onClose: () => void;
  title?: string;
  subtitle?: string;
  actions: EnterpriseActionSheetItem[];
  cancelLabel: string;
  clearNav?: boolean;
  zIndexClass?: string;
  children?: ReactNode;
};

/**
 * Standardized overflow / quick-action bottom sheet (Phase 22.5).
 */
export function EnterpriseActionSheet({
  open,
  onClose,
  title,
  subtitle,
  actions,
  cancelLabel,
  clearNav = false,
  zIndexClass = "z-[54]",
  children,
}: Props) {
  const run = (item: EnterpriseActionSheetItem) => {
    if (item.disabled) return;
    onClose();
    item.onClick();
  };

  return (
    <ModalSheet
      open={open}
      onClose={onClose}
      clearNav={clearNav}
      zIndexClass={zIndexClass}
      align="bottom"
      maxHeightClass="max-h-[min(88dvh,42rem)]"
      title={
        title || subtitle ? (
          <div className="min-w-0">
            {title ? <SectionTitle as="h2" className="truncate !text-base">{title}</SectionTitle> : null}
            {subtitle ? <Caption className="truncate normal-case">{subtitle}</Caption> : null}
          </div>
        ) : undefined
      }
    >
      {children}
      {actions.length > 0 ? (
        <ul className="space-y-1">
          {actions.map((item) => (
            <li key={item.id}>
              <button
                type="button"
                disabled={item.disabled}
                onClick={() => run(item)}
                className={clsx(
                  "flex min-h-[48px] w-full items-center gap-2 rounded-xl px-3 text-left text-sm font-bold",
                  enterpriseMotion.standard,
                  enterpriseMotion.press,
                  enterpriseMotion.focus,
                  item.destructive ? statusTokens.danger.banner : "text-foreground active:bg-muted",
                )}
              >
                {item.icon}
                {item.label}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      <WakaButton type="button" variant="secondary" className="mt-3 w-full" onClick={onClose}>
        {cancelLabel}
      </WakaButton>
    </ModalSheet>
  );
}
