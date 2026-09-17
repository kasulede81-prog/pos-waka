import { supabase } from "./supabase";

/**
 * Phase 2.5 support attachments.
 *
 * Binaries live in the PRIVATE bucket "merchant-support-attachments" under the
 * server-enforced layout  support/{shop_id}/{ticket_id}/{nonce}/{filename}.
 * The database (merchant_support_attachments) only stores metadata. Upload and
 * download are both gated by RLS on storage.objects; display uses short-lived
 * signed URLs. Limits below mirror the SECURITY DEFINER reply RPC — keep them
 * in sync (they exist in both places on purpose: fast client feedback + server
 * enforcement).
 */

export const SUPPORT_ATTACHMENTS_BUCKET = "merchant-support-attachments";

export const ATTACHMENT_LIMITS = {
  maxFilesPerMessage: 5,
  maxImageDocBytes: 10 * 1024 * 1024, // 10 MB
  maxAudioBytes: 20 * 1024 * 1024, // 20 MB
  signedUrlSeconds: 300,
} as const;

export const ALLOWED_IMAGE_MIMES = ["image/jpeg", "image/png", "image/webp"] as const;
export const ALLOWED_DOCUMENT_MIMES = ["application/pdf"] as const;
export const ALLOWED_AUDIO_MIMES = [
  "audio/webm",
  "audio/mp4",
  "audio/mpeg",
  "audio/ogg",
  "audio/wav",
] as const;

export type SupportAttachmentKind = "image" | "document" | "audio" | "other";

/** Strip MIME parameters ("audio/webm;codecs=opus" -> "audio/webm"). */
export function normalizeMimeType(mime: string): string {
  return (mime || "").split(";")[0].trim().toLowerCase();
}

export function attachmentKindForMime(mime: string): SupportAttachmentKind {
  const m = normalizeMimeType(mime);
  if ((ALLOWED_IMAGE_MIMES as readonly string[]).includes(m)) return "image";
  if ((ALLOWED_DOCUMENT_MIMES as readonly string[]).includes(m)) return "document";
  if ((ALLOWED_AUDIO_MIMES as readonly string[]).includes(m)) return "audio";
  return "other";
}

export type AttachmentValidation =
  | { ok: true; kind: SupportAttachmentKind; mime: string }
  | { ok: false; reason: "bad_type" | "too_large" };

export function validateSupportAttachment(
  mime: string,
  sizeBytes: number,
): AttachmentValidation {
  const m = normalizeMimeType(mime);
  const kind = attachmentKindForMime(m);
  if (kind === "other") return { ok: false, reason: "bad_type" };
  const limit = kind === "audio" ? ATTACHMENT_LIMITS.maxAudioBytes : ATTACHMENT_LIMITS.maxImageDocBytes;
  if (!sizeBytes || sizeBytes > limit) return { ok: false, reason: "too_large" };
  return { ok: true, kind, mime: m };
}

/** Deterministic, display-safe filename (no path separators, no control chars). */
export function safeAttachmentFilename(name: string): string {
  // Strip control characters and path separators without regex backslash games.
  const stripped = Array.from(name || "attachment")
    .map((ch) => {
      const code = ch.charCodeAt(0);
      return code <= 31 || code === 127 ? "_" : ch;
    })
    .join("");
  const unsafe = ["/", ":", "*", "?", '"', "<", ">", "|", "\\"];
  const noDots = stripped.split("..").join("_");
  const cleaned = unsafe
    .reduce((acc, c) => acc.split(c).join("_"), noDots)
    .replace(/\s+/g, " ")
    .trim();
  const base = cleaned || "attachment";
  return base.length > 120 ? `${base.slice(0, 60)}…${base.slice(-40)}` : base;
}

export function buildSupportStoragePath(
  shopId: string,
  ticketId: string,
  nonce: string,
  filename: string,
): string {
  return `support/${shopId}/${ticketId}/${nonce}/${safeAttachmentFilename(filename)}`;
}

export type PendingAttachment = {
  id: string;
  name: string;
  mime: string;
  size: number;
  kind: SupportAttachmentKind;
  blob: Blob;
};

export function pendingAttachmentFromFile(file: File): PendingAttachment | { error: string } {
  const check = validateSupportAttachment(file.type, file.size);
  if (!check.ok) return { error: check.reason };
  return {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
    name: file.name || "attachment",
    mime: check.mime,
    size: file.size,
    kind: check.kind,
    blob: file,
  };
}

export function pendingAttachmentFromRecording(
  blob: Blob,
  fallbackName: string,
): PendingAttachment | { error: string } {
  const mime = normalizeMimeType(blob.type || "audio/webm");
  const check = validateSupportAttachment(mime, blob.size);
  if (!check.ok) return { error: check.reason };
  if (check.kind !== "audio") return { error: "bad_type" };
  return {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
    name: fallbackName,
    mime: check.mime,
    size: blob.size,
    kind: "audio",
    blob,
  };
}

