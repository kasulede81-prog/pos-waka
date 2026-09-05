import type { LucideIcon } from "lucide-react";
import { AlertTriangle, Ban, CircleCheck, CircleDollarSign } from "lucide-react";
import clsx from "clsx";
import type { ReactNode } from "react";
import { MonoNumber } from "../../../components/enterprise/EnterpriseTypography";
import { WakaButton } from "../../../components/ui/wakaPrimitives";

type PurchaseStatus = "paid" | "partial" | "unpaid" | "voided";

type HeaderProps = {
  icon: LucideIcon;
  title: string;
  subtitle: string;
  action?: ReactNode;
};

export function InventoryRoomHeader({ icon: Icon, title, subtitle, action }: HeaderProps) {
  return (
    <header className="inventory-room-header inventory-enter inventory-enter--0">
      <div className="flex min-w-0 items-start gap-3">
        <span className="inventory-hub-mark">
          <Icon className="h-5 w-5" aria-hidden />
        </span>
        <div className="min-w-0">
          <h2 className="inventory-room-title">{title}</h2>
          <p className="inventory-room-sub">{subtitle}</p>
        </div>
      </div>
      {action}
    </header>
  );
}

type EmptyProps = {
  icon: LucideIcon;
  title: string;
  actionLabel?: string;
  onAction?: () => void;
};

export function InventoryRoomEmpty({ icon: Icon, title, actionLabel, onAction }: EmptyProps) {
  return (
    <div className="inventory-room-empty">
      <span className="inventory-hub-mark mx-auto">
        <Icon className="h-5 w-5" aria-hidden />
      </span>
      <p className="inventory-room-empty__title">{title}</p>
      {actionLabel && onAction ? (
        <WakaButton type="button" variant="primary" onClick={onAction}>
          {actionLabel}
        </WakaButton>
      ) : null}
    </div>
  );
}

type MetricTone = "default" | "warning" | "danger" | "ok";

export function InventoryRoomMetric({
  icon: Icon,
  label,
  value,
  tone = "default",
}: {
  icon: LucideIcon;
  label: string;
  value: string;
  tone?: MetricTone;
}) {
  return (
    <div className={clsx("inventory-ops-metric", tone !== "default" && `inventory-ops-metric--${tone}`)}>
      <span className="inventory-ops-icon">
        <Icon className="h-4 w-4" aria-hidden />
      </span>
      <span className="inventory-ops-copy">
        <span className="inventory-ops-label">{label}</span>
        <MonoNumber className="inventory-ops-value">{value}</MonoNumber>
      </span>
    </div>
  );
}

export function InventoryPurchaseStatus({ kind, label }: { kind: PurchaseStatus; label: string }) {
  const Icon =
    kind === "paid" ? CircleCheck : kind === "partial" ? CircleDollarSign : kind === "unpaid" ? AlertTriangle : Ban;
  return (
    <span className={clsx("inventory-pay-status", `inventory-pay-status--${kind}`)}>
      <Icon className="h-3.5 w-3.5" aria-hidden />
      {label}
    </span>
  );
}
