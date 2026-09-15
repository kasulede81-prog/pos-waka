import type { Sale } from "../types";
import { dateKeyKampala } from "./datesUg";
import { scanTodaySalesHead } from "./salesDayIndex";

export function summarizeTodaySales(sales: Sale[], now = new Date(), opts?: { soldByUserId?: string }) {
  const todayKey = dateKeyKampala(now);
  let daySales = scanTodaySalesHead(sales, todayKey).todaySales;
  if (opts?.soldByUserId) {
    daySales = daySales.filter((s) => s.soldByUserId === opts.soldByUserId);
  }
  const cash = daySales.reduce((a, s) => a + s.cashPaidUgx, 0);
  const total = daySales.reduce((a, s) => a + s.totalUgx, 0);
  return { count: daySales.length, cash, total };
}
