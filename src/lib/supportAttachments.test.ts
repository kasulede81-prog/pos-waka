import { describe, expect, it } from "vitest";
import {
  ALLOWED_AUDIO_MIMES,
  ALLOWED_DOCUMENT_MIMES,
  ALLOWED_IMAGE_MIMES,
  ATTACHMENT_LIMITS,
  attachmentKindForMime,
  buildSupportStoragePath,
  formatAttachmentSize,
  normalizeMimeType,
  pendingAttachmentFromRecording,
  safeAttachmentFilename,
  validateSupportAttachment,
} from "./supportAttachments";

describe("normalizeMimeType", () => {
  it("strips codec parameters from recorder blobs", () => {
    expect(normalizeMimeType("audio/webm;codecs=opus")).toBe("audio/webm");
    expect(normalizeMimeType("Audio/MP4; codecs=mp4a.40.2")).toBe("audio/mp4");
  });
  it("passes through plain types", () => {
    expect(normalizeMimeType("image/png")).toBe("image/png");
  });
});

describe("attachmentKindForMime", () => {
  it("classifies all allowed image/document/audio types", () => {
    for (const m of ALLOWED_IMAGE_MIMES) expect(attachmentKindForMime(m)).toBe("image");
    for (const m of ALLOWED_DOCUMENT_MIMES) expect(attachmentKindForMime(m)).toBe("document");
    for (const m of ALLOWED_AUDIO_MIMES) expect(attachmentKindForMime(m)).toBe("audio");
  });
  it("rejects executables and unknown types as other", () => {
    expect(attachmentKindForMime("application/x-msdownload")).toBe("other");
    expect(attachmentKindForMime("text/html")).toBe("other");
    expect(attachmentKindForMime("")).toBe("other");
  });
});

describe("validateSupportAttachment", () => {
  it("accepts a small png", () => {
    const r = validateSupportAttachment("image/png", 1024);
    expect(r).toEqual({ ok: true, kind: "image", mime: "image/png" });
  });
  it("accepts recorder audio with codec parameters", () => {
    const r = validateSupportAttachment("audio/webm;codecs=opus", 500_000);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.kind).toBe("audio");
  });
  it("rejects oversized images", () => {
    const r = validateSupportAttachment("image/png", ATTACHMENT_LIMITS.maxImageDocBytes + 1);
    expect(r).toEqual({ ok: false, reason: "too_large" });
  });
  it("rejects audio above the audio limit even though it is under the doc limit", () => {
    const r = validateSupportAttachment("audio/webm", ATTACHMENT_LIMITS.maxImageDocBytes + 10);
    expect(r.ok).toBe(true); // 10MB+10B is fine for audio (20MB cap)
    const tooBig = validateSupportAttachment("audio/webm", ATTACHMENT_LIMITS.maxAudioBytes + 1);
    expect(tooBig).toEqual({ ok: false, reason: "too_large" });
  });
  it("rejects zero-byte and unknown types", () => {
    expect(validateSupportAttachment("image/png", 0)).toEqual({ ok: false, reason: "too_large" });
    expect(validateSupportAttachment("application/zip", 100)).toEqual({ ok: false, reason: "bad_type" });
  });
});

describe("safeAttachmentFilename", () => {
  it("keeps ordinary names intact", () => {
    expect(safeAttachmentFilename("receipt photo.jpg")).toBe("receipt photo.jpg");
  });
  it("strips path separators and control characters", () => {
    const cleaned = safeAttachmentFilename('..\\evil/name.png');
    expect(cleaned).not.toContain("/");
    expect(cleaned).not.toContain("\\");
    expect(cleaned).not.toContain("..");
  });
  it("falls back for empty names and truncates long ones", () => {
    expect(safeAttachmentFilename("")).toBe("attachment");
    const long = "a".repeat(300) + ".png";
    expect(safeAttachmentFilename(long).length).toBeLessThan(130);
  });
});

describe("buildSupportStoragePath", () => {
  it("builds the server-enforced layout", () => {
    const p = buildSupportStoragePath("shop-1", "ticket-2", "nonce-3", "my file.pdf");
    expect(p).toBe("support/shop-1/ticket-2/nonce-3/my file.pdf");
  });
  it("sanitizes the filename segment", () => {
    const p = buildSupportStoragePath("s", "t", "n", "../traversal.png");
    expect(p.startsWith("support/s/t/n/")).toBe(true);
    expect(p).not.toContain("..");
  });
});

describe("pendingAttachmentFromRecording", () => {
  it("accepts a webm blob and derives the audio kind", () => {
    const blob = new Blob([new Uint8Array([1, 2, 3])], { type: "audio/webm;codecs=opus" });
    const item = pendingAttachmentFromRecording(blob, "voice.webm");
    expect("error" in item).toBe(false);
    if (!("error" in item)) {
      expect(item.kind).toBe("audio");
      expect(item.mime).toBe("audio/webm");
      expect(item.size).toBe(3);
    }
  });
  it("rejects a non-audio blob", () => {
    const blob = new Blob([new Uint8Array([1])], { type: "image/png" });
    const item = pendingAttachmentFromRecording(blob, "x.png");
    expect(item).toEqual({ error: "bad_type" });
  });
});

describe("formatAttachmentSize", () => {
  it("formats B, KB and MB", () => {
    expect(formatAttachmentSize(512)).toBe("512 B");
    expect(formatAttachmentSize(2048)).toBe("2 KB");
    expect(formatAttachmentSize(5 * 1024 * 1024)).toBe("5.0 MB");
  });
});
