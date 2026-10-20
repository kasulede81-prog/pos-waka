import { jsPDF } from "jspdf";
import type { Language } from "../types";
import {
  formatHospitalityCancellationTime,
  formatHospitalityDurationMinutes,
  formatIngredientDemandQty,
  hospitalityCancellationReasonLabel,
  hospitalityCancellationSourceLabel,
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

export type HospitalityPrepBatchExportBlock = {
  title: string;
  hint: string;
  lines: string[];
};

/**
 * Format the already-computed prep-batch report for export. Production totals are
 * historical; current remaining portions/value are labelled separately and never
 * added into production totals. Missing evidence is reported as missing, not zero.
 */
export function buildHospitalityPrepBatchExportBlock(
  lang: Language,
  report: Summary,
): HospitalityPrepBatchExportBlock {
  const batches = report.prepBatches;
  const lines: string[] = [];

  if (batches.rows.length === 0) {
    lines.push(t(lang, "hospitalityPrepBatchReportEmpty"));
  } else {
    lines.push(
      `${t(lang, "hospitalityPrepBatchReportBatches")}: ${batches.batchCount} · ${t(
        lang,
        "hospitalityPrepBatchReportPortions",
      )}: ${formatIngredientDemandQty(batches.portionsPrepared)} · ${t(
        lang,
        "menuPrepBatchCost",
      )}: UGX ${batches.totalBatchCostUgx.toLocaleString()}`,
    );
    if (batches.yieldMeasuredBatchCount > 0) {
      lines.push(
        `${t(lang, "hospitalityPrepBatchReportYieldVariance")}: ${
          batches.yieldVariancePortions > 0 ? "+" : ""
        }${formatIngredientDemandQty(batches.yieldVariancePortions)} (${t(
          lang,
          "hospitalityPrepBatchReportExpected",
        )}: ${formatIngredientDemandQty(batches.expectedPortions)} · ${t(
          lang,
          "hospitalityPrepBatchReportActual",
        )}: ${formatIngredientDemandQty(batches.actualPortions)})`,
      );
    }
    lines.push(
      `${t(lang, "hospitalityPrepBatchReportWasted")}: ${formatIngredientDemandQty(
        batches.wastedPortions,
      )} · ${t(lang, "menuPrepWasteValue")}: UGX ${batches.wasteValueUgx.toLocaleString()}`,
    );
    lines.push(
      `${t(lang, "hospitalityPrepBatchReportCurrentStock")} — ${t(
        lang,
        "menuPrepRemaining",
      )}: ${formatIngredientDemandQty(batches.remainingPortions)} · ${t(
        lang,
        "menuPrepRemainingValue",
      )}: UGX ${batches.remainingValueUgx.toLocaleString()}`,
    );

    for (const row of batches.rows) {
      lines.push(`  ${row.productName} — ${row.preparedAt.slice(0, 10)} — ${row.status}`);
      const yieldParts = [
        `${t(lang, "hospitalityPrepBatchReportPortions")}: ${formatIngredientDemandQty(
          row.portionsPrepared,
        )}`,
      ];
      // Expected and actual are shown together only when BOTH are recorded; a missing
      // actual yield must not be implied as zero variance.
      if (row.expectedPortions != null && row.actualPortions != null) {
        yieldParts.push(
          `${t(lang, "hospitalityPrepBatchReportExpected")}: ${formatIngredientDemandQty(
            row.expectedPortions,
          )}`,
          `${t(lang, "hospitalityPrepBatchReportActual")}: ${formatIngredientDemandQty(
            row.actualPortions,
          )}`,
          `${t(lang, "hospitalityPrepBatchReportYieldVariance")}: ${
            (row.yieldVariancePortions ?? 0) > 0 ? "+" : ""
          }${formatIngredientDemandQty(row.yieldVariancePortions ?? 0)}`,
        );
      }
      lines.push(`    ${yieldParts.join(" · ")}`);
      lines.push(
        `    ${t(lang, "hospitalityPrepBatchReportCostPerPlate")}: UGX ${row.costPerPlateUgx.toLocaleString()} · ${t(
          lang,
          "menuPrepBatchCost",
        )}: UGX ${row.totalBatchCostUgx.toLocaleString()}${
          row.legacyCost ? ` · ${t(lang, "menuPrepLegacyBatch")}` : ""
        }`,
      );
      lines.push(
        `    ${t(lang, "hospitalityPrepBatchReportWasted")}: ${formatIngredientDemandQty(
          row.wastedPortions,
        )} · ${t(lang, "menuPrepWasteValue")}: UGX ${row.wasteValueUgx.toLocaleString()} · ${t(
          lang,
          "menuPrepRemaining",
        )}: ${formatIngredientDemandQty(row.remainingPortions)} · ${t(
          lang,
          "menuPrepRemainingValue",
        )}: UGX ${row.remainingValueUgx.toLocaleString()}`,
      );
    }
  }

  const yieldUnknownCount = batches.batchCount - batches.yieldMeasuredBatchCount;
  if (batches.rows.length > 0 && yieldUnknownCount > 0) {
    lines.push(
      tTemplate(lang, "hospitalityPrepBatchReportYieldUnknown", {
        count: String(yieldUnknownCount),
      }),
    );
  }
  if (batches.rows.length > 0 && batches.legacyBatchCount > 0) {
    lines.push(
      tTemplate(lang, "hospitalityPrepBatchReportLegacy", {
        count: String(batches.legacyBatchCount),
      }),
    );
  }
  if (batches.undatedBatchCount > 0) {
    lines.push(
      tTemplate(lang, "hospitalityPrepBatchReportUndated", {
        count: String(batches.undatedBatchCount),
      }),
    );
  }
  if (batches.outsideRangeBatchCount > 0) {
    lines.push(
      tTemplate(lang, "hospitalityPrepBatchReportOutsideRange", {
        count: String(batches.outsideRangeBatchCount),
      }),
    );
  }

  return {
    title: t(lang, "hospitalityPrepBatchReportTitle"),
    hint: t(lang, "hospitalityPrepBatchReportHint"),
    lines,
  };
}

export function buildHospitalityKitchenPdfBlob(
  lang: Language,
  report: Summary,
  periodLabel?: string,
): Blob {
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const layout = createPdfLayout(doc);
  pdfLine(layout, doc, t(lang, "hospitalityKitchenExportTitle"), { size: 14, bold: true });
  if (periodLabel?.trim()) {
    pdfLine(layout, doc, `${t(lang, "hospitalityMenuExportPeriod")}: ${periodLabel.trim()}`, {
      size: 9,
    });
  }

  const batchBlock = buildHospitalityPrepBatchExportBlock(lang, report);
  pdfGap(layout, 6);
  pdfLine(layout, doc, batchBlock.title, { bold: true, size: 11 });
  pdfLine(layout, doc, batchBlock.hint, { size: 8 });
  for (const line of batchBlock.lines) {
    pdfLine(layout, doc, line, { size: 8 });
  }

  pdfGap(layout, 6);
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

  const serviceBlock = buildHospitalityTableServiceExportBlock(lang, report);
  pdfGap(layout, 6);
  pdfLine(layout, doc, serviceBlock.title, { bold: true, size: 11 });
  pdfLine(layout, doc, serviceBlock.hint, { size: 8 });
  for (const line of serviceBlock.lines) {
    pdfLine(layout, doc, line, { size: 8 });
  }

  return doc.output("blob");
}

export type HospitalityTableServiceExportBlock = {
  title: string;
  hint: string;
  lines: string[];
};

/**
 * Format the already-computed table service report for export. Completed
 * turnover requires the shared session's openedAt and closedAt; open-table
 * elapsed time is reported separately and is never counted as turnover.
 */
export function buildHospitalityTableServiceExportBlock(
  lang: Language,
  report: Summary,
): HospitalityTableServiceExportBlock {
  const service = report.tableService;
  const lines: string[] = [];

  if (service.completedCount === 0) {
    lines.push(t(lang, "hospitalityTableServiceNoCompleted"));
  } else {
    lines.push(
      `${t(lang, "hospitalityTableServiceCompleted")}: ${service.completedCount} · ${t(
        lang,
        "hospitalityTableServiceAvgDuration",
      )}: ${formatHospitalityDurationMinutes(service.averageCompletedDurationMinutes ?? 0)}`,
    );
    lines.push(t(lang, "hospitalityTableServiceByTable"));
    for (const row of service.completedByTable) {
      lines.push(
        `  ${row.tableLabel} — ${tTemplate(lang, "hospitalityTableServiceCycles", {
          count: String(row.completedCount),
        })} — ${t(lang, "hospitalityTableServiceAvgDuration")}: ${formatHospitalityDurationMinutes(
          row.averageDurationMinutes,
        )}`,
      );
    }
  }

  lines.push(`${t(lang, "hospitalityTableServiceOpenNow")}: ${service.openCount}`);
  if (service.openCount === 0) {
    lines.push(t(lang, "hospitalityTableServiceNoOpen"));
  } else {
    lines.push(t(lang, "hospitalityTableServiceOpenTables"));
    for (const row of service.openTables) {
      const status =
        row.status === "payment_pending"
          ? t(lang, "hospitalityTableServiceStatusPaymentPending")
          : t(lang, "hospitalityTableServiceStatusOpen");
      lines.push(
        `  ${row.tableLabel} — ${status} — ${formatHospitalityDurationMinutes(
          row.elapsedMinutes,
        )} — ${tTemplate(lang, "hospitalityTableServiceGuests", {
          count: String(row.guestCount),
        })}`,
      );
    }
    lines.push(`  ${t(lang, "hospitalityTableServiceOpenNote")}`);
  }

  if (service.missingEndEvidenceCount > 0 || service.invalidIntervalCount > 0) {
    lines.push(
      tTemplate(lang, "hospitalityTableServiceExcludedNote", {
        missing: String(service.missingEndEvidenceCount),
        invalid: String(service.invalidIntervalCount),
      }),
    );
  }

  return {
    title: t(lang, "hospitalityTableServiceTitle"),
    hint: t(lang, "hospitalityTableServiceHint"),
    lines,
  };
}

export type HospitalityCancellationExportBlock = {
  title: string;
  hint: string;
  valueNote: string;
  lines: string[];
};

/**
 * Format the already-computed cancellation report for export. It reads
 * `report.cancellations` and never recalculates or invents cancellation events.
 */
export function buildHospitalityCancellationExportBlock(
  lang: Language,
  report: Summary,
): HospitalityCancellationExportBlock {
  const cancellations = report.cancellations;
  const lines: string[] = [];

  if (cancellations.rows.length === 0) {
    lines.push(t(lang, "hospitalityCancelledItemsEmpty"));
  } else {
    lines.push(
      `${t(lang, "hospitalityCancelledLineVoids")}: ${cancellations.lineVoidCount} · ${t(
        lang,
        "hospitalityCancelledWholeBillVoids",
      )}: ${cancellations.wholeBillVoidCount} · ${t(
        lang,
        "hospitalityCancelledKitchenCancellations",
      )}: ${cancellations.kitchenCancellationCount}`,
    );
    lines.push(
      `${t(lang, "hospitalityCancelledRecordedValue")}: UGX ${cancellations.totalRecordedValueUgx.toLocaleString()} · ${t(
        lang,
        "hospitalityCancelledSaleTimeCost",
      )}: UGX ${cancellations.totalSaleTimeCostUgx.toLocaleString()} (${tTemplate(
        lang,
        "hospitalityCancelledSnapshotCoverage",
        { count: String(cancellations.saleTimeCostRowCount) },
      )})`,
    );

    for (const row of cancellations.rows) {
      lines.push(
        `${row.productName} — ${formatIngredientDemandQty(row.quantity)} — ${hospitalityCancellationSourceLabel(
          lang,
          row.source,
        )}`,
      );
      const details = [
        formatHospitalityCancellationTime(row.occurredAt),
        row.actorLabel,
        hospitalityCancellationReasonLabel(lang, row),
        row.contextLabel,
        row.ticketNumber != null
          ? tTemplate(lang, "hospitalityCancelledTicketLabel", {
              number: String(row.ticketNumber),
            })
          : null,
      ].filter((value): value is string => Boolean(value));
      lines.push(`  ${details.join(" · ")}`);
      if (row.recordedValueUgx != null) {
        lines.push(
          `  ${t(lang, "hospitalityCancelledRecordedValue")}: UGX ${row.recordedValueUgx.toLocaleString()}`,
        );
      }
      if (row.saleTimeCostUgx != null) {
        lines.push(
          `  ${
            row.saleTimeCostBasis === "partial"
              ? t(lang, "hospitalityCancelledSaleTimeCostPartial")
              : t(lang, "hospitalityCancelledSaleTimeCost")
          }: UGX ${row.saleTimeCostUgx.toLocaleString()}`,
        );
      } else {
        lines.push(
          `  ${
            row.source === "kitchen_ticket"
              ? t(lang, "hospitalityCancelledNoSnapshot")
              : t(lang, "hospitalityCancelledCostNotRecorded")
          }`,
        );
      }
    }
  }

  return {
    title: t(lang, "hospitalityCancelledItemsTitle"),
    hint: t(lang, "hospitalityCancelledItemsHint"),
    valueNote: t(lang, "hospitalityCancelledValueNote"),
    lines,
  };
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

  const demand = menu.ingredientDemand;
  pdfGap(layout, 6);
  pdfLine(layout, doc, t(lang, "hospitalityIngredientDemandTitle"), { bold: true, size: 11 });
  pdfLine(layout, doc, t(lang, "hospitalityIngredientDemandHint"), { size: 8 });
  if (
    demand.rows.length === 0 &&
    demand.missingIngredients.length === 0 &&
    demand.noRecipeDishes.length === 0
  ) {
    pdfLine(layout, doc, `  ${t(lang, "hospitalityIngredientDemandEmpty")}`, { size: 9 });
  } else {
    for (const row of demand.rows) {
      pdfLine(
        layout,
        doc,
        `  ${row.name} — ${formatIngredientDemandQty(row.quantityBase)} ${row.unit} — ${
          row.costStatus === "trusted"
            ? `UGX ${(row.estimatedCostUgx ?? 0).toLocaleString()}`
            : t(lang, "hospitalityIngredientDemandCostUnavailable")
        } — ${tTemplate(lang, "hospitalityIngredientDemandDishCount", {
          count: String(row.dishCount),
        })}`,
        { size: 9 },
      );
    }
    if (demand.noRecipeDishes.length > 0 || demand.missingIngredients.length > 0) {
      pdfGap(layout, 4);
      pdfLine(layout, doc, t(lang, "hospitalityIngredientDemandGapsTitle"), {
        bold: true,
        size: 9,
      });
      for (const row of demand.noRecipeDishes) {
        pdfLine(
          layout,
          doc,
          `  ${tTemplate(
            lang,
            row.reason === "missing_product"
              ? "hospitalityIngredientDemandMissingProduct"
              : "hospitalityIngredientDemandNoRecipe",
            { name: row.name, units: String(row.unitsSold) },
          )}`,
          { size: 9 },
        );
      }
      for (const gap of demand.missingIngredients) {
        pdfLine(
          layout,
          doc,
          `  ${tTemplate(lang, "hospitalityIngredientDemandMissingIngredient", {
            name: gap.ingredientId,
            quantity: formatIngredientDemandQty(gap.quantityBase),
            unit: gap.unit ? ` ${gap.unit}` : "",
            count: String(gap.dishCount),
          })}`,
          { size: 9 },
        );
      }
    }
  }

  const cancellationBlock = buildHospitalityCancellationExportBlock(lang, report);
  pdfGap(layout, 6);
  pdfLine(layout, doc, cancellationBlock.title, { bold: true, size: 11 });
  pdfLine(layout, doc, cancellationBlock.hint, { size: 8 });
  for (const line of cancellationBlock.lines) {
    pdfLine(layout, doc, line, { size: 8 });
  }
  pdfLine(layout, doc, cancellationBlock.valueNote, { size: 7 });

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

export async function downloadHospitalityKitchenPdf(
  lang: Language,
  report: Summary,
  periodLabel?: string,
): Promise<boolean> {
  return downloadPdfBlob(
    sanitizePdfStem("waka-hospitality-kitchen") + ".pdf",
    buildHospitalityKitchenPdfBlob(lang, report, periodLabel),
  );
}

export async function downloadHospitalityTablePdf(lang: Language, report: Summary): Promise<boolean> {
  return downloadPdfBlob(sanitizePdfStem("waka-hospitality-tables") + ".pdf", buildHospitalityTableRevenuePdfBlob(lang, report));
}
