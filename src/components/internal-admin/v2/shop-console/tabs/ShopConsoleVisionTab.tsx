import { AdminCollapsible } from "../../../adminUi";
import { ShopVisionSettingsPanel } from "../../ShopVisionSettingsPanel";
import type { ShopConsoleState } from "../useShopConsoleState";

type Props = { ctx: ShopConsoleState };

export function ShopConsoleVisionTab({ ctx }: Props) {
  const { detail, perms, previewMode } = ctx;
  if (!detail) return null;

  return (
    <div className="space-y-3">
      <AdminCollapsible
        title="Vision Management"
        summary="Included with WAKA subscription — capacity overrides, installer, future add-ons"
        defaultOpen
      >
        {/*
          `canManageShopVision`, NOT `canShopSubs`: the server accepts only
          super_admin | operations_admin here, so shipping/subscriptions roles
          were being shown an editable panel that always failed to save.
        */}
        <ShopVisionSettingsPanel
          shopId={detail.shop.id}
          canManage={perms.canManageShopVision}
          previewMode={previewMode}
        />
      </AdminCollapsible>
    </div>
  );
}
