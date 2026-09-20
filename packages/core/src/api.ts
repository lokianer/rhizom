// Request and response contracts of the REST API, shared by apps/server and apps/web.
// Paths are vault paths (see paths.ts). Timestamps are ISO 8601 strings.

import type { GraphData } from './graph.js';
import type { Mention } from './mentions.js';
import type { QueryProblem, QueryView } from './query.js';

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
  /** Where this vault keeps its templates, and what its placeholders default to. */
  templates: TemplateSettings;
  /** Where this vault keeps its daily notes, and what a day is called. */
  daily: DailySettings;
}

/**
 * The template folder as the vault itself declares it — the operator's setting, Obsidian's own
 * `templates.json`, or a folder called Templates — and the formats `{{date}}` and `{{time}}`
 * mean where they name none. `folder` is null when the vault has no templates.
 */
export interface TemplateSettings {
  folder: string | null;
  dateFormat: string;
  timeFormat: string;
}

/**
 * What the vault declares about daily notes — the operator's setting, Obsidian's own
 * `daily-notes.json`, or simply a folder called Daily. `folder` is null when the vault keeps
 * none, and the command that opens today's note is then not offered at all.
 */
export interface DailySettings {
  folder: string | null;
  /** The file name, in the same format tokens a template uses. */
  format: string;
  /** The note a new day starts from, as a vault path, or null when there is none. */
  template: string | null;
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

/** One link the rename found, and what it intends to do about it. */
export interface RenameRef {
  /** 1-based line in the source note, so the preview can point at it. */
  line: number;
  /** UTF-16 offsets of the whole link in the source, as `Mention` reports them. */
  start: number;
  end: number;
  /** The link as it reads now and as it would read afterwards — the diff shown to the user. */
  before: string;
  after: string;
  /** False when the link is deliberately left alone; `skipReason` says on what grounds. */
  rewrite: boolean;
  /**
   * Why this link stays as written: `alias` because it names the note by an alias the rename
   * does not touch, `stillResolves` because a short link finds the note at its new path anyway.
   * Both are worth showing — a user who expected every link to change should see why one did not.
   */
  skipReason?: 'alias' | 'stillResolves';
  /** Rewriting here changes a heading, and with it the anchor other notes may link to. */
  inHeading: boolean;
}

/** One file holding links to the note, with the hash it was read at. */
export interface RenameFile {
  source: string;
  sourceTitle: string;
  /** Content hash of the source when the preview read it; sent back so a file someone else
   * changed in the meantime is refused rather than overwritten. */
  hash: string;
  refs: RenameRef[];
  /**
   * References past the ones listed. The preview carries at most 50 per file so that renaming a
   * much-linked note does not send a megabyte over the wire; the write still covers all of them.
   */
  more: number;
}

/** `GET /api/rename?from=&to=` — what the rename would do, before anything is written. */
export interface RenamePreview {
  from: string;
  to: string;
  /** Hash of the note being moved, to be sent back with the write. */
  fromHash: string;
  /**
   * Set when the rename cannot happen at all: the note is gone, the target name is taken, the
   * path would leave the vault, the file system would not take the name, or more files link here
   * than one write may carry. `files` is then empty and there is nothing to confirm.
   */
  refusal?: 'notFound' | 'exists' | 'unsafePath' | 'unwritableName' | 'tooMany';
  files: RenameFile[];
  /**
   * Notes that share a name with either end of the rename. Short links resolve by name, so a
   * duplicate means some link may quietly start leading elsewhere; the preview warns about it
   * instead of refusing, because the vault is the user's to arrange.
   */
  nameClash: string[];
  /**
   * How many links to this note are deliberately left as they stand, across the whole vault —
   * including the files that are therefore not in `files` at all. A short `[[Mira]]` finds the
   * note wherever it moves, so most of a move's links need no file touched; without this number
   * the preview would look as if those links had been forgotten.
   */
  leftAlone: number;
  /** The note's title as the index knows it, which need not be the file name. */
  title: string;
  /** True when the title comes from the file name, so renaming the file renames what the user
   * reads on screen — worth saying out loud before the rename happens. */
  titleFollowsFileName: boolean;
}

/** `POST /api/rename` — the write the preview described. */
export interface RenameNoteRequest {
  from: string;
  to: string;
  /** Hash of the note being moved, as the preview reported it. */
  hash: string;
  /** The files to rewrite, each with the hash the preview read it at. What the caller leaves out
   * keeps its links as they are: the user may have unticked it. */
  files: { source: string; hash: string }[];
}

/**
 * What the rename did. The note has moved by the time this is sent, so a file whose links could
 * not be rewritten is reported here rather than failing the call: one stale source must not undo
 * a rename that already succeeded everywhere else.
 */
export interface RenameNoteResult {
  from: string;
  to: string;
  rewritten: { source: string; count: number }[];
  skipped: { source: string; reason: 'conflict' | 'notFound' | 'nothing' }[];
}

/** One place a tag stands, as the rename preview reports it. */
export interface TagRenameRef {
  /** 1-based line in the source note. */
  line: number;
  /** The tag as the file spells it now, and as it would read afterwards, both without the `#`. */
  before: string;
  after: string;
  /** In the prose, or as a value of the note's `tags` key. */
  where: 'inline' | 'frontmatter';
  /** The line it stands in, trimmed. */
  context: string;
}

export interface TagRenameFile {
  source: string;
  sourceTitle: string;
  /** Content hash when the preview read the file; sent back so a changed file is refused. */
  hash: string;
  refs: TagRenameRef[];
  /** Occurrences past the 50 listed per file. The write still covers all of them. */
  more: number;
}

/** `GET /api/tags/rename` — what renaming a tag would change, before anything is written. */
export interface TagRenamePreview {
  from: string;
  to: string;
  /**
   * Why nothing can happen, when that is the answer. `files` is then empty: `notFound` when no
   * note carries the tag, `unwritableName` when the new name is not one a tag can have, `same`
   * when the two names mean the same tag, `tooMany` when more files carry it than one operation
   * should touch.
   */
  refusal?: 'notFound' | 'unwritableName' | 'same' | 'tooMany';
  files: TagRenameFile[];
  /**
   * Tags that already exist under the new name. A tag has no identity beyond its name, so this
   * makes the two one tag and there is no way back; the preview says so rather than refusing.
   */
  merges: string[];
}

/** `POST /api/tags/rename`. */
export interface TagRenameResult {
  from: string;
  to: string;
  rewritten: { source: string; count: number }[];
  skipped: { source: string; reason: 'conflict' | 'notFound' | 'nothing' }[];
}

/** `POST /api/query` — the text of a `rhizom-query` block, run against the index. */
export interface QueryRequest {
  /** The text between the fences, exactly as the note writes it. */
  body: string;
  /**
   * Frontmatter keys the caller needs on every row, beyond the ones the block asked to show.
   * The milieu field is the reason: it draws a note at the position two of its own keys give,
   * and those keys are named by the axes rather than by the block. They arrive in `fields`
   * alongside the block's own columns and change nothing about how the block renders.
   */
  fields?: string[];
}

/** One note a query matched. */
export interface QueryRow {
  path: string;
  title: string;
  folder: string;
  tags: string[];
  modifiedAt: string;
  size: number;
  /**
   * The frontmatter values the query named as columns, already rendered as text. Rendered on
   * the server so that one place decides what a date, a list or a nested mapping looks like,
   * and so that a table never has to guess at an `unknown`.
   */
  fields: Record<string, string>;
}

/**
 * `POST /api/query`. The rows are what the block could be read as; `problems` is what it said
 * that could not be read. Both are answered together on purpose: a query with one bad line
 * still shows the notes the rest of it found, with the line that was ignored named underneath.
 */
export interface QueryResult {
  rows: QueryRow[];
  /** How many notes matched before the query's own limit cut the list. */
  total: number;
  view: QueryView;
  columns: string[];
  problems: QueryProblem[];
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
