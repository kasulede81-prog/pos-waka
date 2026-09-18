import { describe, expect, it } from "vitest";
import {
  createApplePkcs7Signer,
  extractIssuerAndSerial,
} from "../../../../supabase/functions/_shared/loyaltyWallet/applePkcs7Signer.ts";

/**
 * Phase 06 — Apple PKCS#7 manifest signer. Uses a real WebCrypto RSA-2048
 * key and a syntactically valid X.509-shaped DER stub (issuer/serial
 * extraction + full signature structure + signature verification).
 * A genuine Apple-issued pass certificate is the external blocker.
 */

// Rebuild the minimal DER structures the signer expects for the test cert.
function derLength(length: number): number[] {
  if (length < 0x80) return [length];
  const out: number[] = [];
  let n = length;
  while (n > 0) {
    out.unshift(n & 0xff);
    n >>= 8;
  }
  return [0x80 | out.length, ...out];
}

function derTlv(tag: number, content: number[]): number[] {
  return [tag, ...derLength(content.length), ...content];
}

/** Builds a minimal but structurally valid Certificate DER for tests. */
function buildTestCertificateDer(serial: number[], issuerContent: number[][]): Uint8Array {
  const tbs = derTlv(0x30, [
    ...derTlv(0xa0, [derTlv(0x02, [0x02])].flat()), // version v3
    ...derTlv(0x02, serial), // serialNumber
    ...derTlv(0x30, [derTlv(0x06, [0x2a, 0x03, 0x04])].flat()), // signature alg (dummy OID)
    ...derTlv(0x30, issuerContent.flat()), // issuer Name
    ...derTlv(0x30, [derTlv(0x02, [0x01])].flat()), // validity (dummy)
    ...derTlv(0x30, [derTlv(0x06, [0x2a])].flat()), // subject (dummy)
    ...derTlv(0x30, [derTlv(0x06, [0x2a])].flat()), // subjectPublicKeyInfo (dummy)
  ]);
  return new Uint8Array(
    derTlv(0x30, [
      ...tbs,
      ...derTlv(0x30, [derTlv(0x06, [0x2a])].flat()), // signatureAlgorithm
      ...derTlv(0x03, [0x00, 0x01, 0x02]), // signatureValue (dummy)
    ]),
  );
}

function toPem(label: string, der: Uint8Array): string {
  let binary = "";
  for (const b of der) binary += String.fromCharCode(b);
  const base64 = btoa(binary);
  const lines = base64.match(/.{1,64}/g) ?? [];
  return `-----BEGIN ${label}-----\n${lines.join("\n")}\n-----END ${label}-----`;
}

// Tiny walker to pull the encryptedDigest out of the produced PKCS#7.
function readNode(der: Uint8Array, offset: number) {
  let length = der[offset + 1];
  let header = 2;
  if (length & 0x80) {
    const count = length & 0x7f;
    length = 0;
    for (let i = 0; i < count; i += 1) length = length * 256 + der[offset + 2 + i];
    header = 2 + count;
  }
  return { tag: der[offset], header, length, contentStart: offset + header };
}

function childrenOf(der: Uint8Array, start: number, length: number) {
  const out: { tag: number; contentStart: number; length: number }[] = [];
  let offset = start;
  const end = start + length;
  while (offset < end) {
    const node = readNode(der, offset);
    out.push({ tag: node.tag, contentStart: node.contentStart, length: node.length });
    offset = node.contentStart + node.length;
  }
  return out;
}

