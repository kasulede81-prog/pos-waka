import { useEffect } from "react";
import { useBusinessBuilder } from "../context/BusinessBuilderContext";
import { deriveScenePatchFromShop } from "../lib/businessBuilder/syncSceneFromShop";
import { useSessionActor } from "../context/SessionActorContext";
import { usePosStore } from "../store/usePosStore";

/** Keeps BusinessBuilderScene aligned with the live shop on dashboard routes. */
export function useHomeBusinessSceneSync(): void {
  const { patchScene } = useBusinessBuilder();
  const actor = useSessionActor();
  const shopName = usePosStore((s) => s.preferences.shopDisplayName);
  const businessType = usePosStore((s) => s.preferences.businessType);
  const sellingStyle = usePosStore((s) => s.preferences.shopSellingStyle);
  const phoneE164 = usePosStore((s) => s.preferences.shopPhoneE164);
  const productCount = usePosStore((s) => s.products.length);

  useEffect(() => {
    patchScene(
      deriveScenePatchFromShop({
        shopName,
        ownerName: actor.displayName,
        businessType,
        sellingStyle: sellingStyle ?? null,
        phoneE164,
        productCount,
      }),
    );
  }, [shopName, businessType, sellingStyle, phoneE164, productCount, actor.displayName, patchScene]);
}
