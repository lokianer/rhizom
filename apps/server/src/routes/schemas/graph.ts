// The bubble field: nodes, edges, and how a caller asks for a part of it.
import { Type } from '@sinclair/typebox';

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
  embeds: Type.Optional(
    Type.Integer({ description: 'How many of the links are written as an embed' }),
  ),
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

export const GraphQuerySchema = Type.Object({
  clusterBy: Type.Optional(ClusterBySchema),
});

export const LocalGraphQuerySchema = Type.Object({
  path: Type.String({ minLength: 1 }),
  depth: Type.Optional(Type.Integer({ minimum: 1, maximum: 3, default: 1 })),
  clusterBy: Type.Optional(ClusterBySchema),
});
