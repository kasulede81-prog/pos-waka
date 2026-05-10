import type { Language, Sale } from "../types";
import { t } from "./i18n";
import { dateKeyKampala } from "./datesUg";

/** Plain-text summary for WhatsApp / SMS / print */
export function buildDailyReportText(lang: Language, dateKey: string, sales: Sale[]): string {
  const daySales = sales.filter((s) => dateKeyKampala(s.createdAt) === dateKey);
  const total = daySales.reduce((a, s) => a + s.totalUgx, 0);
  const cash = daySales.reduce((a, s) => a + s.cashPaidUgx, 0);
  const debt = daySales.reduce((a, s) => a + s.debtUgx, 0);
  const profit = daySales.reduce((a, s) => a + s.estimatedProfitUgx, 0);
  const lines: string[] = [];
  lines.push(`${t(lang, "appName")} — ${t(lang, "exportReportHeading")} ${dateKey}`);
  lines.push(`${t(lang, "salesCount")}: ${daySales.length}`);
  lines.push(`${t(lang, "totalSales")}: UGX ${total.toLocaleString()}`);
  lines.push(`${t(lang, "cashInHand")}: UGX ${cash.toLocaleString()}`);
  lines.push(`${t(lang, "creditLabel")}: UGX ${debt.toLocaleString()}`);
  lines.push(`${t(lang, "estimatedProfit")}: UGX ${profit.toLocaleString()}`);
  lines.push("");
  lines.push(t(lang, "exportReportFooter"));
  return lines.join("\n");
}

export async function shareText(body: string, title: string): Promise<boolean> {
  const nav = navigator as Navigator & { share?: (data: ShareData) => Promise<void> };
  if (typeof nav.share === "function") {
    try {
      await nav.share({ title, text: body });
      return true;
    } catch {
      return false;
    }
  }
  return false;
}
