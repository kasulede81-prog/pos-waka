import { useMemo } from "react";
import { CalendarCheck } from "lucide-react";
import type { Language } from "../../types";
import { t, tTemplate } from "../../lib/i18n";
import { summarizeTodaySales } from "../../lib/todaySalesSummary";
import { useDeferredSales } from "../../hooks/useDeferredSales";
import { OfficeNavCard } from "./OfficeNavCard";

type Props = { lang: Language; highlight?: boolean };

export function OfficeCloseDayCard({ lang, highlight = true }: Props) {
  const sales = useDeferredSales();
  const summary = useMemo(() => summarizeTodaySales(sales), [sales]);

  const subtitle =
    summary.total > 0
      ? tTemplate(lang, "officeCloseDayPreview", { amount: summary.total.toLocaleString() })
      : t(lang, "officeCardCloseDaySub");

  return (
    <OfficeNavCard
      to="/close-day"
      title={t(lang, "officeCardCloseDay")}
      subtitle={subtitle}
      Icon={CalendarCheck}
      highlight={highlight}
      trailing={summary.count > 0 ? String(summary.count) : undefined}
    />
  );
}
