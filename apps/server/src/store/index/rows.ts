// The shapes a row is read into, and the one conversion every listing shares. A summary is
// assembled from the same columns wherever it is asked for, so the query that fetches them and
// the function that turns them into a NoteSummary live together.
import type { NoteSummary } from '@rhizom/core';
import type { Heading, ParsedNote } from '@rhizom/core';

export interface IndexNoteInput {
  path: string;
  size: number;
  modifiedAt: Date;
  hash: string;
  content: string;
  parsed: ParsedNote;
}

export interface NoteRecord {
  path: string;
  name: string;
  title: string;
  folder: string;
  tags: string[];
  modifiedAt: Date;
  size: number;
  hash: string;
  frontmatter: Record<string, unknown>;
  headings: Heading[];
  aliases: string[];
  wordCount: number;
}

export interface FileState {
  size: number;
  modifiedAt: Date;
}

export interface IndexStats {
  noteCount: number;
  indexedAt: string | null;
}

/** Whether the caller runs `resolveAll()` itself once a batch of notes is in. */
export interface UpsertOptions {
  deferResolution?: boolean;
}

export interface SummaryRow {
  path: string;
  name: string;
  title: string;
  folder: string;
  aliases: string;
  modifiedAt: number;
  size: number;
  linkCount: number;
  backlinkCount: number;
  tags: string | null;
}

// Counted per note with correlated subqueries; note_tags is joined as one separated string
// because SQLite has no array type.
export const SUMMARY_COLUMNS = `select n.path, n.name, n.title, n.folder, n.aliases, n.modified_at as modifiedAt, n.size,
        (select count(*) from links l where l.source = n.path and l.target is not null) as linkCount,
        (select count(*) from links l where l.target = n.path) as backlinkCount,
        (select group_concat(t.tag, char(31)) from note_tags t where t.path = n.path) as tags
 from notes n`;

/** `aliases` is a JSON column, and hand-written SQL hands it back as the raw text. */
export function parseAliases(raw: string): string[] {
  const parsed: unknown = JSON.parse(raw);
  return Array.isArray(parsed)
    ? parsed.filter((entry): entry is string => typeof entry === 'string')
    : [];
}

export function toSummary(row: SummaryRow): NoteSummary {
  return {
    path: row.path,
    name: row.name,
    title: row.title,
    folder: row.folder,
    aliases: parseAliases(row.aliases),
    tags: row.tags === null ? [] : row.tags.split(String.fromCharCode(31)).sort(),
    modifiedAt: new Date(row.modifiedAt).toISOString(),
    size: row.size,
    linkCount: row.linkCount,
    backlinkCount: row.backlinkCount,
  };
}
