import { useEffect } from "react";
import { registerAndroidBackHandler } from "../lib/androidBackStack";

/** Register a conditional Android back handler while `active` is true. */
export function useAndroidBackHandler(
  id: string,
  priority: number,
  active: boolean,
  onBack: () => void,
): void {
  useEffect(() => {
    if (!active) return;
    return registerAndroidBackHandler(id, priority, () => {
      onBack();
      return true;
    });
  }, [id, priority, active, onBack]);
}
