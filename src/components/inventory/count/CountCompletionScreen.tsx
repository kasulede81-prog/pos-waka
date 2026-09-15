import { CheckCircle2, Download, History, Plus } from "lucide-react";
import { Link } from "react-router-dom";
import clsx from "clsx";
import type { Language, InventoryCountSession } from "../../../types";
import { t, tTemplate } from "../../../lib/i18n";
import type { InventoryCountVarianceReport } from "../../../lib/inventoryCount";
import {
  downloadInventoryCountCsv,
  downloadInventoryCountPdf,
} from "../../../lib/inventoryCountExport";
import { WIZARD_BTN_FOOTER_BASE } from "./countTokens";

type Props = {
  lang: Language;
  session: InventoryCountSession;
  report: InventoryCountVarianceReport;
  shopName: string;
  onStartNew?: () => void;
};

export function CountCompletionScreen({ lang, session, report, shopName, onStartNew }: Props) {
  const completedAt = session.appliedAt ? new Date(session.appliedAt).toLocaleString() : "—";

  return (
    <section className="rounded-3xl border border-success/30 bg-success-muted/80 p-6 text-center shadow-sm">
      <CheckCircle2 className="mx-auto h-12 w-12 text-success" aria-hidden />
      <h2 className="mt-3 text-xl font-black text-success">{t(lang, "cntCompletionTitle")}</h2>
      <p className="mt-1 text-sm font-semibold text-success">
        {tTemplate(lang, "inventoryCountSessionNumber", { n: String(session.sessionNumber) })}
      </p>

      <dl className="mt-5 grid grid-cols-2 gap-3 text-left text-sm">
        <div className="rounded-2xl border border-success/20 bg-card px-3 py-2">
          <dt className="text-xs font-semibold text-muted-foreground">{t(lang, "inventoryCountProductsCounted")}</dt>
          <dd className="text-lg font-black text-foreground">{report.productsCounted}</dd>
        </div>
        <div className="rounded-2xl border border-success/20 bg-card px-3 py-2">
          <dt className="text-xs font-semibold text-muted-foreground">{t(lang, "inventoryCountTotalVariance")}</dt>
          <dd className="text-lg font-black text-foreground">
            {report.totalVarianceQty >= 0 ? "+" : ""}
            {report.totalVarianceQty}
          </dd>
        </div>
        <div className="col-span-2 rounded-2xl border border-success/20 bg-card px-3 py-2">
          <dt className="text-xs font-semibold text-muted-foreground">{t(lang, "cntCompletionTime")}</dt>
          <dd className="font-black text-foreground">{completedAt}</dd>
        </div>
      </dl>

      <div className="mt-5 flex flex-wrap justify-center gap-2">
        <Link
          to="/stock"
          className={clsx(WIZARD_BTN_FOOTER_BASE, "border border-border bg-card px-4 text-foreground hover:bg-muted")}
        >
          {t(lang, "cntReturnInventory")}
        </Link>
        {onStartNew ? (
          <button
            type="button"
            onClick={onStartNew}
            className={clsx(WIZARD_BTN_FOOTER_BASE, "gap-2 bg-primary px-4 text-primary-foreground hover:bg-primary/90")}
          >
            <Plus className="h-4 w-4" aria-hidden />
            {t(lang, "cntStartNew")}
          </button>
        ) : null}
        <Link
          to="/stock?tab=movements"
          className={clsx(
            WIZARD_BTN_FOOTER_BASE,
            "gap-2 border border-border bg-card px-4 text-foreground hover:bg-muted",
          )}
        >
          <History className="h-4 w-4" aria-hidden />
          {t(lang, "cntViewMovements")}
        </Link>
      </div>

      <div className="mt-4 flex flex-wrap justify-center gap-2">
        <button
          type="button"
          className="inline-flex items-center gap-2 rounded-xl border border-success/30 bg-card px-3 py-2 text-xs font-black text-success"
          onClick={() => downloadInventoryCountCsv(lang, session, `count-${session.sessionNumber}.csv`)}
        >
          <Download className="h-4 w-4" aria-hidden />
          {t(lang, "inventoryCountExportCsv")}
        </button>
        <button
          type="button"
          className="inline-flex items-center gap-2 rounded-xl border border-success/30 bg-card px-3 py-2 text-xs font-black text-success"
          onClick={() =>
            void downloadInventoryCountPdf(lang, session, shopName, `count-${session.sessionNumber}.pdf`)
          }
        >
          <Download className="h-4 w-4" aria-hidden />
          {t(lang, "inventoryCountExportPdf")}
        </button>
      </div>
    </section>
  );
}
