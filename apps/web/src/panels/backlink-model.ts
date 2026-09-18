// Shaping the two link lists of the open note. A note may mention another one several times
// and may repeat the same link; the panel shows every mention but each source and each target
// only once.
import { noteNameOf } from '@rhizom/core';
import type { Backlink, NoteLink } from '@rhizom/core';

export interface BacklinkMention {
  line: number;
  /** The line of text around the link. */
  context: string;
}

export interface BacklinkGroup {
  source: string;
  title: string;
  mentions: readonly BacklinkMention[];
}

/** One entry per linking note, in the order the notes first appear, mentions by line. */
export function groupBacklinks(backlinks: readonly Backlink[]): BacklinkGroup[] {
  const groups = new Map<string, BacklinkGroup & { mentions: BacklinkMention[] }>();
  for (const backlink of backlinks) {
    const group = groups.get(backlink.source);
    const mention = { line: backlink.line, context: backlink.context };
    if (group === undefined) {
      groups.set(backlink.source, {
        source: backlink.source,
        title: backlink.sourceTitle === '' ? noteNameOf(backlink.source) : backlink.sourceTitle,
        mentions: [mention],
      });
    } else {
      group.mentions.push(mention);
    }
  }
  for (const group of groups.values()) {
    group.mentions.sort((a, b) => a.line - b.line);
  }
  return [...groups.values()];
}

export interface OutgoingLink {
  /** Resolved vault path, or null when the target note does not exist yet. */
  target: string | null;
  /** What to show: the alias the note gave, else the target's name, else the raw target. */
  label: string;
  /** The first line the link appears on, for a stable key and for ordering. */
  line: number;
}

/** The distinct targets a note links to, in the order they first appear. */
export function outgoingLinks(links: readonly NoteLink[]): OutgoingLink[] {
  const seen = new Map<string, OutgoingLink>();
  for (const link of links) {
    // Unresolved links are kept apart from resolved ones with the same text.
    const key = link.target ?? `?${link.raw}`;
    if (!seen.has(key)) {
      seen.set(key, {
        target: link.target,
        label: link.alias ?? (link.target === null ? link.raw : noteNameOf(link.target)),
        line: link.line,
      });
    }
  }
  return [...seen.values()];
}
