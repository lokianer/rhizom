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
  SaveNoteRequest,
  SearchResponse,
  TagCount,
  TreeEntry,
  UploadResponse,
  VaultInfo,
} from '@rhizom/core';

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

export interface RequestOptions {
  signal?: AbortSignal | undefined;
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
  const { signal, ...rest } = init;
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

function json(body: unknown): RequestInput {
  return { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) };
}

export const api = {
  vault: (options?: RequestOptions) => request<VaultInfo>('/api/vault', options),
  tree: (options?: RequestOptions) => request<TreeEntry[]>('/api/tree', options),
  notes: (options?: RequestOptions) => request<NoteSummary[]>('/api/notes', options),

  note: (path: string, options?: RequestOptions) =>
    request<NoteDocument>(`/api/notes/${encodeVaultPath(path)}`, options),

  createNote: (body: CreateNoteRequest, options?: RequestOptions) =>
    request<NoteDocument>('/api/notes', { method: 'POST', ...json(body), ...options }),

  /** Saves a note; pass the hash of the loaded document to be told about concurrent edits. */
  saveNote: (path: string, body: SaveNoteRequest, hash?: string, options?: RequestOptions) =>
    request<NoteDocument>(`/api/notes/${encodeVaultPath(path)}`, {
      method: 'PUT',
      ...json(body),
      headers: {
        'content-type': 'application/json',
        ...(hash === undefined ? {} : { 'if-match': `"${hash}"` }),
      },
      ...options,
    }),

  deleteNote: (path: string, options?: RequestOptions) =>
    request<void>(`/api/notes/${encodeVaultPath(path)}`, { method: 'DELETE', ...options }),

  links: (path: string, options?: RequestOptions) =>
    request<NoteLink[]>(`/api/links?path=${encodeURIComponent(path)}`, options),

  backlinks: (path: string, options?: RequestOptions) =>
    request<Backlink[]>(`/api/backlinks?path=${encodeURIComponent(path)}`, options),

  search: (query: string, options?: RequestOptions) =>
    request<SearchResponse>(`/api/search?q=${encodeURIComponent(query)}`, options),

  assets: (options?: RequestOptions) => request<AssetSummary[]>('/api/assets', options),

  tags: (options?: RequestOptions) => request<TagCount[]>('/api/tags', options),

  glossary: (options?: RequestOptions) => request<GlossaryEntry[]>('/api/glossary', options),

  mentions: (path: string, options?: RequestOptions) =>
    request<MentionsResponse>(`/api/mentions?path=${encodeURIComponent(path)}`, options),

  linkMentions: (body: LinkMentionsRequest, options?: RequestOptions) =>
    request<LinkMentionsResult>('/api/mentions/link', {
      method: 'POST',
      ...json(body),
      ...options,
    }),

  graph: (clusterBy: 'folder' | 'tag', options?: RequestOptions) =>
    request<GraphResponse>(`/api/graph?clusterBy=${clusterBy}`, options),

  localGraph: (
    path: string,
    depth: number,
    clusterBy: 'folder' | 'tag',
    options?: RequestOptions,
  ) =>
    request<GraphResponse>(
      `/api/graph/local?path=${encodeURIComponent(path)}&depth=${String(depth)}&clusterBy=${clusterBy}`,
      options,
    ),

  uploadAsset: (file: File, options?: RequestOptions) => {
    const body = new FormData();
    body.append('file', file, file.name);
    return request<UploadResponse>('/api/assets', { method: 'POST', body, ...options });
  },

  rebuildIndex: (options?: RequestOptions) =>
    request<{ added: number; updated: number; removed: number; unchanged: number }>(
      '/api/index/rebuild',
      { method: 'POST', ...options },
    ),

  /** URL of a file inside the vault, for `<img src>` and links. */
  assetUrl: (path: string) => `/api/assets/${encodeVaultPath(path)}`,
};
