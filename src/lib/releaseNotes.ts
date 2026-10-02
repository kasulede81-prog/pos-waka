/**
 * Release notes parser for `app_releases.public_notes_html`.
 *
 * The notes are SERVER DATA rendered inside the merchant app. The previous implementation fed them
 * straight into `dangerouslySetInnerHTML`, so anything in that row ran as markup. This module turns
 * the string into a tiny ALLOW-LISTED tree of nodes instead: the UI renders React elements, and
 * `dangerouslySetInnerHTML` is not used anywhere for release notes — an injected script tag,
 * `onerror=` handler, `javascript:` link or unknown element cannot survive the parse.
 *
 * Deliberately dependency-free and DOM-free (the test environment is node), so it is unit-testable
 * and behaves identically on web, Capacitor and Electron.
 */

export type ReleaseNoteTag =
  | "p"
  | "strong"
  | "em"
  | "ul"
  | "ol"
  | "li"
  | "h3"
  | "h4"
  | "br"
  | "a";

export type ReleaseNoteNode =
  | { type: "text"; value: string }
  | { type: "element"; tag: ReleaseNoteTag; children: ReleaseNoteNode[]; href?: string };

/** The only elements release notes may contain. Everything else is unwrapped or dropped. */
const ALLOWED_TAGS: ReadonlySet<string> = new Set([
  "p",
  "strong",
  "em",
  "ul",
  "ol",
  "li",
  "h3",
  "h4",
  "br",
  "a",
]);

/** Common aliases folded onto the allow-list, so real-world notes still read correctly. */
const TAG_ALIASES: Readonly<Record<string, ReleaseNoteTag>> = {
  b: "strong",
  i: "em",
  h1: "h3",
  h2: "h3",
  h5: "h3",
  h6: "h4",
  div: "p",
};

/** Their CONTENT is dropped, not unwrapped — unwrapping a style tag would print CSS as body text. */
const DROP_WITH_CONTENT: ReadonlySet<string> = new Set([
  "script",
  "style",
  "iframe",
  "object",
  "embed",
  "template",
  "svg",
  "noscript",
  "form",
  "textarea",
  "select",
]);

const VOID_TAGS: ReadonlySet<string> = new Set(["br"]);

/** Text safety valve: pathological input can never build an unbounded tree. */
const MAX_NODES = 2000;

const NAMED_ENTITIES: Readonly<Record<string, string>> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  ndash: "\u2013",
  mdash: "\u2014",
  hellip: "\u2026",
  bull: "\u2022",
  middot: "\u00b7",
  rsquo: "\u2019",
  lsquo: "\u2018",
  rdquo: "\u201d",
  ldquo: "\u201c",
};

function hasControlCharacter(value: string): boolean {
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);
    if (code < 32 || code === 127) return true;
  }
  return false;
}

function decodeEntities(text: string): string {
  return text.replace(/&(#[0-9]+|#x[0-9a-f]+|[a-z]+);/gi, (match, entity: string) => {
    if (entity.startsWith("#")) {
      const code =
        entity[1] === "x" || entity[1] === "X"
          ? parseInt(entity.slice(2), 16)
          : parseInt(entity.slice(1), 10);
      if (!Number.isFinite(code) || code < 0 || code > 0x10ffff) return match;
      try {
        return String.fromCodePoint(code);
      } catch {
        return match;
      }
    }
    return NAMED_ENTITIES[entity.toLowerCase()] ?? match;
  });
}

/**
 * Only absolute http(s) links survive. `javascript:`, `data:`, `vbscript:`, `intent:`, custom
 * schemes, relative and protocol-relative URLs are all rejected — a rejected href drops the link
 * but keeps its text.
 */
