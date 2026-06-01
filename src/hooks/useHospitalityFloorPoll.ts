import { useEffect } from "react";
import { getDeviceOnline } from "../lib/deviceOnline";
import { pullHospitalityStateFromCloud } from "../offline/hospitalityCloudSync";

const FLOOR_POLL_MS = 15_000;

/** Pull hospitality floor state while on floor/kitchen screens (multi-device sync). */
export function useHospitalityFloorPoll(enabled: boolean) {
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;

    const tick = async (forceFull = false) => {
      if (cancelled || !getDeviceOnline()) return;
      await pullHospitalityStateFromCloud(forceFull);
    };

    void tick(true);
    const id = window.setInterval(() => void tick(false), FLOOR_POLL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [enabled]);
}
