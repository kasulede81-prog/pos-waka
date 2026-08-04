import { AdminCollapsible } from "../../../adminUi";
import { ShopVisionSettingsPanel } from "../../ShopVisionSettingsPanel";
import type { ShopConsoleState } from "../useShopConsoleState";

type Props = { ctx: ShopConsoleState };

export function ShopConsoleVisionTab({ ctx }: Props) {
  const { detail, canSubs, previewMode } = ctx;
  if (!detail) return null;

  return (
    <div className="space-y-3">
      <AdminCollapsible
        title="Vision Management"
        summary="Included with WAKA subscription — capacity overrides, installer, future add-ons"
        defaultOpen
      >
        <ShopVisionSettingsPanel shopId={detail.shop.id} canManage={canSubs} previewMode={previewMode} />
      </AdminCollapsible>
    </div>
  );
}