export function safeReleaseNoteHref(raw: string | null | undefined): string | null {
  const value = String(raw ?? "").trim();
  if (!value) return null;
  if (hasControlCharacter(value)) return null;
  if (!/^https?:\/\//i.test(value)) return null;
  return value;
}

function readAttribute(attrs: string, name: string): string | null {
  const match = new RegExp(name + "\\s*=\\s*(\"([^\"]*)\"|'([^']*)'|([^\\s\"'>]+))", "i").exec(attrs);
  if (!match) return null;
  return match[2] ?? match[3] ?? match[4] ?? null;
}

type OpenElement = { type: "element"; tag: ReleaseNoteTag; children: ReleaseNoteNode[]; href?: string };

const TAG_RE = /<(\/?)([a-zA-Z][a-zA-Z0-9-]*)((?:"[^"]*"|'[^']*'|[^'">])*?)(\/?)>/g;

/**
 * Parse release-note HTML into a safe node tree. Never throws; malformed markup degrades to text.
 */
export function parseReleaseNotes(html: string | null | undefined): ReleaseNoteNode[] {
  const source = String(html ?? "");
  if (!source.trim()) return [];

  const roots: ReleaseNoteNode[] = [];
  const stack: OpenElement[] = [{ type: "element", tag: "p", children: roots }];
  let nodeCount = 0;
  let index = 0;

  const pushText = (raw: string): void => {
    const value = decodeEntities(raw);
    if (!value.trim()) return;
    if (nodeCount >= MAX_NODES) return;
    nodeCount += 1;
    const children = stack[stack.length - 1].children;
    const last = children[children.length - 1];
    if (last && last.type === "text") {
      last.value += value;
      return;
    }
    children.push({ type: "text", value });
  };

  const pushElement = (element: OpenElement): void => {
    if (nodeCount >= MAX_NODES) return;
    nodeCount += 1;
    stack[stack.length - 1].children.push(element);
  };

  const closeTag = (name: string): void => {
    for (let i = stack.length - 1; i >= 1; i -= 1) {
      if (stack[i].tag === name) {
        stack.length = i;
        return;
      }
    }
    // Unmatched close tag — ignored.
  };

  let match: RegExpExecArray | null;
  while ((match = TAG_RE.exec(source)) !== null) {
    const [full, closing, rawName, attrs, selfClosing] = match;
    pushText(source.slice(index, match.index));
    index = match.index + full.length;

    const name = rawName.toLowerCase();

    if (closing) {
      const canonical = ALLOWED_TAGS.has(name) ? name : TAG_ALIASES[name] ?? name;
      if (!VOID_TAGS.has(canonical)) closeTag(canonical);
      continue;
    }

    if (DROP_WITH_CONTENT.has(name)) {
      // Skip the whole element, content included.
      const close = new RegExp("</\\s*" + name + "\\s*>", "i");
      const rest = source.slice(index);
      const hit = close.exec(rest);
      if (hit) index += hit.index + hit[0].length;
      else index = source.length;
      continue;
    }

    // Attribute-less normalisation: only `a` keeps anything, and only a validated href.
    const tag: ReleaseNoteTag | null = ALLOWED_TAGS.has(name)
      ? (name as ReleaseNoteTag)
      : TAG_ALIASES[name] ?? null;

    if (!tag) continue; // unknown tag: unwrapped, its children keep flowing into the current element

    if (tag === "br") {
      pushElement({ type: "element", tag: "br", children: [] });
      continue;
    }

    const element: OpenElement = { type: "element", tag, children: [] };
    if (tag === "a") {
      const href = safeReleaseNoteHref(readAttribute(attrs, "href"));
      if (href) element.href = href;
    }
    pushElement(element);

    if (!VOID_TAGS.has(tag) && selfClosing !== "/") stack.push(element);
  }

  pushText(source.slice(index));
  return roots;
}

/**
 * True when the parsed notes contain anything worth rendering. Driven by TEXT, not by tags: an
 * empty `<p></p>` or a lone `<br>` renders nothing visible and must fall through to the fallback
 * message instead of showing an empty "What's New" section.
 */
export function hasReleaseNotes(nodes: ReleaseNoteNode[]): boolean {
  return nodes.some((node) =>
    node.type === "text" ? node.value.trim().length > 0 : hasReleaseNotes(node.children),
  );
}
