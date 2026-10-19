import { jsPDF } from "jspdf";
import type { Language } from "../types";
import {
  hospitalityMenuMarginLabel,
  type HospitalityReportSummary as Summary,
} from "./hospitalityReports";
import { createPdfLayout, pdfGap, pdfLine, sanitizePdfStem } from "./pdfLayout";
import { downloadPdfBlob } from "./documentPrint";
import { t, tTemplate } from "./i18n";

export function buildHospitalityWaiterPdfBlob(lang: Language, report: Summary): Blob {
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const layout = createPdfLayout(doc);
  pdfLine(layout, doc, t(lang, "hospitalityWaiterExportTitle"), { size: 14, bold: true });
  for (const w of report.waiters) {
    pdfLine(
      layout,
      doc,
      `${w.label} — ${w.billCount} bills — UGX ${w.revenueUgx.toLocaleString()} (avg ${w.avgBillUgx.toLocaleString()})`,
      { size: 9 },
    );
  }
  return doc.output("blob");
}

export function buildHospitalityKitchenPdfBlob(lang: Language, report: Summary): Blob {
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const layout = createPdfLayout(doc);
  pdfLine(layout, doc, t(lang, "hospitalityKitchenExportTitle"), { size: 14, bold: true });
  pdfLine(layout, doc, `${t(lang, "hospitalityReportsMix")}:`, { bold: true });
  for (const row of report.categoryMix) {
    pdfLine(layout, doc, `  ${row.kind}: ${row.quantity} · UGX ${row.revenueUgx.toLocaleString()}`, { size: 9 });
  }
  pdfGap(layout, 4);
  pdfLine(layout, doc, t(lang, "hospitalityReportsPeak"), { bold: true });
  for (const h of report.peakHours.slice(0, 12)) {
    pdfLine(layout, doc, `  ${h.label}: ${h.billCount} bills · UGX ${h.revenueUgx.toLocaleString()}`, { size: 9 });
  }
  return doc.output("blob");
}

export function buildHospitalityTableRevenuePdfBlob(lang: Language, report: Summary): Blob {
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const layout = createPdfLayout(doc);
  pdfLine(layout, doc, t(lang, "hospitalityTableExportTitle"), { size: 14, bold: true });
  for (const row of report.tables) {
    pdfLine(layout, doc, `${row.label} — ${row.billCount} · UGX ${row.revenueUgx.toLocaleString()}`, { size: 10 });
  }
  return doc.output("blob");
}

export function buildHospitalityMenuPdfBlob(
  lang: Language,
  report: Summary,
  periodLabel?: string,
): Blob {
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const layout = createPdfLayout(doc);
  const menu = report.menu;

  pdfLine(layout, doc, t(lang, "hospitalityReportsMenuTitle"), { size: 14, bold: true });
  if (periodLabel?.trim()) {
    pdfLine(layout, doc, `${t(lang, "hospitalityMenuExportPeriod")}: ${periodLabel.trim()}`, {
      size: 9,
    });
  }
  pdfLine(layout, doc, t(lang, "hospitalityMenuExportSnapshotNote"), { size: 8 });
  pdfGap(layout, 4);
  pdfLine(
    layout,
    doc,
    `${t(lang, "hospitalityReportsMenuItems")}: ${menu.menuItemCount} · ${t(
      lang,
      "hospitalityReportsReliableCost",
    )}: ${menu.reliableCostCount} · ${t(lang, "hospitalityReportsNeedsCost")}: ${
      menu.needsCostCount
    } · ${t(lang, "hospitalityReportsUnverifiedCost")}: ${menu.unverifiedCostCount}`,
    { size: 9 },
  );

  const writeMenuRows = (
    titleKey: string,
    rows: Summary["menu"]["topDishes"],
    emptyKey: string,
  ) => {
    pdfGap(layout, 6);
    pdfLine(layout, doc, t(lang, titleKey), { bold: true, size: 11 });
    if (rows.length === 0) {
      pdfLine(layout, doc, `  ${t(lang, emptyKey)}`, { size: 9 });
      return;
    }
    for (const row of rows) {
      pdfLine(
        layout,
        doc,
        `  ${row.name} — ${row.unitsSold} · UGX ${row.revenueUgx.toLocaleString()} — ${hospitalityMenuMarginLabel(
          lang,
          row,
        )}`,
        { size: 9 },
      );
    }
  };

  writeMenuRows("hospitalityReportsTopDishes", menu.topDishes, "hospitalityReportsNoMenuSales");
  writeMenuRows("hospitalityReportsTopDrinks", menu.topDrinks, "hospitalityReportsNoMenuSales");
  writeMenuRows("hospitalityReportsLowMargin", menu.lowMargin, "hospitalityReportsNoLowMargin");

  pdfGap(layout, 6);
  pdfLine(layout, doc, t(lang, "hospitalityReportsIngredientGaps"), { bold: true, size: 11 });
  if (menu.ingredientCostGaps.length === 0) {
    pdfLine(layout, doc, `  ${t(lang, "hospitalityReportsNoIngredientGaps")}`, { size: 9 });
  } else {
    for (const gap of menu.ingredientCostGaps) {
      pdfLine(
        layout,
        doc,
        `  ${gap.name || t(lang, "menuCostSelectIngredient")} — ${tTemplate(
          lang,
          "hospitalityReportsIngredientGapRow",
          { count: String(gap.dishCount) },
        )} — ${
          gap.reason === "missing"
            ? t(lang, "hospitalityReportsIngredientMissing")
            : t(lang, "hospitalityReportsIngredientZeroCost")
        }`,
        { size: 9 },
      );
    }
  }

  if (menu.topModifiers.length > 0) {
    pdfGap(layout, 6);
    pdfLine(layout, doc, t(lang, "hospitalityReportsTopModifiers"), { bold: true, size: 11 });
    for (const mod of menu.topModifiers) {
      pdfLine(layout, doc, `  ${mod.optionLabel} — ${mod.count} · ${mod.groupLabel}`, {
        size: 9,
      });
    }
  }

  return doc.output("blob");
}

export async function downloadHospitalityMenuPdf(
  lang: Language,
  report: Summary,
  periodLabel?: string,
): Promise<boolean> {
  return downloadPdfBlob(
    sanitizePdfStem("waka-hospitality-menu") + ".pdf",
    buildHospitalityMenuPdfBlob(lang, report, periodLabel),
  );
}

export async function downloadHospitalityWaiterPdf(lang: Language, report: Summary): Promise<boolean> {
  return downloadPdfBlob(sanitizePdfStem("waka-hospitality-waiters") + ".pdf", buildHospitalityWaiterPdfBlob(lang, report));
}

export async function downloadHospitalityKitchenPdf(lang: Language, report: Summary): Promise<boolean> {
  return downloadPdfBlob(sanitizePdfStem("waka-hospitality-kitchen") + ".pdf", buildHospitalityKitchenPdfBlob(lang, report));
}

export async function downloadHospitalityTablePdf(lang: Language, report: Summary): Promise<boolean> {
  return downloadPdfBlob(sanitizePdfStem("waka-hospitality-tables") + ".pdf", buildHospitalityTableRevenuePdfBlob(lang, report));
}
