import { useEffect, useState } from "react";
import {
  resolveWakaLayoutBand,
  WAKA_MEDIA,
  type WakaLayoutBand,
} from "../lib/responsiveBreakpoints";

export function useWakaLayoutBand(): WakaLayoutBand {
  const [band, setBand] = useState<WakaLayoutBand>(() =>
    typeof window !== "undefined" ? resolveWakaLayoutBand(window.innerWidth) : "mobile",
  );

  useEffect(() => {
    const sync = () => setBand(resolveWakaLayoutBand(window.innerWidth));
    sync();
    const mobileMq = window.matchMedia(WAKA_MEDIA.mobile);
    const desktopMq = window.matchMedia(WAKA_MEDIA.desktopUp);
    mobileMq.addEventListener("change", sync);
    desktopMq.addEventListener("change", sync);
    return () => {
      mobileMq.removeEventListener("change", sync);
      desktopMq.removeEventListener("change", sync);
    };
  }, []);

  return band;
}
