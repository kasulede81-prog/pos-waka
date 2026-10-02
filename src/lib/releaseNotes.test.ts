import { describe, expect, it } from "vitest";
import { hasReleaseNotes, parseReleaseNotes, safeReleaseNoteHref, type ReleaseNoteNode } from "./releaseNotes";

/**
 * Release notes are SERVER DATA (`app_releases.public_notes_html`) rendered in the merchant app.
 * These tests are the allow-list contract: only the intended elements survive, their content is
 * preserved, every attribute is dropped, and no link scheme except http(s) can get through.
 */

const flatten = (nodes: ReleaseNoteNode[]): string => {
  let out = "";
  for (const node of nodes) {
    out += node.type === "text" ? node.value : flatten(node.children);
  }
  return out;
};

const tagsOf = (nodes: ReleaseNoteNode[]): string[] =>
  nodes.flatMap((node) => (node.type === "element" ? [node.tag, ...tagsOf(node.children)] : []));

describe("parseReleaseNotes — allow list", () => {
  it("keeps the elements the update screen styles", () => {
    const html =
      "<h3>Highlights</h3><p>Faster <strong>checkout</strong> and <em>cleaner</em> receipts.</p>" +
      "<ul><li>Offline sync fix</li><li>New barcode scanner</li></ul><ol><li>First</li></ol><br>";
    const nodes = parseReleaseNotes(html);
    expect(tagsOf(nodes)).toEqual(["h3", "p", "strong", "em", "ul", "li", "li", "ol", "li", "br"]);
    expect(flatten(nodes)).toContain("Faster checkout and cleaner receipts.");
    expect(flatten(nodes)).toContain("Offline sync fix");
    expect(hasReleaseNotes(nodes)).toBe(true);
  });

  it("folds common aliases onto the allow list", () => {
    expect(tagsOf(parseReleaseNotes("<b>bold</b><i>italic</i><h1>t</h1><h2>s</h2><div>d</div>"))).toEqual([
      "strong",
      "em",
      "h3",
      "h3",
      "p",
    ]);
  });

  it("unwraps unknown tags but keeps their text", () => {
    const nodes = parseReleaseNotes("<section><p>Kept <span>text</span></p></section>");
    expect(tagsOf(nodes)).toEqual(["p"]);
    expect(flatten(nodes)).toBe("Kept text");
  });

  it("drops script and style CONTENT entirely, not just the tags", () => {
    const nodes = parseReleaseNotes(
      '<p>Before</p><script>window.__pwned = 1;</script><style>.x{color:red}</style><p>After</p>',
    );
    const text = flatten(nodes);
    expect(text).toBe("BeforeAfter");
    expect(text).not.toContain("__pwned");
    expect(text).not.toContain("color:red");
  });

  it("strips every attribute except a validated href", () => {
    const nodes = parseReleaseNotes(
      '<p onclick="steal()" style="position:fixed" class="x" id="y">Safe</p>' +
        '<a href="https://dkasu.com/changelog" onclick="steal()" target="_self">Notes</a>',
    );
    const anchor = nodes.find((n) => n.type === "element" && n.tag === "a");
    expect(anchor && anchor.type === "element" ? anchor.href : null).toBe("https://dkasu.com/changelog");
    const paragraph = nodes.find((n) => n.type === "element" && n.tag === "p");
    expect(paragraph && paragraph.type === "element" ? Object.keys(paragraph).sort() : []).toEqual([
      "children",
      "tag",
      "type",
    ]);
  });

  it("keeps the link text when the href is rejected", () => {
    const nodes = parseReleaseNotes('<a href="javascript:alert(1)">Tap here</a>');
    const anchor = nodes.find((n) => n.type === "element" && n.tag === "a");
    expect(anchor && anchor.type === "element" ? anchor.href : "missing").toBeUndefined();
    expect(flatten(nodes)).toBe("Tap here");
  });

  it("decodes entities so notes read as written", () => {
    expect(flatten(parseReleaseNotes("<p>Speed &amp; stability &#8212; 20% faster &hellip;</p>"))).toBe(
      "Speed & stability — 20% faster …",
    );
  });

  it("never throws and degrades to text on malformed markup", () => {
    for (const bad of ["<p>unclosed", "</p>stray close", "<ul><li>a<li>b", "<<<>>>", "<a href=>x</a>"]) {
      expect(() => parseReleaseNotes(bad)).not.toThrow();
      expect(flatten(parseReleaseNotes(bad)).trim().length).toBeGreaterThan(0);
    }
  });

  it("returns nothing for empty, null or tag-only input", () => {
    for (const empty of ["", "   ", null, undefined, "<p></p>", "<br>", "<ul><li></li></ul>", "<p><br></p>"]) {
      expect(hasReleaseNotes(parseReleaseNotes(empty as string | null | undefined)), String(empty)).toBe(false);
    }
  });

  it("bounds pathological input instead of building an unbounded tree", () => {
    const huge = "<p>x</p>".repeat(5000);
    const nodes = parseReleaseNotes(huge);
    expect(nodes.length).toBeLessThanOrEqual(2000);
  });
});

describe("safeReleaseNoteHref", () => {
  it("accepts only absolute http(s) links", () => {
    expect(safeReleaseNoteHref("https://dkasu.com/notes")).toBe("https://dkasu.com/notes");
    expect(safeReleaseNoteHref("http://example.com")).toBe("http://example.com");
    expect(safeReleaseNoteHref("  https://dkasu.com/x  ")).toBe("https://dkasu.com/x");
  });

  it("rejects unsafe schemes, relative URLs and whitespace/control evasion", () => {
    for (const bad of [
      "javascript:alert(1)",
      "JavaScript:alert(1)",
      "data:text/html;base64,PHNjcmlwdD4=",
      "vbscript:msgbox(1)",
      "intent://scan/#Intent;scheme=zxing;end",
      "file:///etc/passwd",
      "//evil.example/x",
      "/relative/path",
      "java\nscript:alert(1)",
      "https://dkasu.com/\u0000",
      "",
      null,
      undefined,
    ]) {
      expect(safeReleaseNoteHref(bad as string), String(bad)).toBeNull();
    }
  });
});
