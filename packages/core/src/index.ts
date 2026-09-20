export type {
  ApiError,
  AssetSummary,
  Backlink,
  CreateNoteRequest,
  DailySettings,
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
  QueryRequest,
  QueryResult,
  QueryRow,
  RenameFile,
  RenameNoteRequest,
  RenameNoteResult,
  RenamePreview,
  RenameRef,
  SaveNoteRequest,
  SearchHit,
  SearchResponse,
  TagCount,
  TemplateSettings,
  TreeEntry,
  UploadResponse,
  VaultInfo,
} from './api.js';
export { calloutKindOf, CALLOUT_KINDS, type CalloutKind, type CalloutLabels } from './callout.js';
export {
  findFrontmatter,
  frontmatterFields,
  setFrontmatter,
  NOTE_TYPES,
  noteTypeOf,
  type FieldKind,
  type FrontmatterBlock,
  type FrontmatterField,
  type NoteType,
} from './frontmatter.js';
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
  encodeLinkUrl,
  findLinkRefs,
  rewriteLinkTargets,
  type LinkRef,
  type LinkTargetEdit,
} from './linkrefs.js';
export {
  canLinkTo,
  findMentions,
  linkMentions,
  proseSpans,
  type Mention,
  type ProseSpan,
} from './mentions.js';
export { parseNote, type ParsedLink, type ParsedNote, type ParseOptions } from './parse.js';
export { queryBlocks } from './query-blocks.js';
export {
  parseQuery,
  BUILT_IN_COLUMNS,
  QUERY_KEYS,
  QUERY_LANGUAGE,
  QUERY_SORTS,
  QUERY_VIEWS,
  type ParsedQuery,
  type Query,
  type QueryProblem,
  type QuerySort,
  type QueryView,
} from './query.js';
export {
  renderQueryResult,
  type BuiltInColumn,
  type QueryLabels,
  type QueryLinks,
} from './query-view.js';
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
  linkTextFor,
  resolveLinkTarget,
  writtenTargetFor,
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