describe("extractIssuerAndSerial", () => {
  it("extracts the issuer Name and serial from a certificate", () => {
    const issuerContent = [derTlv(0x06, [0x55, 0x04, 0x03]), derTlv(0x13, [0x57, 0x41, 0x4b, 0x41])];
    const cert = buildTestCertificateDer([0x01, 0x42], issuerContent);
    const { issuerBytes, serialBytes } = extractIssuerAndSerial(cert);
    expect([...serialBytes]).toEqual([0x01, 0x42]);
    // Issuer content is the concatenated RDNs.
    // Issuer content is the concatenated RDNs (5-byte OID TV + 6-byte string TV).
    expect(issuerBytes.length).toBe(11);
    // Issuer content begins with the first AttributeTypeAndValue OID (0x06).
    expect(issuerBytes[0]).toBe(0x06);
  });

  it("rejects malformed certificates", () => {
    expect(() => extractIssuerAndSerial(new Uint8Array([0x30, 0x03, 0x01, 0x02, 0x03]))).toThrow();
  });
});

describe("createApplePkcs7Signer", () => {
  it("produces a verifiable PKCS#7 SignedData over the manifest", async () => {
    const issuerContent = [derTlv(0x06, [0x55, 0x04, 0x03]), derTlv(0x0c, [0x03, 0x77, 0x6b])];
    const certDer = buildTestCertificateDer([0x10, 0x20], issuerContent);
    const wwdrDer = buildTestCertificateDer([0x07], [derTlv(0x06, [0x2a])]);

    const keyPair = await crypto.subtle.generateKey(
      { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
      true,
      ["sign", "verify"],
    );
    const pkcs8 = await crypto.subtle.exportKey("pkcs8", keyPair.privateKey);

    const signer = createApplePkcs7Signer({
      certificatePem: toPem("CERTIFICATE", certDer),
      wwdrCertificatePem: toPem("CERTIFICATE", wwdrDer),
      privateKeyPem: toPem("PRIVATE KEY", new Uint8Array(pkcs8)),
    });

    const manifest = new TextEncoder().encode('{"pass.json":"abc"}');
    const pkcs7 = await signer.signManifest(manifest);

    // ContentInfo ::= SEQUENCE { OID signedData, [0] SignedData }
    expect(pkcs7[0]).toBe(0x30);
    const root = readNode(pkcs7, 0);
    const rootChildren = childrenOf(pkcs7, root.contentStart, root.length);
    expect(rootChildren[0].tag).toBe(0x06); // contentType OID

    const signedDataWrapper = rootChildren[1]; // [0] EXPLICIT
    expect(signedDataWrapper.tag).toBe(0xa0);
    const signedDataNode = readNode(pkcs7, signedDataWrapper.contentStart);
    const signedDataChildren = childrenOf(pkcs7, signedDataNode.contentStart, signedDataNode.length);
    // version, digestAlgorithms (SET), contentInfo, certificates ([0]), signerInfos (SET)
    expect(signedDataChildren).toHaveLength(5);
    expect(signedDataChildren[1].tag).toBe(0x31); // digestAlgorithms SET
    expect(signedDataChildren[3].tag).toBe(0xa0); // certificates [0]
    expect(signedDataChildren[4].tag).toBe(0x31); // signerInfos SET

    // certificates [0] embeds both certs.
    const certContainer = childrenOf(pkcs7, signedDataChildren[3].contentStart, signedDataChildren[3].length);
    expect(certContainer).toHaveLength(2);

    // signerInfos SET → SignerInfo → encryptedDigest OCTET STRING (last).
    const signerInfoSet = childrenOf(pkcs7, signedDataChildren[4].contentStart, signedDataChildren[4].length);
    const signerInfoNode = signerInfoSet[0];
    const signerInfoChildren = childrenOf(pkcs7, signerInfoNode.contentStart, signerInfoNode.length);
    const encryptedDigest = signerInfoChildren[4];
    expect(encryptedDigest.tag).toBe(0x04);
    expect(encryptedDigest.length).toBe(256); // RSA-2048 signature

    // The signature verifies against the manifest with the public key.
    const signature = pkcs7.slice(encryptedDigest.contentStart, encryptedDigest.contentStart + encryptedDigest.length);
    const valid = await crypto.subtle.verify(
      { name: "RSASSA-PKCS1-v1_5" },
      keyPair.publicKey,
      signature as BufferSource,
      manifest as BufferSource,
    );
    expect(valid).toBe(true);
  }, 30_000);
});
