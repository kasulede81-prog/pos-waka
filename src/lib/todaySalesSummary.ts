import type { Sale } from "../types";
import { dateKeyKampala } from "./datesUg";
import { scanTodaySalesHead } from "./salesDayIndex";

export function summarizeTodaySales(sales: Sale[], now = new Date()) {
  const todayKey = dateKeyKampala(now);
  const daySales = scanTodaySalesHead(sales, todayKey).todaySales;
  const cash = daySales.reduce((a, s) => a + s.cashPaidUgx, 0);
  const total = daySales.reduce((a, s) => a + s.totalUgx, 0);
  return { count: daySales.length, cash, total };
}
