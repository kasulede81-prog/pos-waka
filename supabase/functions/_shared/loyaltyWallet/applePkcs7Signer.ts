/**
 * Apple pass PKCS#7 detached signature (Phase 06).
 *
 * Edge runtime copy: supabase/functions/_shared/loyaltyWallet/applePkcs7Signer.ts
 *
 * Builds a PKCS#7 SignedData (RFC 2315) signature over the manifest using
 * WebCrypto only — the format Apple requires for .pkpass `signature` files.
 * Supports RSA pass certificates (RSASSA-PKCS1-v1.5 + SHA-256), which is what
 * the Apple Developer portal issues for Pass Type IDs.
 *
 * The certificate chain (pass certificate + Apple WWDR) is embedded from PEM
 * secrets; the manifest bytes are signed exactly as provided.
 */

import type { ApplePassSigner } from "./walletPassTypes.ts";

// ---------- Minimal DER encoder ----------

class DerWriter {
  private parts: number[] = [];

  byte(b: number): this {
    this.parts.push(b & 0xff);
    return this;
  }

  bytes(data: Uint8Array | number[]): this {
    for (const b of data) this.parts.push(b & 0xff);
    return this;
  }

  private lengthBytes(length: number): number[] {
    if (length < 0x80) return [length];
    const out: number[] = [];
    let n = length;
    while (n > 0) {
      out.unshift(n & 0xff);
      n >>= 8;
    }
    return [0x80 | out.length, ...out];
  }

  raw(content: number[] | Uint8Array): this {
    this.parts.push(...content);
    return this;
  }

  tlv(tag: number, content: number[] | Uint8Array | DerWriter): this {
    const body =
      content instanceof DerWriter
        ? content.toBytes()
        : content instanceof Uint8Array
          ? [...content]
          : content;
    this.parts.push(tag, ...this.lengthBytes(body.length), ...body);
    return this;
  }

  sequence(content: DerWriter): this {
    return this.tlv(0x30, content);
  }

  set(content: DerWriter): this {
    return this.tlv(0x31, content);
  }

  integer(bytes: Uint8Array | number[]): this {
    let body = bytes instanceof Uint8Array ? [...bytes] : [...bytes];
    // Strip leading zero bytes; prepend one if the high bit is set.
    while (body.length > 1 && body[0] === 0) body.shift();
    if (body[0] & 0x80) body = [0, ...body];
    return this.tlv(0x02, body);
  }

  integerNumber(value: number): this {
    const bytes: number[] = [];
    let n = value;
    do {
      bytes.unshift(n & 0xff);
      n = Math.floor(n / 256);
    } while (n > 0);
    return this.integer(bytes);
  }

  octetString(data: Uint8Array | DerWriter): this {
    return this.tlv(0x04, data);
  }

  objectIdentifier(oid: string): this {
    const segments = oid.split(".").map(Number);
    const body = [segments[0] * 40 + segments[1]];
    for (const seg of segments.slice(2)) {
      let n = seg;
      const stack = [n & 0x7f];
      n >>= 7;
      while (n > 0) {
        stack.unshift((n & 0x7f) | 0x80);
        n >>= 7;
      }
      body.push(...stack);
    }
    return this.tlv(0x06, body);
  }

  null(): this {
    return this.tlv(0x05, []);
  }

  toBytes(): Uint8Array {
    return new Uint8Array(this.parts);
  }
}

// ---------- Minimal DER reader (to extract issuer + serial from a cert) ----------

type DerNode = { tag: number; headerLength: number; length: number; start: number };

function readNode(der: Uint8Array, offset: number): DerNode {
  const tag = der[offset];
  let length = der[offset + 1];
  let headerLength = 2;
  if (length & 0x80) {
    const count = length & 0x7f;
    length = 0;
    for (let i = 0; i < count; i += 1) {
      length = length * 256 + der[offset + 2 + i];
    }
    headerLength = 2 + count;
  }
  return { tag, headerLength, length, start: offset };
}

function nodeContent(der: Uint8Array, node: DerNode): Uint8Array {
  return der.slice(node.start + node.headerLength, node.start + node.headerLength + node.length);
}

function readChildren(der: Uint8Array, container: DerNode): DerNode[] {
  const content = nodeContent(der, container);
  const base = container.start + container.headerLength;
  const children: DerNode[] = [];
  let offset = 0;
  while (offset < content.length) {
    const child = readNode(content, offset);
    children.push({
      ...child,
      start: child.start + base,
      // Re-anchor header/length against the full buffer by re-reading.
    });
    offset += child.headerLength + child.length;
  }
  return children;
}

