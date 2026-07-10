import { AdminCollapsible } from "../../../adminUi";
import { AdminAiSetupPanel } from "../../AdminAiSetupPanel";
import { ShopAiSettingsPanel } from "../../ShopAiSettingsPanel";
import type { ShopConsoleState } from "../useShopConsoleState";

type Props = { ctx: ShopConsoleState };

export function ShopConsoleAiTab({ ctx }: Props) {
  const { detail, canSubs, previewMode } = ctx;
  if (!detail) return null;

  return (
    <div className="space-y-3">
      <AdminCollapsible title="Shop AI settings" summary="Per-shop AI access and limits" defaultOpen>
        <ShopAiSettingsPanel shopId={detail.shop.id} canManage={canSubs} previewMode={previewMode} />
      </AdminCollapsible>

      <AdminCollapsible title="AI business setup" summary="Onboarding templates">
        <AdminAiSetupPanel
          shopId={detail.shop.id}
          shopName={detail.shop.name}
          businessType={detail.shop.business_type ?? "kiosk_duka"}
          canManage={canSubs}
          previewMode={previewMode}
        />
      </AdminCollapsible>
    </div>
  );
}
