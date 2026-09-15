import { describe, expect, it } from "vitest";
import { md5Hex } from "./md5";

describe("md5Hex", () => {
  it("matches known RFC 1321 test vectors (must be byte-identical to Postgres md5())", () => {
    expect(md5Hex("")).toBe("d41d8cd98f00b204e9800998ecf8427e");
    expect(md5Hex("a")).toBe("0cc175b9c0f1b6a831c399e269772661");
    expect(md5Hex("abc")).toBe("900150983cd24fb0d6963f7d28e17f72");
    expect(md5Hex("message digest")).toBe("f96b697d7cb7938d525a2f31aaf161d0");
    expect(md5Hex("abcdefghijklmnopqrstuvwxyz")).toBe("c3fcd3d76192e4007dfb496cca67e13b");
  });

  it("produces a deterministic 32-char hex digest for the line_id:revision shape used by the fingerprint", () => {
    const input =
      "11111111-1111-1111-1111-111111111111:1,22222222-2222-2222-2222-222222222222:2";
    const digest = md5Hex(input);
    expect(digest).toMatch(/^[0-9a-f]{32}$/);
    expect(md5Hex(input)).toBe(digest); // deterministic across calls
  });
});
