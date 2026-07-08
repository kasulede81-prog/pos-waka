import type { Language } from "../../../types";
import { t } from "../../../lib/i18n";
import type { TransferLocation } from "../../../lib/transferWorkspace";
import { TransferHeader } from "./TransferHeader";
import { XFER_FIELD_LABEL } from "./transferTokens";

type Props = {
  lang: Language;
  source: TransferLocation;
};

export function TransferSourceSelector({ lang, source }: Props) {
  return (
    <section className="rounded-2xl border border-border/60 bg-card p-4 shadow-sm">
      <TransferHeader title={t(lang, "xferSourceTitle")} />
      <label className="mt-3 block">
        <span className={XFER_FIELD_LABEL}>{t(lang, "xferSourceLabel")}</span>
        <input
          type="text"
          readOnly
          value={source.name}
          className="mt-2 min-h-[52px] w-full rounded-2xl border border-input bg-muted/30 px-4 text-base font-bold text-foreground"
        />
      </label>
    </section>
  );
}
