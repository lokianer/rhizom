// Typed access to the REST API. Every shape comes from @rhizom/core, so the client and the
// server cannot drift apart; failures arrive as ApiRequestError with the server's message.
import type {
  AssetSummary,
  Backlink,
  CreateNoteRequest,
  GlossaryEntry,
  GraphResponse,
  LinkMentionsRequest,
  LinkMentionsResult,
  MentionsResponse,
  NoteDocument,
  NoteLink,
  NoteSummary,
  QueryResult,
  RenameNoteRequest,
  RenameNoteResult,
  RenamePreview,
  TagRenamePreview,
  TagRenameResult,
  SaveNoteRequest,
  SearchResponse,
  TagCount,
  TreeEntry,
  UploadResponse,
  VaultInfo,
  VaultSummary,
  PublicNote,
  PublicNoteDocument,
  SearchHit,
  TableSessions,
} from '@rhizom/core';

import { currentVault } from '../routing/vault.js';

export class ApiRequestError extends Error {
  readonly status: number;
  /** True when the note changed on disk since it was loaded (HTTP 412). */
  readonly isConflict: boolean;

  constructor(status: number, message: string) {
    super(message);
    this.name = 'ApiRequestError';
    this.status = status;
    this.isConflict = status === 412;
  }
}

/**
 * How long a change has to stand still before the server is asked about it again.
 *
 * Four places wait: the backlinks and the outline after a save, the unlinked mentions after a
 * "link all" that writes several notes, and a query block while it is being typed. The reason is
 * the same in all four — one keystroke or one watcher event is not a question — so the number is
 * one number, and changing it changes all of them together.
 */
export const SETTLE_MS = 400;

export interface RequestOptions {
  signal?: AbortSignal | undefined;
  /**
   * The vault the request belongs to, when it must not follow the tab. A save that flushes while
   * the tab is already switching to another vault still belongs to the one the note came from.
   */
  vault?: string | undefined;
}

// RequestInit types `signal` as `AbortSignal | null`, which under exactOptionalPropertyTypes
// cannot take an omitted option: the callers' `signal?: AbortSignal` wins, and request() maps it.
type RequestInput = Omit<RequestInit, 'signal'> & RequestOptions;

/** Whether a rejection is the caller's own cancellation rather than a failure worth showing. */
export function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError';
}

/** Encodes a vault path for a URL without turning its separators into %2F. */
export function encodeVaultPath(path: string): string {
  return path.split('/').map(encodeURIComponent).join('/');
}

async function request<T>(path: string, init: RequestInput = {}): Promise<T> {
  // The vault was spent on the URL already; it is not a fetch option.
  const { signal, vault: _vault, ...rest } = init;
  const response = await fetch(path, { ...rest, signal: signal ?? null });
  if (!response.ok) {
    throw new ApiRequestError(response.status, await errorMessage(response));
  }
  if (response.status === 204) {
    return undefined as T;
  }
  return (await response.json()) as T;
}

async function errorMessage(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { message?: unknown };
    if (typeof body.message === 'string' && body.message !== '') {
      return body.message;
    }
  } catch {
    // A non-JSON body (a proxy error page, an empty response): fall back to the status text.
  }
  return response.statusText === ''
    ? `Request failed (${String(response.status)})`
    : response.statusText;
}

/** A route of the vault this tab is in, or of the one a request names. */
function inVault(path: string, vault: string = currentVault()): string {
  return `/api/v/${encodeURIComponent(vault)}${path}`;
}

function json(body: unknown): RequestInput {
  return { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) };
}

