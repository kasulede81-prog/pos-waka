export type HomeTileIntensity = "calm" | "normal" | "high" | "alert";

export type HomeTileLiveStat = {
  /** Resolved label (may include the current month name). */
  label: string;
  value: string;
  trend?: string;
  intensity: HomeTileIntensity;
};

export type HomeExecutiveKpiId = "sales" | "transactions" | "profit" | "cash" | "lowStock" | "debts";

/** Matches EnterpriseKpiCard tones — kept in lib to avoid component↔lib cycles. */
export type HomeExecutiveKpiTone = "default" | "highlight" | "success" | "warning" | "danger";

export type HomeExecutiveKpi = {
  id: HomeExecutiveKpiId;
  label: string;
  value: string;
  hint?: string;
  tone: HomeExecutiveKpiTone;
  to: string;
};

function toneFromIntensity(intensity: HomeTileIntensity): HomeExecutiveKpiTone {
  if (intensity === "alert") return "danger";
  if (intensity === "high") return "highlight";
  if (intensity === "normal") return "default";
  return "default";
}

type BuildInput = {
  todayRevenueLabel: string;
  todayRevenueValue: string;
  todayRevenueIntensity: HomeTileIntensity;
  showTodayRevenue: boolean;
  transactions?: HomeTileLiveStat;
  profit?: HomeTileLiveStat;
  cash?: HomeTileLiveStat;
  inventory?: HomeTileLiveStat;
  debts?: HomeTileLiveStat;
  reportsPath: string;
  receiptsPath: string;
  profitPath: string;
  cashPath: string;
  inventoryPath: string;
  debtsPath: string;
};

/** Map existing home live stats into a compact executive KPI strip (no new math). */
export function buildHomeExecutiveKpis(input: BuildInput): HomeExecutiveKpi[] {
  const out: HomeExecutiveKpi[] = [];

  if (input.showTodayRevenue) {
    out.push({
      id: "sales",
      label: input.todayRevenueLabel,
      value: input.todayRevenueValue,
      tone: toneFromIntensity(input.todayRevenueIntensity),
      to: input.reportsPath,
    });
  }

  if (input.transactions) {
    out.push({
      id: "transactions",
      label: input.transactions.label,
      value: input.transactions.value,
      tone: toneFromIntensity(input.transactions.intensity),
      to: input.receiptsPath,
    });
  }

  if (input.profit) {
    out.push({
      id: "profit",
      label: input.profit.label,
      value: input.profit.value,
      hint: input.profit.trend,
      tone: toneFromIntensity(input.profit.intensity),
      to: input.profitPath,
    });
  }

  if (input.cash) {
    out.push({
      id: "cash",
      label: input.cash.label,
      value: input.cash.value,
      tone: toneFromIntensity(input.cash.intensity),
      to: input.cashPath,
    });
  }

  if (input.inventory) {
    out.push({
      id: "lowStock",
      label: input.inventory.label,
      value: input.inventory.value,
      tone: toneFromIntensity(input.inventory.intensity),
      to: input.inventoryPath,
    });
  }

  if (input.debts) {
    out.push({
      id: "debts",
      label: input.debts.label,
      value: input.debts.value,
      tone: toneFromIntensity(input.debts.intensity),
      to: input.debtsPath,
    });
  }

  return out;
}
