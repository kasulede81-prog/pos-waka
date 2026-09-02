import { useEffect, useRef, useState } from "react";
import { usePosStore } from "../store/usePosStore";
import type { HomeDrawerKick } from "../lib/homeLivingMotion";

/**
 * Observes existing `drawerAudit` writes from hardware kicks.
 * Seeds on mount so a historical entry does not replay. Read-only presentation.
 */
export function useHomeCashDrawerKick(): {
  kick: HomeDrawerKick | null;
  settleKick: () => void;
} {
  const latest = usePosStore((s) => s.preferences.hospitalityHardware?.drawerAudit?.[0] ?? null);
  const seeded = useRef(false);
  const lastId = useRef<string | null>(null);
  const [kick, setKick] = useState<HomeDrawerKick | null>(null);

  useEffect(() => {
    if (!latest) return;
    if (!seeded.current) {
      seeded.current = true;
      lastId.current = latest.id;
      return;
    }
    if (latest.id === lastId.current) return;
    lastId.current = latest.id;
    setKick({ id: latest.id, ok: latest.ok, reason: latest.reason });
  }, [latest]);

  return {
    kick,
    settleKick: () => setKick(null),
  };
}
