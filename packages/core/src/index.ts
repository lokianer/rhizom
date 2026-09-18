export type {
  ApiError,
  Backlink,
  CreateNoteRequest,
  GraphResponse,
  Heading,
  HealthResponse,
  IndexEvent,
  LinkKind,
  NoteDocument,
  NoteLink,
  NoteSummary,
  SaveNoteRequest,
  SearchHit,
  SearchResponse,
  TagCount,
  TreeEntry,
  UploadResponse,
  VaultInfo,
} from './api.js';
export { fuzzyMatch, fuzzyRank, type FuzzyMatch, type FuzzyRanked } from './fuzzy.js';
export {
  buildGraph,
  clusterColorIndex,
  localGraph,
  type GraphData,
  type GraphEdge,
  type GraphLink,
  type GraphNode,
  type GraphNote,
  type GraphOptions,
} from './graph.js';
export { isMarkdownFile, MARKDOWN_EXTENSIONS } from './markdown.js';
export { parseNote, type ParsedLink, type ParsedNote, type ParseOptions } from './parse.js';
export {
  ensureMarkdownExtension,
  folderOf,
  isSafeVaultPath,
  noteNameOf,
  toVaultPath,
} from './paths.js';
export {
  createNoteIndex,
  resolveLinkTarget,
  type LinkResolution,
  type NoteIndex,
} from './resolve.js';
export { remarkWikilink, type Wikilink } from './remark-wikilink.js';
export { parseWikilink, type WikilinkTarget } from './wikilink.js';
export { renderNote, type RenderOptions, type RenderedLink, type RenderedNote } from './render.js';
