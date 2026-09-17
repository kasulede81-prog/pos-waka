import { useRef, useState } from "react";
import clsx from "clsx";
import { FileText, Image as ImageIcon, Music, Paperclip, X } from "lucide-react";
import type { Language } from "../../types";
import { t } from "../../lib/i18n";
import {
  ATTACHMENT_LIMITS,
  formatAttachmentSize,
  pendingAttachmentFromFile,
  pendingAttachmentFromRecording,
  type PendingAttachment,
} from "../../lib/supportAttachments";
import { AudioRecorderButton } from "./AudioRecorderButton";

/**
 * Shared attachment staging strip for the merchant composer and the internal
 * WAKA console: paperclip file picker, microphone recorder, pending chips with
 * name/size/remove. Nothing is uploaded until the message is sent.
 */
export function AttachmentComposer({
  lang,
  pending,
  onChange,
  onRecordError,
  disabled,
  idPrefix,
}: {
  lang: Language;
  pending: PendingAttachment[];
  onChange: (next: PendingAttachment[]) => void;
  onRecordError: (message: string) => void;
  disabled?: boolean;
  idPrefix: string;
}) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [pickError, setPickError] = useState<string | null>(null);

  const pickFiles = (files: FileList | null) => {
    setPickError(null);
    if (!files || files.length === 0) return;
    const next = [...pending];
    for (const file of Array.from(files)) {
      if (next.length >= ATTACHMENT_LIMITS.maxFilesPerMessage) {
        setPickError(t(lang, "supportCenterTooManyAttachments"));
        break;
      }
      const item = pendingAttachmentFromFile(file);
      if ("error" in item) {
        setPickError(
          item.error === "too_large"
            ? t(lang, "supportCenterAttachmentTooLarge")
            : t(lang, "supportCenterAttachmentBadType"),
        );
        continue;
      }
      next.push(item);
    }
    onChange(next);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const addRecording = (blob: Blob) => {
    setPickError(null);
    const stamp = new Date();
    const name = `voice-note-${stamp.getHours().toString().padStart(2, "0")}${stamp
      .getMinutes()
      .toString()
      .padStart(2, "0")}.webm`;
    const item = pendingAttachmentFromRecording(blob, name);
    if ("error" in item) {
      onRecordError(
        item.error === "too_large"
          ? t(lang, "supportCenterAttachmentTooLarge")
          : t(lang, "supportCenterAttachmentBadType"),
      );
      return;
    }
    if (pending.length >= ATTACHMENT_LIMITS.maxFilesPerMessage) {
      onRecordError(t(lang, "supportCenterTooManyAttachments"));
      return;
    }
    onChange([...pending, item]);
  };

  const kindIcon = (kind: PendingAttachment["kind"]) =>
    kind === "image" ? (
      <ImageIcon className="h-3.5 w-3.5" aria-hidden />
    ) : kind === "audio" ? (
      <Music className="h-3.5 w-3.5" aria-hidden />
    ) : (
      <FileText className="h-3.5 w-3.5" aria-hidden />
    );

  return (
    <div className="space-y-2">
      {pending.length > 0 ? (
        <ul className="flex flex-wrap gap-1.5">
          {pending.map((p) => (
            <li
              key={p.id}
              className="inline-flex max-w-full items-center gap-1.5 rounded-xl bg-muted/80 py-1.5 pl-2.5 pr-1.5 text-xs font-bold text-foreground ring-1 ring-border"
            >
              <span className="shrink-0 text-muted-foreground">{kindIcon(p.kind)}</span>
              <span className="max-w-[160px] truncate">{p.name}</span>
              <span className="shrink-0 text-[10px] font-semibold text-muted-foreground">
                {formatAttachmentSize(p.size)}
              </span>
              <button
                type="button"
                disabled={disabled}
                onClick={() => onChange(pending.filter((x) => x.id !== p.id))}
                className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-background text-muted-foreground shadow-sm active:scale-95 disabled:opacity-40"
                aria-label={t(lang, "supportCenterRemoveAttachment")}
              >
                <X className="h-3 w-3" aria-hidden />
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      {pickError ? <p className="text-xs font-bold text-rose-600">{pickError}</p> : null}

      <div className="flex items-center gap-2">
        <input
          ref={fileInputRef}
          id={`${idPrefix}-file`}
          type="file"
          multiple
          accept="image/jpeg,image/png,image/webp,application/pdf"
          className="sr-only"
          onChange={(e) => pickFiles(e.target.files)}
        />
        <button
          type="button"
          disabled={disabled}
          onClick={() => fileInputRef.current?.click()}
          className={clsx(
            "inline-flex h-11 w-11 items-center justify-center rounded-xl border border-border bg-muted/60 text-muted-foreground shadow-sm transition-colors hover:text-foreground active:scale-95 disabled:opacity-40",
          )}
          aria-label={t(lang, "supportCenterAttachButton")}
          title={t(lang, "supportCenterAttachButton")}
        >
          <Paperclip className="h-4.5 w-4.5" aria-hidden />
        </button>
        <AudioRecorderButton
          lang={lang}
          disabled={disabled}
          onRecorded={addRecording}
          onError={onRecordError}
        />
      </div>
    </div>
  );
}
