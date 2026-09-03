"use client";

import { linkifyParts } from "@/lib/mapping/linkify";

/**
 * A note, with the addresses in it clickable.
 *
 * What an assessor writes about a locality tends to cite something — the
 * GEOLocate result, the herbarium's record page, the paper the collector's
 * route came from — and pasted into a note those were dead text.
 *
 * Rendered as parts rather than as HTML: nothing that came out of a note is
 * ever handed to a parser as markup.
 */
export default function LinkifiedText({ text, className }: { text: string; className?: string }) {
  const parts = linkifyParts(text);
  if (!parts.some((part) => part.href)) return <>{text}</>;
  return (
    <span className={className}>
      {parts.map((part, i) =>
        part.href ? (
          <a
            key={i}
            href={part.href}
            target="_blank"
            rel="noopener noreferrer"
            // The click has to reach the link rather than whatever the note is
            // drawn inside — a hover bubble that closes on a click elsewhere,
            // or a row that opens a menu.
            onClick={(e) => e.stopPropagation()}
            onMouseDown={(e) => e.stopPropagation()}
            className="underline decoration-dotted underline-offset-2 hover:decoration-solid"
          >
            {part.text}
          </a>
        ) : (
          <span key={i}>{part.text}</span>
        )
      )}
    </span>
  );
}
