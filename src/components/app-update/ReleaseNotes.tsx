import clsx from "clsx";
import { useMemo, type ReactNode } from "react";
import { hasReleaseNotes, parseReleaseNotes, type ReleaseNoteNode } from "../../lib/releaseNotes";

/**
 * Renders DKASU release notes from `public_notes_html`.
 *
 * The HTML is parsed into an allow-listed node tree (see `lib/releaseNotes.ts`) and rendered as
 * React elements — raw HTML is never injected, so a release row cannot add markup or behaviour, and
 * every allowed element is styled explicitly rather than relying on the typography plugin (which
 * this project does not install).
 *
 * Shared by the pre-update full-screen surface and the post-install "What's New" surface so the
 * two never drift apart.
 */

function renderNode(node: ReleaseNoteNode, key: string): ReactNode {
  if (node.type === "text") return node.value;

  const children = node.children.length ? node.children.map((child, i) => renderNode(child, `${key}-${i}`)) : null;

  switch (node.tag) {
    case "p":
      return (
        <p key={key} className="text-sm leading-relaxed text-foreground">
          {children}
        </p>
      );
    case "strong":
      return (
        <strong key={key} className="font-bold text-foreground">
          {children}
        </strong>
      );
    case "em":
      return (
        <em key={key} className="italic">
          {children}
        </em>
      );
    case "h3":
      return (
        <h3 key={key} className="text-base font-black leading-snug text-foreground">
          {children}
        </h3>
      );
    case "h4":
      return (
        <h4 key={key} className="text-sm font-black leading-snug text-foreground">
          {children}
        </h4>
      );
    case "ul":
      return (
        <ul key={key} className="ml-1 list-disc space-y-1.5 pl-5 marker:text-waka-600 dark:marker:text-waka-400">
          {children}
        </ul>
      );
    case "ol":
      return (
        <ol key={key} className="ml-1 list-decimal space-y-1.5 pl-5 marker:text-waka-600 dark:marker:text-waka-400">
          {children}
        </ol>
      );
    case "li":
      return (
        <li key={key} className="text-sm leading-relaxed text-foreground">
          {children}
        </li>
      );
    case "br":
      return <br key={key} />;
    case "a":
      // A link only exists when the parser accepted an absolute http(s) href.
      return node.href ? (
        <a
          key={key}
          href={node.href}
          target="_blank"
          rel="noopener noreferrer"
          className="font-semibold text-waka-700 underline underline-offset-2 dark:text-waka-300"
        >
          {children}
        </a>
      ) : (
        <span key={key}>{children}</span>
      );
    default:
      return <span key={key}>{children}</span>;
  }
}

type Props = {
  html: string | null | undefined;
  /** Shown when there is nothing to render (or the notes are disabled for this release). */
  emptyLabel: string;
  className?: string;
};

export function ReleaseNotes({ html, emptyLabel, className }: Props) {
  const nodes = useMemo(() => parseReleaseNotes(html), [html]);

  if (!hasReleaseNotes(nodes)) {
    return <p className={clsx("text-sm leading-relaxed text-muted-foreground", className)}>{emptyLabel}</p>;
  }

  return (
    <div className={clsx("space-y-3", className)}>
      {nodes.map((node, i) => renderNode(node, `n${i}`))}
    </div>
  );
}
