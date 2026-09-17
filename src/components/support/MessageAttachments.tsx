import { useEffect, useState } from "react";
import clsx from "clsx";
import { ExternalLink, FileText, Image as ImageIcon, Music } from "lucide-react";
import type { Language } from "../../types";
import { t } from "../../lib/i18n";
import {
  createAttachmentSignedUrl,
  formatAttachmentSize,
  type MerchantSupportAttachmentRow,
} from "../../lib/supportAttachments";

/**
 * Renders the attachments of one support message. Files are displayed through
 * short-lived signed URLs (created on demand for opening, so a long-lived
 * conversation never pins an expired URL). Tombstoned attachments (removed by
 * the closed-ticket cleanup) render as a minimal historical note.
 */

function AttachmentCard({ lang, attachment }: { lang: Language; attachment: MerchantSupportAttachmentRow }) {
  const [thumbUrl, setThumbUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    if (attachment.deletedAt) return;
    if (attachment.attachmentKind === "image" || attachment.attachmentKind === "audio") {
      void createAttachmentSignedUrl(attachment.storagePath).then((r) => {
        if (!alive) return;
        if (r.ok) setThumbUrl(r.url);
        else setFailed(true);
      });
    }
    return () => {
      alive = false;
    };
  }, [attachment.storagePath, attachment.deletedAt, attachment.attachmentKind]);

  const openFresh = async () => {
    const r = await createAttachmentSignedUrl(attachment.storagePath);
    if (r.ok) window.open(r.url, "_blank", "noopener,noreferrer");
  };

  if (attachment.deletedAt) {
    return (
      <p className="mt-1.5 inline-flex items-center gap-1 rounded-lg bg-muted/60 px-2 py-1 text-[10px] font-semibold italic text-muted-foreground">
        <FileText className="h-3 w-3" aria-hidden />
        {t(lang, "supportCenterAttachmentRemoved")} · {attachment.originalFilename}
      </p>
    );
  }

  if (failed) {
    return (
      <p className="mt-1.5 inline-flex items-center gap-1 rounded-lg bg-rose-50 px-2 py-1 text-[10px] font-bold text-rose-700 ring-1 ring-rose-200">
        {t(lang, "supportCenterAttachmentUnavailable")}
      </p>
    );
  }

  if (attachment.attachmentKind === "image") {
    return (
      <button
        type="button"
        onClick={() => void openFresh()}
        className="mt-1.5 block overflow-hidden rounded-xl border border-border bg-background shadow-sm transition-opacity hover:opacity-90"
        title={t(lang, "supportCenterOpenAttachment")}
      >
        {thumbUrl ? (
          <img src={thumbUrl} alt={attachment.originalFilename} className="max-h-56 w-auto object-contain" loading="lazy" />
        ) : (
          <span className="flex h-20 w-32 animate-pulse items-center justify-center text-muted-foreground">
            <ImageIcon className="h-5 w-5" aria-hidden />
          </span>
        )}
      </button>
    );
  }

  if (attachment.attachmentKind === "audio") {
    return (
      <span className="mt-1.5 flex items-center gap-1.5">
        <Music className="h-3.5 w-3.5 shrink-0 opacity-70" aria-hidden />
        <audio controls preload="metadata" src={thumbUrl ?? undefined} className="h-9 max-w-[240px]" />
      </span>
    );
  }

  return (
    <button
      type="button"
      onClick={() => void openFresh()}
      className={clsx(
        "mt-1.5 inline-flex max-w-full items-center gap-2 rounded-xl border border-border bg-background px-2.5 py-2 text-left shadow-sm transition-colors hover:bg-muted/60",
      )}
      title={t(lang, "supportCenterOpenAttachment")}
    >
      <FileText className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
      <span className="min-w-0">
        <span className="block max-w-[200px] truncate text-xs font-bold">{attachment.originalFilename}</span>
        <span className="block text-[10px] font-semibold text-muted-foreground">
          {attachment.mimeType} · {formatAttachmentSize(attachment.fileSizeBytes)}
        </span>
      </span>
      <ExternalLink className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
    </button>
  );
}

export function MessageAttachments({
  lang,
  attachments,
}: {
  lang: Language;
  attachments: MerchantSupportAttachmentRow[];
}) {
  if (attachments.length === 0) return null;
  return (
    <div className="space-y-0.5">
      {attachments.map((a) => (
        <AttachmentCard key={a.id} lang={lang} attachment={a} />
      ))}
    </div>
  );
}