/** Extracts the raw issuer Name bytes and serial number from a X.509 cert. */
export function extractIssuerAndSerial(certDer: Uint8Array): {
  issuerBytes: Uint8Array;
  serialBytes: Uint8Array;
} {
  const certSeq = readNode(certDer, 0);
  const certChildren = readChildren(certDer, certSeq);
  const tbs = certChildren[0];
  const tbsChildren = readChildren(certDer, tbs);
  // TBSCertificate: version [0] OPTIONAL, serialNumber INTEGER, signature,
  // issuer Name, ...
  let index = 0;
  if (tbsChildren[0] && tbsChildren[0].tag === 0xa0) index = 1;
  const serialNode = tbsChildren[index];
  const issuerNode = tbsChildren[index + 2];
  if (serialNode?.tag !== 0x02 || issuerNode?.tag !== 0x30) {
    throw new Error("invalid_certificate_der");
  }
  return {
    serialBytes: nodeContent(certDer, serialNode),
    issuerBytes: nodeContent(certDer, issuerNode),
  };
}

// ---------- PEM helpers ----------

function pemToDer(pem: string, label: string): Uint8Array {
  const match = pem.match(new RegExp(`-----BEGIN ${label}-----([\\s\\S]+?)-----END ${label}-----`));
  if (!match) throw new Error(`pem_${label.toLowerCase()}_missing`);
  const binary = atob(match[1].replace(/\s+/g, ""));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function stripPem(pem: string): string {
  return pem
    .replace(/-----BEGIN [^-]+-----/g, "")
    .replace(/-----END [^-]+-----/g, "")
    .replace(/\s+/g, "");
}

// ---------- PKCS#7 signer ----------

const OID_SIGNED_DATA = "1.2.840.113549.1.7.2";
const OID_DATA = "1.2.840.113549.1.7.1";
const OID_SHA256 = "2.16.840.1.101.3.4.2.1";
const OID_RSA_ENCRYPTION = "1.2.840.113549.1.1.1";

export type ApplePkcs7Secrets = {
  /** PEM X.509 pass certificate (Apple-issued, Pass Type ID). */
  certificatePem: string;
  /** PEM Apple WWDR certificate (G4 or current generation). */
  wwdrCertificatePem: string;
  /** PEM PKCS#8 private key for the pass certificate. */
  privateKeyPem: string;
};

/**
 * Creates the manifest signer for .pkpass bundles. Signs with
 * RSASSA-PKCS1-v1.5/SHA-256 via WebCrypto and embeds the pass + WWDR certs.
 */
export function createApplePkcs7Signer(secrets: ApplePkcs7Secrets): ApplePassSigner {
  return {
    async signManifest(manifestJsonBytes: Uint8Array): Promise<Uint8Array> {
      const certDer = pemToDer(secrets.certificatePem, "CERTIFICATE");
      const wwdrDer = pemToDer(secrets.wwdrCertificatePem, "CERTIFICATE");
      const { issuerBytes, serialBytes } = extractIssuerAndSerial(certDer);

      const privateKey = await crypto.subtle.importKey(
        "pkcs8",
        Uint8Array.from(atob(stripPem(secrets.privateKeyPem)), (c) => c.charCodeAt(0))
          .buffer as ArrayBuffer,
        { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
        false,
        ["sign"],
      );
      const signature = await crypto.subtle.sign(
        { name: "RSASSA-PKCS1-v1_5" },
        privateKey,
        manifestJsonBytes as BufferSource,
      );

      const digestAlgorithms = new DerWriter()
        .set(
          new DerWriter().sequence(
            new DerWriter().objectIdentifier(OID_SHA256).null(),
          ),
        )
        .toBytes();

      const contentInfo = new DerWriter()
        .sequence(
          new DerWriter()
            .objectIdentifier(OID_DATA)
            .tlv(
              0xa0,
              new DerWriter().octetString(new Uint8Array(manifestJsonBytes)),
            ),
        )
        .toBytes();

      const certificates = new DerWriter().tlv(0xa0, new DerWriter().raw([...certDer]).raw([...wwdrDer])).toBytes();

      const signerInfo = new DerWriter()
        .sequence(
          new DerWriter()
            .integerNumber(1)
            .sequence(
              new DerWriter()
                .raw([...issuerBytes])
                .integer(serialBytes),
            )
            .sequence(new DerWriter().objectIdentifier(OID_SHA256).null())
            .sequence(new DerWriter().objectIdentifier(OID_RSA_ENCRYPTION).null())
            .octetString(new Uint8Array(signature)),
        )
        .toBytes();

      const signedData = new DerWriter()
        .sequence(
          new DerWriter()
            .integerNumber(1)
            .raw(digestAlgorithms)
            .raw(contentInfo)
            .raw(certificates)
            .raw(new DerWriter().set(new DerWriter().raw(signerInfo)).toBytes()),
        )
        .toBytes();

      return new DerWriter()
        .sequence(
          new DerWriter()
            .objectIdentifier(OID_SIGNED_DATA)
            .tlv(0xa0, new DerWriter().raw(signedData)),
        )
        .toBytes();
    },
  };
}
