// Request and response contracts of the REST API, shared by apps/server and apps/web.
// Paths are vault paths (see paths.ts). Timestamps are ISO 8601 strings.

import type { GraphData } from './graph.js';
import type { Mention } from './mentions.js';

/** Response body of `GET /api/health`. */
export interface HealthResponse {
  status: 'ok';
  /** Version of the running server package. */
  version: string;
}

/** `GET /api/vault` */
export interface VaultInfo {
  /** Folder name of the vault, shown in the UI. */
  name: string;
  noteCount: number;
  /** When the index was last (re)built, or null while the first build is running. */
  indexedAt: string | null;
}

export interface Heading {
  level: number;
  text: string;
  /** URL-safe id, unique within the note (GitHub style). */
  slug: string;
  /** 1-based line of the heading in the source. */
  line: number;
}

/** One note in lists and trees. */
export interface NoteSummary {
  path: string;
  name: string;
  title: string;
  folder: string;
  tags: string[];
  /** Names the note also answers to, from `aliases:`; a link may use any of them. */
  aliases: string[];
  /** Last modification time of the file. */
  modifiedAt: string;
  size: number;
  linkCount: number;
  backlinkCount: number;
}

/** `GET /api/notes/{path}` */
export interface NoteDocument extends NoteSummary {
  content: string;
  /** Content hash; send it back as `If-Match` when saving to detect concurrent edits. */
  hash: string;
  frontmatter: Record<string, unknown>;
  headings: Heading[];
}

export type LinkKind = 'wikilink' | 'embed' | 'markdown';

/** One outgoing link as found in a note. */
export interface NoteLink {
  source: string;
  /** Resolved vault path, or null when the target note does not exist yet. */
  target: string | null;
  /** The target as written, for display and for creating the missing note. */
  raw: string;
  kind: LinkKind;
  alias?: string;
  heading?: string;
  /** 1-based line in the source note. */
  line: number;
}

/** `GET /api/notes/{path}/backlinks` */
export interface Backlink {
  source: string;
  sourceTitle: string;
  /** The line of text around the link, for the backlinks panel. */
  context: string;
  line: number;
}

/** `GET /api/search?q=` */
export interface SearchHit {
  path: string;
  title: string;
  /** Snippet with the matched terms wrapped in `<mark>`; everything else is escaped. */
  snippet: string;
  score: number;
}

export interface SearchResponse {
  query: string;
  hits: SearchHit[];
  total: number;
}

/** `GET /api/tree` — folders first, then notes, both sorted by name. */
export type TreeEntry =
  | { type: 'folder'; name: string; path: string; children: TreeEntry[] }
  | { type: 'note'; name: string; path: string; title: string };

/** `GET /api/tags` */
export interface TagCount {
  tag: string;
  count: number;
}

/** `GET /api/graph` and `GET /api/graph/local` */
export type GraphResponse = GraphData;

/**
 * `GET /api/glossary` — one entry per definition note, sorted by title. This is also where the
 * terms come from: `glossaryTerms` expands an entry into the title and aliases it answers to,
 * so the summary crosses the wire once per note rather than once per name.
 */
export interface GlossaryEntry {
  path: string;
  title: string;
  /** The note's aliases, sorted; each is a term in its own right. */
  aliases: string[];
  /** The note's first block as plain text, for the list and the hover tooltip. */
  summary: string;
}

/** One source note that names the open note, with the hash it was read at. */
export interface MentionGroup {
  source: string;
  sourceTitle: string;
  /** Content hash of the source when it was scanned; sent back when linking. */
  hash: string;
  mentions: Mention[];
}

/** `GET /api/mentions?path=` — where this note is named without a link leading to it. */
export interface MentionsResponse {
  path: string;
  /** The names looked for: the note's title and every alias it answers to. */
  terms: string[];
  groups: MentionGroup[];
  /** True when the search stopped at its cap, so the list may be short of a few. */
  truncated: boolean;
}

/** One file to rewrite, and which of its mentions. */
export interface MentionWrite {
  source: string;
  /** The hash the mentions were found at. A different one on disk means someone else wrote. */
  hash: string;
  /** Start offsets, exactly as `GET /api/mentions` reported them. */
  offsets: number[];
}

/** `POST /api/mentions/link` */
export interface LinkMentionsRequest {
  /** The note every new link should lead to. */
  path: string;
  writes: MentionWrite[];
}

/**
 * What the batch did. A note that could not be written is reported here rather than failing the
 * whole batch: one stale file must not stop the other nine from being linked.
 */
export interface LinkMentionsResult {
  linked: { source: string; count: number }[];
  skipped: { source: string; reason: 'conflict' | 'notFound' | 'nothing' }[];
}

/** `POST /api/notes` */
export interface CreateNoteRequest {
  path: string;
  content?: string;
}

/** `PUT /api/notes/{path}` */
export interface SaveNoteRequest {
  content: string;
}

/** `GET /api/assets` — every file in the vault that is not a note. */
export interface AssetSummary {
  path: string;
  size: number;
  modifiedAt: string;
}

/** `POST /api/assets` (multipart) */
export interface UploadResponse {
  /** Vault path of the stored file, ready to embed as `![[...]]`. */
  path: string;
}

/** Events streamed on `GET /api/events` (server-sent events). */
export type IndexEvent =
  | { type: 'indexed'; paths: string[] }
  | { type: 'removed'; paths: string[] }
  | { type: 'rebuilt'; noteCount: number };

/** Shape of every error response. */
export interface ApiError {
  statusCode: number;
  error: string;
  message: string;
}
