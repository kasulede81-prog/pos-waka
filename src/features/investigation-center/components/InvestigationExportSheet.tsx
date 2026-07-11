import { FileJson, FileSpreadsheet, FileText, Printer, Share2 } from "lucide-react";
import type { Language } from "../../../types";
import { t } from "../../../lib/i18n";
import { ModalSheet } from "../../../components/layout/ModalSheet";

type Props = {
  lang: Language;
  open: boolean;
  disabled: boolean;
  onClose: () => void;
  onExportCsv: () => void;
  onExportExcel: () => void;
  onExportPdf: () => void;
  onExportJson: () => void;
  onPrint: () => void;
  onShare: () => void;
};

export function InvestigationExportSheet({
  lang,
  open,
  disabled,
  onClose,
  onExportCsv,
  onExportExcel,
  onExportPdf,
  onExportJson,
  onPrint,
  onShare,
}: Props) {
  const items = [
    { icon: FileSpreadsheet, label: t(lang, "auditExportCsv"), action: onExportCsv },
    { icon: FileSpreadsheet, label: t(lang, "icExportExcel"), action: onExportExcel },
    { icon: FileText, label: t(lang, "auditExportPdf"), action: onExportPdf },
    { icon: FileJson, label: t(lang, "icExportJson"), action: onExportJson },
    { icon: Printer, label: t(lang, "icPrintReport"), action: onPrint },
    { icon: Share2, label: t(lang, "icShareReport"), action: onShare },
  ];

  return (
    <ModalSheet open={open} onClose={onClose} title={t(lang, "icExportTitle")}>
      <ul className="space-y-1">
        {items.map((item) => (
          <li key={item.label}>
            <button
              type="button"
              disabled={disabled}
              onClick={() => {
                item.action();
                onClose();
              }}
              className="flex min-h-[52px] w-full items-center gap-3 rounded-2xl px-2 text-left text-sm font-bold text-foreground active:bg-muted disabled:opacity-40"
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
