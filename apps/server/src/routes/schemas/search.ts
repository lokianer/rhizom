// Full-text search and the tags the vault uses.
import { Type } from '@sinclair/typebox';

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

export const SearchQuerySchema = Type.Object({
  q: Type.String({ minLength: 1 }),
  limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 200, default: 50 })),
});