export type UploadedAttachment = {
  storagePath: string;
  originalFilename: string;
  mimeType: string;
  fileSizeBytes: number;
  attachmentKind: SupportAttachmentKind;
};

export type UploadStagedResult =
  | { ok: true; uploads: UploadedAttachment[] }
  | { ok: false; error: string; uploadedPaths: string[] };

/** Upload every staged blob, tracking paths so a failed send can unwind staging. */
export async function uploadStagedAttachments(input: {
  shopId: string;
  ticketId: string;
  pending: PendingAttachment[];
}): Promise<UploadStagedResult> {
  if (!supabase) return { ok: false, error: "offline", uploadedPaths: [] };
  if (input.pending.length > ATTACHMENT_LIMITS.maxFilesPerMessage) {
    return { ok: false, error: "too_many_attachments", uploadedPaths: [] };
  }
  const uploads: UploadedAttachment[] = [];
  const uploadedPaths: string[] = [];
  for (const p of input.pending) {
    const nonce = crypto.randomUUID();
    const storagePath = buildSupportStoragePath(input.shopId, input.ticketId, nonce, p.name);
    const { error } = await supabase.storage
      .from(SUPPORT_ATTACHMENTS_BUCKET)
      .upload(storagePath, p.blob, { contentType: p.mime, upsert: false });
    if (error) {
      return { ok: false, error: error.message, uploadedPaths };
    }
    uploadedPaths.push(storagePath);
    uploads.push({
      storagePath,
      originalFilename: safeAttachmentFilename(p.name),
      mimeType: p.mime,
      fileSizeBytes: p.size,
      attachmentKind: p.kind,
    });
  }
  return { ok: true, uploads };
}

/** Best-effort removal of staged files when the message RPC failed (RLS allows
 *  the uploader to remove objects that have no attachment metadata yet). */
export async function removeStagedAttachments(storagePaths: string[]): Promise<void> {
  if (!supabase || storagePaths.length === 0) return;
  await supabase.storage.from(SUPPORT_ATTACHMENTS_BUCKET).remove(storagePaths);
}

export type MerchantSupportAttachmentRow = {
  id: string;
  messageId: string;
  ticketId: string;
  shopId: string;
  storagePath: string;
  originalFilename: string;
  mimeType: string;
  fileSizeBytes: number;
  attachmentKind: SupportAttachmentKind;
  createdAt: string;
  deletedAt: string | null;
};

const ATTACHMENT_SELECT =
  "id, message_id, ticket_id, shop_id, storage_path, original_filename, mime_type, file_size_bytes, attachment_kind, created_at, deleted_at";

function mapAttachment(x: Record<string, unknown>): MerchantSupportAttachmentRow {
  return {
    id: String(x.id ?? ""),
    messageId: String(x.message_id ?? ""),
    ticketId: String(x.ticket_id ?? ""),
    shopId: String(x.shop_id ?? ""),
    storagePath: String(x.storage_path ?? ""),
    originalFilename: String(x.original_filename ?? "attachment"),
    mimeType: String(x.mime_type ?? ""),
    fileSizeBytes: Number(x.file_size_bytes ?? 0),
    attachmentKind: (x.attachment_kind as SupportAttachmentKind) ?? "other",
    createdAt: String(x.created_at ?? ""),
    deletedAt: x.deleted_at != null ? String(x.deleted_at) : null,
  };
}

export async function listTicketAttachments(
  ticketId: string,
): Promise<{ ok: true; attachments: MerchantSupportAttachmentRow[] } | { ok: false; error: string }> {
  if (!supabase) return { ok: false, error: "offline" };
  const { data, error } = await supabase
    .from("merchant_support_attachments")
    .select(ATTACHMENT_SELECT)
    .eq("ticket_id", ticketId)
    .order("created_at", { ascending: true });
  if (error) return { ok: false, error: error.message };
  return { ok: true, attachments: (Array.isArray(data) ? data : []).map((x) => mapAttachment(x as Record<string, unknown>)) };
}

/** Short-lived signed URL for viewing/playing/downloading one attachment. */
export async function createAttachmentSignedUrl(
  storagePath: string,
): Promise<{ ok: true; url: string } | { ok: false; error: string }> {
  if (!supabase) return { ok: false, error: "offline" };
  const { data, error } = await supabase.storage
    .from(SUPPORT_ATTACHMENTS_BUCKET)
    .createSignedUrl(storagePath, ATTACHMENT_LIMITS.signedUrlSeconds);
  if (error || !data?.signedUrl) return { ok: false, error: error?.message ?? "sign_failed" };
  return { ok: true, url: data.signedUrl };
}

export function formatAttachmentSize(bytes: number): string {
  if (!bytes || bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
