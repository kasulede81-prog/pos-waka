import { useRef, useState } from "react";
import { FileSpreadsheet, Upload } from "lucide-react";
import type { Language } from "../../types";
import { t, tTemplate } from "../../lib/i18n";
import { saveExportedFile } from "../../lib/fileDownload";
import {
  buildWakaProductImportTemplateCsv,
  CSV_IMPORT_MAX_BYTES,
  CSV_IMPORT_MAX_ROWS,
  CSV_IMPORT_TEMPLATE_FILENAME,
  officialCsvImportHeaders,
  parseProductImportCsvFile,
  type ProductImportCsvIssue,
} from "../../lib/productImport";
import type { NormalizedProductImportRow } from "../../lib/productImport/types";
import { ModalSheet } from "../layout/ModalSheet";
import { WakaButton } from "../ui/wakaPrimitives";

type Props = {
  lang: Language;
  open: boolean;
  onClose: () => void;
  onParsed: (rows: NormalizedProductImportRow[]) => void;
};

function issueText(lang: Language, issue: ProductImportCsvIssue): string {
  return tTemplate(lang, issue.messageKey, {
    row: issue.rowNumber != null ? String(issue.rowNumber) : "",
    columns: issue.column ?? issue.params?.columns ?? "",
    max: issue.params?.max ?? String(CSV_IMPORT_MAX_ROWS),
    count: issue.params?.count ?? "",
    maxKb: issue.params?.maxKb ?? String(Math.floor(CSV_IMPORT_MAX_BYTES / 1024)),
  });
}

export function ProductCsvImportSheet({ lang, open, onClose, onParsed }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [issues, setIssues] = useState<ProductImportCsvIssue[]>([]);
  const [busy, setBusy] = useState(false);

  const reset = () => {
    setIssues([]);
    setBusy(false);
    if (inputRef.current) inputRef.current.value = "";
  };

  const handleClose = () => {
    reset();
    onClose();
  };

  const downloadTemplate = async () => {
    await saveExportedFile(
      CSV_IMPORT_TEMPLATE_FILENAME,
      buildWakaProductImportTemplateCsv(),
      "text/csv;charset=utf-8",
    );
  };

  const handleFile = async (file: File | undefined) => {
    if (!file) return;
    setBusy(true);
    setIssues([]);
    const result = await parseProductImportCsvFile(file);
    setBusy(false);
    if (!result.ok) {
      setIssues(result.issues);
      return;
    }
    if (result.issues.length) setIssues(result.issues);
    onParsed(result.rows);
    reset();
  };

  return (
    <ModalSheet
      open={open}
      onClose={handleClose}
      zIndexClass="z-[58]"
      panelClassName="!max-w-lg"
      title={t(lang, "csvImportTitle")}
      footer={
        <div className="flex flex-col gap-2 sm:flex-row">
          <WakaButton type="button" variant="secondary" className="flex-1" onClick={handleClose}>
            {t(lang, "cancel")}
          </WakaButton>
          <WakaButton
            type="button"
            className="flex-1"
            loading={busy}
            onClick={() => inputRef.current?.click()}
          >
            {t(lang, "csvImportChooseFile")}
          </WakaButton>
        </div>
      }
    >
      <p className="mb-3 text-sm font-semibold text-muted-foreground">{t(lang, "csvImportSub")}</p>
      <p className="mb-3 text-sm font-semibold text-foreground">
        {tTemplate(lang, "csvImportLimit", {
          max: String(CSV_IMPORT_MAX_ROWS),
          maxKb: String(Math.floor(CSV_IMPORT_MAX_BYTES / 1024)),
        })}
      </p>
      <div className="mb-3 rounded-2xl border border-border bg-muted/50 px-3 py-2 text-xs font-semibold text-muted-foreground">
        <p className="mb-1 font-black uppercase tracking-wide">{t(lang, "csvImportColumnsLabel")}</p>
        <p>{officialCsvImportHeaders().join(" · ")}</p>
      </div>
      <WakaButton
        type="button"
        variant="secondary"
        className="mb-4 w-full"
        iconLeft={<FileSpreadsheet className="h-4 w-4" aria-hidden />}
        onClick={() => void downloadTemplate()}
      >
        {t(lang, "csvImportDownloadTemplate")}
      </WakaButton>
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        className="flex w-full flex-col items-center gap-2 rounded-2xl border-2 border-dashed border-border bg-card px-4 py-8 text-center"
      >
        <Upload className="h-6 w-6 text-muted-foreground" aria-hidden />
        <span className="text-sm font-black text-foreground">{t(lang, "csvImportDropHint")}</span>
      </button>
      <input
        ref={inputRef}
        type="file"
        accept=".csv,text/csv,text/plain"
        className="sr-only"
        onChange={(e) => void handleFile(e.target.files?.[0])}
      />
      {issues.length ? (
        <ul className="mt-4 space-y-1 rounded-2xl bg-warning-muted px-3 py-2 text-sm font-bold text-warning-foreground">
          {issues.map((issue, i) => (
            <li key={`${issue.kind}-${issue.rowNumber ?? i}-${issue.column ?? ""}`}>{issueText(lang, issue)}</li>
          ))}
        </ul>
      ) : null}
    </ModalSheet>
  );
}
