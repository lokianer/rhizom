// Request and response contracts of the REST API, shared by apps/server and apps/web.
// Paths are vault paths (see paths.ts). Timestamps are ISO 8601 strings.

import type { GraphData } from './graph.js';

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

/** `POST /api/notes` */
export interface CreateNoteRequest {
  path: string;
  content?: string;
}

/** `PUT /api/notes/{path}` */
export interface SaveNoteRequest {
  content: string;
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
