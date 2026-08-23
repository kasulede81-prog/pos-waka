import type { Sale } from "../types";
import { dateKeyKampala } from "./datesUg";
import { scanTodaySalesHead } from "./salesDayIndex";
import { saleSoldByMatchesActor, type SellerMatchActor } from "./sellerIdentity";

export function summarizeTodaySales(
  sales: Sale[],
  now = new Date(),
  opts?: { soldByUserId?: string; matchActor?: SellerMatchActor },
) {
  const todayKey = dateKeyKampala(now);
  let daySales = scanTodaySalesHead(sales, todayKey).todaySales;
  if (opts?.matchActor) {
    daySales = daySales.filter((s) => saleSoldByMatchesActor(s, opts.matchActor));
  } else if (opts?.soldByUserId) {
    daySales = daySales.filter((s) => s.soldByUserId === opts.soldByUserId);
  }
  const cash = daySales.reduce((a, s) => a + s.cashPaidUgx, 0);
  const total = daySales.reduce((a, s) => a + s.totalUgx, 0);
  return { count: daySales.length, cash, total };
}
