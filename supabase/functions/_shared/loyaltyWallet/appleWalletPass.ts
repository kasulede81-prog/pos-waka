/**
 * Apple Wallet loyalty pass builder (Phase 06).
 *
 * Edge runtime copy: supabase/functions/_shared/loyaltyWallet/appleWalletPass.ts
 * Pure TypeScript — no Node/Deno builtins. Cryptographic signing is injected
 * via `ApplePassSigner` because Apple requires a Pass Type ID certificate
 * issued through the Apple Developer Program (server-side secret).
 *
 * Produces a complete .pkpass bundle: pass.json + manifest.json + signature
 * (+ optional images), packed as a store-only (uncompressed) ZIP, which the
 * ZIP/PNG specification and Apple both accept.
 */

import type { ApplePassSigner, LoyaltyPassInput } from "./walletPassTypes.ts";

export type ApplePassFileSet = {
  passJson: Record<string, unknown>;
  /** Optional bundle images by archive name (e.g. "logo.png", "icon.png"). */
  images?: Record<string, Uint8Array>;
};

/** Apple has no dedicated loyalty pass style — storeCard is the standard. */
export function buildApplePassJson(
  input: LoyaltyPassInput,
  opts: { passTypeIdentifier: string; teamIdentifier: string; serialNumber: string },
): Record<string, unknown> {
  return {
    formatVersion: 1,
    passTypeIdentifier: opts.passTypeIdentifier,
    serialNumber: opts.serialNumber,
    teamIdentifier: opts.teamIdentifier,
    organizationName: input.shopName,
    description: `${input.shopName} loyalty`,
    logoText: input.shopName,
    foregroundColor: normalizeHex(input.foregroundColor ?? "rgb(28, 25, 23)"),
    backgroundColor: normalizeHex(input.backgroundColor ?? "rgb(250, 204, 21)"),
    labelColor: normalizeHex(input.labelColor ?? "rgb(87, 83, 78)"),
    barcode: {
      message: input.qrPayload,
      format: "PKBarcodeFormatQR",
      messageEncoding: "iso-8859-1",
      altText: input.qrToken.slice(0, 16),
    },
    storeCard: {
      headerFields: [
        {
          key: "points",
          label: "Points",
          value: input.balancePoints,
          changeMessage: "Balance is now %@ pts",
        },
      ],
      secondaryFields: [
        { key: "member", label: "Member", value: input.customerName },
        { key: "rule", label: "Earns", value: input.programLabel },
      ],
      backFields: [
        {
          key: "terms",
          label: "Terms",
          value: "Show this code at the counter to earn and redeem points.",
        },
      ],
    },
  };
}

function normalizeHex(color: string): string {
  const c = color.trim();
  if (/^#[0-9a-fA-F]{6}$/.test(c)) {
    const n = parseInt(c.slice(1), 16);
    return `rgb(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255})`;
  }
  return c;
}

// ---------- CRC-32 (IEEE 802.3, polynomial 0xEDB88320) ----------

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

export function crc32(data: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < data.length; i += 1) {
    crc = (CRC_TABLE[(crc ^ data[i]) & 0xff] ^ (crc >>> 8)) >>> 0;
  }
  return (crc ^ 0xffffffff) >>> 0;
}

// ---------- Store-only ZIP writer ----------

const textEncoder = new TextEncoder();

function u16(v: number): Uint8Array {
  return new Uint8Array([v & 0xff, (v >> 8) & 0xff]);
}

function u32(v: number): Uint8Array {
  return new Uint8Array([v & 0xff, (v >> 8) & 0xff, (v >> 16) & 0xff, (v >>> 24) & 0xff]);
}

function concat(parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, p) => sum + p.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

const DOS_DATE_1980_01_01 = 0x21; // ((1980-1980)<<9) | (1<<5) | 1

export type ZipEntry = { name: string; data: Uint8Array };

/** Minimal store-only (no compression) ZIP — valid .pkpass container. */
export function buildStoreOnlyZip(entries: ZipEntry[]): Uint8Array {
  const localParts: Uint8Array[] = [];
  const centralParts: Uint8Array[] = [];
  let offset = 0;

  for (const entry of entries) {
    const nameBytes = textEncoder.encode(entry.name);
    const crc = crc32(entry.data);
    const size = entry.data.length;

    const localHeader = concat([
      u32(0x04034b50), // local file header signature
      u16(20), // version needed
      u16(0), // flags
      u16(0), // method: store
      u16(0), // mod time (fixed for determinism)
      u16(DOS_DATE_1980_01_01),
      u32(crc),
      u32(size), // compressed size
      u32(size), // uncompressed size
      u16(nameBytes.length),
      u16(0), // extra length
      nameBytes,
    ]);
    localParts.push(localHeader, entry.data);

    const centralHeader = concat([
      u32(0x02014b50), // central directory signature
      u16(20), // version made by
      u16(20), // version needed
      u16(0), // flags
      u16(0), // method
      u16(0),
      u16(DOS_DATE_1980_01_01),
      u32(crc),
      u32(size),
      u32(size),
      u16(nameBytes.length),
      u16(0), // extra
      u16(0), // comment
      u16(0), // disk number
      u16(0), // internal attrs
      u32(0), // external attrs
      u32(offset), // local header offset
      nameBytes,
    ]);
    centralParts.push(centralHeader);
    offset += localHeader.length + entry.data.length;
  }

  const centralDirectory = concat(centralParts);
  const endOfCentralDirectory = concat([
    u32(0x06054b50),
    u16(0), // disk
    u16(0), // cd start disk
    u16(entries.length),
    u16(entries.length),
    u32(centralDirectory.length),
    u32(offset),
    u16(0), // comment length
  ]);

  return concat([...localParts, centralDirectory, endOfCentralDirectory]);
}

// ---------- Manifest + bundle ----------

async function sha1Hex(data: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-1", data as BufferSource);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function buildManifest(
  files: Record<string, Uint8Array>,
): Promise<Record<string, string>> {
  const manifest: Record<string, string> = {};
  for (const [name, data] of Object.entries(files)) {
    manifest[name] = await sha1Hex(data);
  }
  return manifest;
}

export type PkpassResult = { pkpass: Uint8Array; files: string[] };

/**
 * Assembles the .pkpass bundle. The signature over manifest.json is
 * produced by the injected signer (Apple pass certificate + WWDR).
 */
export async function packPkpass(
  files: ApplePassFileSet,
  signer: ApplePassSigner,
): Promise<PkpassResult> {
  const bundle: Record<string, Uint8Array> = {
    "pass.json": textEncoder.encode(JSON.stringify(files.passJson)),
    ...Object.fromEntries(
      Object.entries(files.images ?? {}).map(([name, data]) => [name, data]),
    ),
  };
  const manifestJson = textEncoder.encode(JSON.stringify(await buildManifest(bundle)));
  const signature = await signer.signManifest(manifestJson);
  if (!signature || signature.length === 0) throw new Error("empty_pass_signature");

  const entries: ZipEntry[] = [
    ...Object.entries(bundle).map(([name, data]) => ({ name, data })),
    { name: "manifest.json", data: manifestJson },
    { name: "signature", data: signature },
  ];
  return { pkpass: buildStoreOnlyZip(entries), files: entries.map((e) => e.name) };
}
