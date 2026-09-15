import { Copy, Download, FileSpreadsheet, FileText, Printer, Share2 } from "lucide-react";
import type { Language } from "../../../types";
import { t } from "../../../lib/i18n";
import { ModalSheet } from "../../../components/layout/ModalSheet";

type Props = {
  lang: Language;
  open: boolean;
  onClose: () => void;
  onExportPdf: () => void;
  onExportCsv: () => void;
  onExportExcel: () => void;
  onPrint: () => void;
  onShare: () => void;
  onCopy: () => void;
};

export function AnalyticsExportSheet({
  lang,
  open,
  onClose,
  onExportPdf,
  onExportCsv,
  onExportExcel,
  onPrint,
  onShare,
  onCopy,
}: Props) {
  const items = [
    { icon: FileText, label: t(lang, "auditExportPdf"), action: onExportPdf },
    { icon: FileSpreadsheet, label: t(lang, "auditExportCsv"), action: onExportCsv },
    { icon: FileSpreadsheet, label: t(lang, "icExportExcel"), action: onExportExcel },
    { icon: Printer, label: t(lang, "icPrintReport"), action: onPrint },
    { icon: Share2, label: t(lang, "icShareReport"), action: onShare },
    { icon: Copy, label: t(lang, "baCopySummary"), action: onCopy },
  ];

  return (
    <ModalSheet open={open} onClose={onClose} title={t(lang, "baExportTitle")}>
      <ul className="space-y-1">
        {items.map((item) => (
          <li key={item.label}>
            <button
              type="button"
              onClick={() => {
                item.action();
                onClose();
              }}
              className="flex min-h-[52px] w-full items-center gap-3 rounded-2xl px-2 text-left text-sm font-bold text-foreground active:bg-muted"
            >
              <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-waka-50 text-waka-700">
                <item.icon className="h-5 w-5" aria-hidden />
              </span>
              {item.label}
            </button>
          </li>
        ))}
      </ul>
    </ModalSheet>
  );
}

export function AnalyticsExportFab({ lang, onClick }: { lang: Language; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="fixed bottom-[calc(var(--waka-bottom-nav-h,0px)+var(--waka-safe-bottom,0px)+5.5rem)] right-4 z-30 flex h-14 w-14 items-center justify-center rounded-full bg-waka-600 text-white shadow-lg ring-4 ring-white/80 active:scale-95 sm:bottom-8"
      aria-label={t(lang, "baExport")}
    >
      <Download className="h-6 w-6" aria-hidden />
    </button>
  );
}