export const api = {
  vaults: (options?: RequestOptions) => request<VaultSummary[]>('/api/vaults', options),
  vault: (options?: RequestOptions) => request<VaultInfo>(inVault('/vault'), options),
  tree: (options?: RequestOptions) => request<TreeEntry[]>(inVault('/tree'), options),
  notes: (options?: RequestOptions) => request<NoteSummary[]>(inVault('/notes'), options),

  note: (path: string, options?: RequestOptions) =>
    request<NoteDocument>(inVault(`/notes/${encodeVaultPath(path)}`, options?.vault), options),

  createNote: (body: CreateNoteRequest, options?: RequestOptions) =>
    request<NoteDocument>(inVault('/notes'), { method: 'POST', ...json(body), ...options }),

  /** Saves a note; pass the hash of the loaded document to be told about concurrent edits. */
  saveNote: (path: string, body: SaveNoteRequest, hash?: string, options?: RequestOptions) =>
    request<NoteDocument>(inVault(`/notes/${encodeVaultPath(path)}`, options?.vault), {
      method: 'PUT',
      ...json(body),
      headers: {
        'content-type': 'application/json',
        ...(hash === undefined ? {} : { 'if-match': `"${hash}"` }),
      },
      ...options,
    }),

  deleteNote: (path: string, options?: RequestOptions) =>
    request<void>(inVault(`/notes/${encodeVaultPath(path)}`), { method: 'DELETE', ...options }),

  links: (path: string, options?: RequestOptions) =>
    request<NoteLink[]>(inVault(`/links?path=${encodeURIComponent(path)}`), options),

  backlinks: (path: string, options?: RequestOptions) =>
    request<Backlink[]>(inVault(`/backlinks?path=${encodeURIComponent(path)}`), options),

  search: (query: string, options?: RequestOptions) =>
    request<SearchResponse>(inVault(`/search?q=${encodeURIComponent(query)}`), options),

  /**
   * Answers one `rhizom-query` block against the index; the body is the text between the fences.
   *
   * `fields` names frontmatter keys the caller needs on every row beyond the ones the block asked
   * to show. The milieu field is what they are for: it draws a note at the position two of its own
   * keys give, and those keys are named by the axes rather than by the block. They arrive in
   * `row.fields` as text, next to the block's own columns, and change nothing about the block.
   */
  runQuery: (body: string, fields?: readonly string[], options?: RequestOptions) =>
    request<QueryResult>(inVault('/query'), {
      method: 'POST',
      ...json(
        fields === undefined || fields.length === 0 ? { body } : { body, fields: [...fields] },
      ),
      ...options,
    }),

  assets: (options?: RequestOptions) => request<AssetSummary[]>(inVault('/assets'), options),

  tags: (options?: RequestOptions) => request<TagCount[]>(inVault('/tags'), options),

  glossary: (options?: RequestOptions) => request<GlossaryEntry[]>(inVault('/glossary'), options),

  mentions: (path: string, options?: RequestOptions) =>
    request<MentionsResponse>(inVault(`/mentions?path=${encodeURIComponent(path)}`), options),

  linkMentions: (body: LinkMentionsRequest, options?: RequestOptions) =>
    request<LinkMentionsResult>(inVault('/mentions/link'), {
      method: 'POST',
      ...json(body),
      ...options,
    }),

  /** What renaming `from` to `to` would do, before anything is written. */
  renamePreview: (from: string, to: string, options?: RequestOptions) =>
    request<RenamePreview>(
      inVault(`/rename?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`),
      options,
    ),

  renameNote: (body: RenameNoteRequest, options?: RequestOptions) =>
    request<RenameNoteResult>(inVault('/rename'), { method: 'POST', ...json(body), ...options }),

  tagRenamePreview: (from: string, to: string, options?: RequestOptions) =>
    request<TagRenamePreview>(
      inVault(`/tags/rename?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`),
      options,
    ),

  renameTag: (
    body: { from: string; to: string; files: { source: string; hash: string }[] },
    options?: RequestOptions,
  ) =>
    request<TagRenameResult>(inVault('/tags/rename'), {
      method: 'POST',
      ...json(body),
      ...options,
    }),

  graph: (clusterBy: 'folder' | 'tag', options?: RequestOptions) =>
    request<GraphResponse>(inVault(`/graph?clusterBy=${clusterBy}`), options),

  localGraph: (
    path: string,
    depth: number,
    clusterBy: 'folder' | 'tag',
    options?: RequestOptions,
  ) =>
    request<GraphResponse>(
      inVault(
        `/graph/local?path=${encodeURIComponent(path)}&depth=${String(depth)}&clusterBy=${clusterBy}`,
      ),
      options,
    ),

  uploadAsset: (file: File, options?: RequestOptions) => {
    const body = new FormData();
    body.append('file', file, file.name);
    return request<UploadResponse>(inVault('/assets'), { method: 'POST', body, ...options });
  },

  rebuildIndex: (options?: RequestOptions) =>
    request<{ added: number; updated: number; removed: number; unchanged: number }>(
      inVault('/index/rebuild'),
      { method: 'POST', ...options },
    ),

  /** URL of a file inside the vault, for `<img src>` and links. */
  // The player view. Every call names its session; the server cuts what the table may read.
  tableSessions: (options?: RequestOptions) =>
    request<TableSessions>(inVault('/table/sessions'), options),
  tableNotes: (session: number, options?: RequestOptions) =>
    request<PublicNote[]>(inVault(`/table/notes?session=${String(session)}`), options),
  tableNote: (path: string, session: number, options?: RequestOptions) =>
    request<PublicNoteDocument>(
      inVault(`/table/notes/${encodeVaultPath(path)}?session=${String(session)}`),
      options,
    ),
  tableSearch: (query: string, session: number, options?: RequestOptions) =>
    request<SearchHit[]>(
      inVault(`/table/search?q=${encodeURIComponent(query)}&session=${String(session)}`),
      options,
    ),
  assetUrl: (path: string) => inVault(`/assets/${encodeVaultPath(path)}`),
};
