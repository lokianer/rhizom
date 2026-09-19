export type {
  ApiError,
  AssetSummary,
  Backlink,
  CreateNoteRequest,
  GlossaryEntry,
  GraphResponse,
  Heading,
  HealthResponse,
  IndexEvent,
  LinkKind,
  LinkMentionsRequest,
  LinkMentionsResult,
  MentionGroup,
  MentionWrite,
  MentionsResponse,
  NoteDocument,
  NoteLink,
  NoteSummary,
  SaveNoteRequest,
  SearchHit,
  SearchResponse,
  TagCount,
  TemplateSettings,
  TreeEntry,
  UploadResponse,
  VaultInfo,
} from './api.js';
export { NOTE_TYPES, noteTypeOf, type NoteType } from './frontmatter.js';
export {
  renderNoteWithEmbeds,
  type EmbedLabels,
  type EmbedRenderOptions,
  type EmbedSource,
  type RenderedWithEmbeds,
} from './embed.js';
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
export {
  canLinkTo,
  findMentions,
  linkMentions,
  proseSpans,
  type Mention,
  type ProseSpan,
} from './mentions.js';
export { parseNote, type ParsedLink, type ParsedNote, type ParseOptions } from './parse.js';
export {
  ensureMarkdownExtension,
  folderOf,
  isInFolder,
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
export {
  createTermMatcher,
  definedTerms,
  foldTerm,
  glossaryTerms,
  summaryOf,
  type DefinedTerm,
  type TermMatch,
  type TermMatcher,
  type VaultTerm,
} from './terms.js';
export {
  expandTemplate,
  formatDate,
  roll,
  type ExpandedTemplate,
  type TemplateContext,
} from './template.js';
export { parseWikilink, type WikilinkTarget } from './wikilink.js';
export {
  renderNote,
  type EmbedReference,
  type EmbedResult,
  type RenderOptions,
  type RenderedLink,
  type RenderedNote,
} from './render.js';
export { sliceSection } from './section.js';
