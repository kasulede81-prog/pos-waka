import { Bookmark, Copy, FileText, Flag, Printer, Share2, Table } from "lucide-react";
import type { AuditLogEntry, Language } from "../../../types";
import { t } from "../../../lib/i18n";
import { auditActionLabel } from "../../../lib/auditCenterDetails";
import { ModalSheet } from "../../../components/layout/ModalSheet";

type Props = {
  lang: Language;
  entry: AuditLogEntry | null;
  open: boolean;
  onClose: () => void;
  onViewDetails: () => void;
  onCopy: () => void;
  onShare: () => void;
  onPrint: () => void;
  onExportPdf: () => void;
  onExportCsv: () => void;
  onReportIssue: () => void;
};

export function ActivityActionsSheet({
  lang,
  entry,
  open,
  onClose,
  onViewDetails,
  onCopy,
  onShare,
  onPrint,
  onExportPdf,
  onExportCsv,
  onReportIssue,
}: Props) {
  if (!entry) return null;

  const items = [
    { icon: FileText, label: t(lang, "icViewDetails"), action: onViewDetails },
    { icon: Copy, label: t(lang, "icCopyDetails"), action: onCopy },
    { icon: Share2, label: t(lang, "icShare"), action: onShare },
    { icon: Printer, label: t(lang, "icPrint"), action: onPrint },
    { icon: FileText, label: t(lang, "auditExportPdf"), action: onExportPdf },
    { icon: Table, label: t(lang, "auditExportCsv"), action: onExportCsv },
    { icon: Bookmark, label: t(lang, "icBookmark"), action: onClose },
    { icon: Flag, label: t(lang, "icReportIssue"), action: onReportIssue, danger: true },
  ];

  return (
    <ModalSheet
      open={open}
      onClose={onClose}
      title={auditActionLabel(lang, entry.action)}
      footer={
        <button type="button" onClick={onClose} className="min-h-[48px] w-full rounded-2xl border-2 border-stone-200 text-sm font-black text-stone-700">
          {t(lang, "cancel")}
        </button>
      }
    >
      <ul className="space-y-1">
        {items.map((item) => (
          <li key={item.label}>
            <button
              type="button"
              onClick={() => {
                item.action();
                if (item.label !== t(lang, "icViewDetails")) onClose();
              }}
              className={`flex min-h-[48px] w-full items-center gap-3 rounded-xl px-2 text-left text-sm font-bold active:bg-stone-50 ${
                item.danger ? "text-rose-700" : "text-stone-800"
              }`}
            >
              <item.icon className="h-4 w-4 shrink-0 opacity-70" aria-hidden />
              {item.label}
            </button>
          </li>
        ))}
      </ul>
    </ModalSheet>
  );
}
