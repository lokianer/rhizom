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
  TagRenameFile,
  TagRenamePreview,
  TagRenameRef,
  TagRenameResult,
  TemplateSettings,
  TreeEntry,
  UploadResponse,
  VaultInfo,
} from './api.js';
export {
  calloutKindOf,
  CALLOUT_KINDS,
  type CalloutKind,
  type CalloutLabels,
} from './syntax/callout.js';
export {
  axisValueOf,
  placeNote,
  placementOf,
  readAxes,
  AXES_KEYS,
  AXIS_MAX,
  AXIS_MIN,
  type Axis,
  type AxesMissing,
  type AxesPlacement,
  type AxesPoint,
  type AxesSettings,
} from './vault/axes.js';
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
} from './vault/frontmatter.js';
export {
  renderNoteWithEmbeds,
  type EmbedLabels,
  type EmbedRenderOptions,
  type EmbedSource,
  type RenderedWithEmbeds,
} from './render/embed.js';
export { fuzzyMatch, fuzzyRank, type FuzzyMatch, type FuzzyRanked } from './text/fuzzy.js';
export {
  buildGraph,
  clusterColorIndex,
  CLUSTER_COUNT,
  localGraph,
  type GraphData,
  type GraphEdge,
  type GraphLink,
  type GraphNode,
  type GraphNote,
  type GraphOptions,
} from './vault/graph.js';
export { isMarkdownFile, MARKDOWN_EXTENSIONS } from './vault/markdown.js';
export {
  encodeLinkUrl,
  findLinkRefs,
  rewriteLinkTargets,
  type LinkRef,
  type LinkTargetEdit,
} from './syntax/linkrefs.js';
export {
  canLinkTo,
  findMentions,
  linkMentions,
  proseSpans,
  type Mention,
  type ProseSpan,
} from './vault/mentions.js';
export { parseNote, type ParsedLink, type ParsedNote, type ParseOptions } from './syntax/parse.js';
export { queryBlocks } from './query/blocks.js';
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
} from './query/language.js';
export {
  renderQueryResult,
  type BuiltInColumn,
  type QueryLabels,
  type QueryLinks,
} from './render/query-view.js';
export {
  ensureMarkdownExtension,
  folderOf,
  isInFolder,
  isSafeVaultPath,
  noteNameOf,
  toVaultPath,
} from './vault/paths.js';
export {
  createNoteIndex,
  linkTextFor,
  resolveLinkTarget,
  writtenTargetFor,
  type LinkResolution,
  type NoteIndex,
} from './vault/resolve.js';
export { remarkWikilink, type Wikilink } from './syntax/remark-wikilink.js';
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
} from './vault/terms.js';
export {
  DEFAULT_DATE_FORMAT,
  DEFAULT_TIME_FORMAT,
  expandTemplate,
  formatDate,
  roll,
  type ExpandedTemplate,
  type TemplateContext,
} from './syntax/template.js';
export { parseWikilink, type WikilinkTarget } from './syntax/wikilink.js';
export {
  renderNote,
  type EmbedReference,
  type EmbedResult,
  type RenderOptions,
  type RenderedLink,
  type RenderedNote,
} from './render/note.js';
export { blockIdOnLine, sliceBlock, sliceSection } from './syntax/section.js';
export { isTaskLine, setTask } from './syntax/tasks.js';
export {
  findTagRefs,
  isTagName,
  normaliseTag,
  renamedTag,
  rewriteTags,
  type TagEdit,
  type TagRef,
} from './syntax/tagrefs.js';
