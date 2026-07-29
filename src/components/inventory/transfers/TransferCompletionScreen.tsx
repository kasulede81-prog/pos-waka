import { CheckCircle2, History, Plus } from "lucide-react";
import { Link } from "react-router-dom";
import clsx from "clsx";
import type { Language } from "../../../types";
import { t } from "../../../lib/i18n";
import type { TransferDraftMetadata } from "../../../lib/transferWorkspace";
import { summarizeTransferDraft } from "../../../lib/transferWorkspace";
import type { Product } from "../../../types";
import { WIZARD_BTN_FOOTER_BASE } from "./transferTokens";

type Props = {
  lang: Language;
  draft: TransferDraftMetadata;
  products: Product[];
  onCreateAnother?: () => void;
};

export function TransferCompletionScreen({ lang, draft, products, onCreateAnother }: Props) {
  const summary = summarizeTransferDraft(draft.lines, products);
  const completedAt = new Date(draft.preparedAt).toLocaleString();

  return (
    <section className="rounded-3xl border border-success/30 bg-success-muted/80 p-6 text-center shadow-sm">
      <CheckCircle2 className="mx-auto h-12 w-12 text-success" aria-hidden />
      <h2 className="mt-3 text-xl font-black text-success">{t(lang, "xferCompletionTitle")}</h2>
      <p className="mt-1 text-sm font-semibold text-success">{t(lang, "xferCompletionSub")}</p>

      <dl className="mt-5 grid grid-cols-2 gap-3 text-left text-sm">
        <div className="rounded-2xl border border-success/20 bg-card px-3 py-2">
          <dt className="text-xs font-semibold text-muted-foreground">{t(lang, "xferSummaryProducts")}</dt>
          <dd className="text-lg font-black text-foreground">{summary.productCount}</dd>
        </div>
        <div className="rounded-2xl border border-success/20 bg-card px-3 py-2">
          <dt className="text-xs font-semibold text-muted-foreground">{t(lang, "xferSummaryUnits")}</dt>
          <dd className="text-lg font-black text-foreground">{summary.totalUnits}</dd>
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
        {onCreateAnother ? (
          <button
            type="button"
            onClick={onCreateAnother}
            className={clsx(WIZARD_BTN_FOOTER_BASE, "gap-2 bg-primary px-4 text-primary-foreground hover:bg-primary/90")}
          >
            <Plus className="h-4 w-4" aria-hidden />
            {t(lang, "xferCreateAnother")}
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
    </section>
  );
}
