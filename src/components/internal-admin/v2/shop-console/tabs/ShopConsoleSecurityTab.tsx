import { AccountRecoveryPanel } from "../../../AccountRecoveryPanel";
import { AdminPermanentDeletePanel } from "../../../AdminPermanentDeletePanel";
import { RescueActionButton, RescueRow, RescueSection } from "../../../rescue/RescuePrimitives";
import { adminSetShopActive } from "../../../../../lib/wakaInternalAdmin";
import { runShopConsoleRescueAction } from "../rescueRun";
import type { ShopConsoleState } from "../useShopConsoleState";

type Props = {
  ctx: ShopConsoleState;
  onDeleted: () => void;
};

export function ShopConsoleSecurityTab({ ctx, onDeleted }: Props) {
  const { detail, canSupport, busy, previewMode, setBusy, setToast, perms } = ctx;
  if (!detail) return null;

  return (
    <div className="space-y-3">
      {canSupport ? (
        <AccountRecoveryPanel
          lang={ctx.lang}
          shopId={detail.shop.id}
          detail={detail}
          busy={busy}
          previewMode={previewMode}
          onBusy={setBusy}
          onToast={setToast}
        />
      ) : null}

      {perms.canPermanentlyDeleteShopAccount ? (
        <AdminPermanentDeletePanel
          detail={detail}
          busy={busy}
          previewMode={previewMode}
          onBusy={setBusy}
          onToast={setToast}
          onDeleted={onDeleted}
        />
      ) : null}

      {canSupport ? (
        <RescueSection id="account-status" title="Account status" summary="Suspend or reactivate shop access">
          <dl className="grid gap-2 sm:grid-cols-2">
            <RescueRow label="Shop status" value={detail.shop.is_active ? "Active" : "Suspended"} />
          </dl>
          <div className="mt-3">
            <RescueActionButton
              variant={detail.shop.is_active ? "danger" : "primary"}
              disabled={busy}
              onClick={() =>
                void runShopConsoleRescueAction(
                  ctx,
                  detail.shop.is_active ? "rescue_suspend_shop" : "rescue_reactivate_shop",
                  () => adminSetShopActive(detail.shop.id, !detail.shop.is_active),
                )
              }
            >
              {detail.shop.is_active ? "Suspend account" : "Reactivate account"}
            </RescueActionButton>
          </div>
        </RescueSection>
      ) : null}
    </div>
  );
}
