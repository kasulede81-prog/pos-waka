import { useEffect, useState } from "react";
import type { Language } from "../types";
import { dateKeyKampala, monthKeyKampala } from "../lib/datesUg";
import { formatMonthLabelKampala } from "../lib/dateFilterLabels";

const TICK_MS = 30_000;

/** Kampala calendar keys that refresh on a timer and when the tab becomes visible (month rolls on the 1st). */
export function useKampalaCalendarTick(lang: Language) {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const refresh = () => setNow(new Date());
    const intervalId = window.setInterval(refresh, TICK_MS);
    const onVisible = () => {
      if (document.visibilityState === "visible") refresh();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearInterval(intervalId);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);

  const todayKey = dateKeyKampala(now);
  const monthKey = monthKeyKampala(now);
  const monthLabel = formatMonthLabelKampala(monthKey, lang);

  return { now, todayKey, monthKey, monthLabel };
}
