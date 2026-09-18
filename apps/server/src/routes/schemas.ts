// JSON schemas of the API, from which Fastify validates requests, serialises responses and
// @fastify/swagger derives the OpenAPI document. The TypeScript contracts in @rhizom/core
// describe the same shapes; types.test.ts keeps the two in step.
import { Type, type Static } from '@sinclair/typebox';

export const ErrorSchema = Type.Object(
  {
    statusCode: Type.Integer(),
    error: Type.String(),
    message: Type.String(),
  },
  { $id: 'Error', description: 'Shape of every error response' },
);

export const HealthSchema = Type.Object({
  status: Type.Literal('ok'),
  version: Type.String(),
});

export const VaultInfoSchema = Type.Object(
  {
    name: Type.String({ description: 'Folder name of the vault' }),
    noteCount: Type.Integer(),
    indexedAt: Type.Union([Type.String({ format: 'date-time' }), Type.Null()]),
  },
  { $id: 'VaultInfo' },
);

export const HeadingSchema = Type.Object(
  {
    level: Type.Integer({ minimum: 1, maximum: 6 }),
    text: Type.String(),
    slug: Type.String(),
    line: Type.Integer({ minimum: 0 }),
  },
  { $id: 'Heading' },
);

const noteSummaryFields = {
  path: Type.String({ description: 'Vault path of the note, including the extension' }),
  name: Type.String(),
  title: Type.String(),
  folder: Type.String(),
  tags: Type.Array(Type.String()),
  modifiedAt: Type.String({ format: 'date-time' }),
  size: Type.Integer(),
  linkCount: Type.Integer(),
  backlinkCount: Type.Integer(),
};

export const NoteSummarySchema = Type.Object(noteSummaryFields, { $id: 'NoteSummary' });

export const NoteDocumentSchema = Type.Object(
  {
    ...noteSummaryFields,
    content: Type.String(),
    hash: Type.String({ description: 'Send back as If-Match when saving' }),
    frontmatter: Type.Record(Type.String(), Type.Unknown()),
    headings: Type.Array(HeadingSchema),
  },
  { $id: 'NoteDocument' },
);

export const LinkKindSchema = Type.Union([
  Type.Literal('wikilink'),
  Type.Literal('embed'),
  Type.Literal('markdown'),
]);

export const NoteLinkSchema = Type.Object(
  {
    source: Type.String(),
    target: Type.Union([Type.String(), Type.Null()]),
    raw: Type.String(),
    kind: LinkKindSchema,
    alias: Type.Optional(Type.String()),
    heading: Type.Optional(Type.String()),
    line: Type.Integer(),
  },
  { $id: 'NoteLink' },
);

export const BacklinkSchema = Type.Object(
  {
    source: Type.String(),
    sourceTitle: Type.String(),
    context: Type.String(),
    line: Type.Integer(),
  },
  { $id: 'Backlink' },
);

export const SearchHitSchema = Type.Object(
  {
    path: Type.String(),
    title: Type.String(),
    snippet: Type.String({ description: 'HTML-escaped, matches wrapped in <mark>' }),
    score: Type.Number(),
  },
  { $id: 'SearchHit' },
);

export const SearchResponseSchema = Type.Object(
  {
    query: Type.String(),
    hits: Type.Array(SearchHitSchema),
    total: Type.Integer(),
  },
  { $id: 'SearchResponse' },
);

export const TagCountSchema = Type.Object(
  { tag: Type.String(), count: Type.Integer() },
  { $id: 'TagCount' },
);

export const TreeEntrySchema = Type.Recursive(
  (This) =>
    Type.Union([
      Type.Object({
        type: Type.Literal('folder'),
        name: Type.String(),
        path: Type.String(),
        children: Type.Array(This),
      }),
      Type.Object({
        type: Type.Literal('note'),
        name: Type.String(),
        path: Type.String(),
        title: Type.String(),
      }),
    ]),
  { $id: 'TreeEntry' },
);

export const GraphNodeSchema = Type.Object({
  path: Type.String(),
  name: Type.String(),
  folder: Type.String(),
  cluster: Type.String(),
  degree: Type.Integer(),
  inDegree: Type.Integer(),
  outDegree: Type.Integer(),
});

export const GraphEdgeSchema = Type.Object({
  source: Type.String(),
  target: Type.String(),
  count: Type.Integer(),
});

export const GraphSchema = Type.Object(
  {
    nodes: Type.Array(GraphNodeSchema),
    edges: Type.Array(GraphEdgeSchema),
    clusters: Type.Array(Type.String()),
  },
  { $id: 'Graph' },
);

export const ClusterBySchema = Type.Union([Type.Literal('folder'), Type.Literal('tag')], {
  default: 'folder',
});

export const CreateNoteBodySchema = Type.Object({
  path: Type.String({ minLength: 1, description: 'Vault path; .md is added when missing' }),
  content: Type.Optional(Type.String()),
});

export const SaveNoteBodySchema = Type.Object({
  content: Type.String(),
});

export const AssetSummarySchema = Type.Object(
  {
    path: Type.String(),
    size: Type.Integer(),
    modifiedAt: Type.String({ format: 'date-time' }),
  },
  { $id: 'AssetSummary' },
);

export const UploadResponseSchema = Type.Object({
  path: Type.String({ description: 'Vault path of the stored file' }),
});

export const SyncResultSchema = Type.Object({
  added: Type.Integer(),
  updated: Type.Integer(),
  removed: Type.Integer(),
  unchanged: Type.Integer(),
});

export const NotePathParamsSchema = Type.Object({ '*': Type.String({ minLength: 1 }) });

export const PathQuerySchema = Type.Object({ path: Type.String({ minLength: 1 }) });

export const SearchQuerySchema = Type.Object({
  q: Type.String({ minLength: 1 }),
  limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 200, default: 50 })),
});

export const GraphQuerySchema = Type.Object({
  clusterBy: Type.Optional(ClusterBySchema),
});

export const LocalGraphQuerySchema = Type.Object({
  path: Type.String({ minLength: 1 }),
  depth: Type.Optional(Type.Integer({ minimum: 1, maximum: 3, default: 1 })),
  clusterBy: Type.Optional(ClusterBySchema),
});

export type ErrorBody = Static<typeof ErrorSchema>;
export type CreateNoteBody = Static<typeof CreateNoteBodySchema>;
export type SaveNoteBody = Static<typeof SaveNoteBodySchema>;
