import type { Language, ReturnRecord, Sale } from "../../types";
import { t } from "../../lib/i18n";
import { DocumentActionsBar } from "./DocumentActionsBar";
import {
  documentReceiptNumber,
  downloadReturnReceiptPdf,
  printReturnReceipt,
  shareReturnReceiptPdf,
  type ReturnReceiptContext,
} from "../../lib/receiptDocuments";

type Props = {
  lang: Language;
  open: boolean;
  ctx: ReturnReceiptContext | null;
  onClose: () => void;
};

export function ReturnReceiptActionsModal({ lang, open, ctx, onClose }: Props) {
  if (!open || !ctx) return null;
  const fail = () => window.alert(t(lang, "receiptPdfFailed"));

  return (
    <div className="fixed inset-0 z-[90] flex items-end justify-center bg-black/40 p-4 sm:items-center" role="dialog" aria-modal>
      <div className="w-full max-w-md rounded-3xl bg-white p-5 shadow-xl">
        <h2 className="text-lg font-black text-stone-900">{t(lang, "returnTitle")}</h2>
        <p className="mt-1 text-sm text-stone-600">{ctx.returnRecord.productName}</p>
        <div className="mt-4">
          <DocumentActionsBar
            lang={lang}
            compact
            onPrint={() => void printReturnReceipt(ctx).then((r) => !r.ok && fail())}
            onDownloadPdf={() => void downloadReturnReceiptPdf(ctx).then((ok) => !ok && fail())}
            onSharePdf={() => void shareReturnReceiptPdf(ctx).then((ok) => !ok && fail())}
          />
        </div>
        <button type="button" className="mt-4 w-full rounded-2xl border-2 border-stone-200 py-3 font-bold" onClick={onClose}>
          {t(lang, "receiptClose")}
        </button>
      </div>
    </div>
  );
}

export function buildReturnReceiptContext(params: {
  shopName: string;
  returnRecord: ReturnRecord;
  sale?: Sale | null;
  cashier: string;
  customerName?: string | null;
}): ReturnReceiptContext {
  return {
    shopName: params.shopName,
    receiptNumber: documentReceiptNumber("RET", params.returnRecord.id, params.returnRecord.createdAt),
    returnRecord: params.returnRecord,
    sale: params.sale,
    cashier: params.cashier,
    customerName: params.customerName,
  };
}
