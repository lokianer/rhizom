// Renaming a tag across the vault, and the preview of what that would touch.
import { Type } from '@sinclair/typebox';

export const TagRenameRefSchema = Type.Object(
  {
    line: Type.Integer({ minimum: 1 }),
    before: Type.String(),
    after: Type.String(),
    where: Type.Union([Type.Literal('inline'), Type.Literal('frontmatter')], {
      description: 'In the prose, or as a value of the tags key',
    }),
    context: Type.String({ description: 'The line it stands in, for the preview' }),
  },
  { $id: 'TagRenameRef' },
);

export const TagRenameFileSchema = Type.Object(
  {
    source: Type.String(),
    sourceTitle: Type.String(),
    hash: Type.String({ description: 'Send back when renaming, so a changed file is refused' }),
    refs: Type.Array(TagRenameRefSchema),
    more: Type.Integer({ minimum: 0, description: 'Occurrences beyond the 50 listed per file' }),
  },
  { $id: 'TagRenameFile' },
);

export const TagRenamePreviewSchema = Type.Object(
  {
    from: Type.String(),
    to: Type.String(),
    refusal: Type.Optional(
      Type.Union(
        [
          Type.Literal('notFound'),
          Type.Literal('unwritableName'),
          Type.Literal('same'),
          Type.Literal('tooMany'),
        ],
        { description: 'Why the rename cannot happen at all; files is then empty' },
      ),
    ),
    files: Type.Array(TagRenameFileSchema),
    merges: Type.Array(Type.String(), {
      description: 'Tags that already exist under the new name, so the two become one',
    }),
  },
  { $id: 'TagRenamePreview' },
);

export const TagRenameBodySchema = Type.Object({
  from: Type.String({ minLength: 1, maxLength: 200 }),
  to: Type.String({ minLength: 1, maxLength: 200 }),
  files: Type.Array(
    Type.Object({ source: Type.String({ minLength: 1 }), hash: Type.String({ minLength: 1 }) }),
    { minItems: 0, maxItems: 1000 },
  ),
});

export const TagRenameResultSchema = Type.Object({
  from: Type.String(),
  to: Type.String(),
  rewritten: Type.Array(
    Type.Object({ source: Type.String(), count: Type.Integer({ minimum: 0 }) }),
  ),
  skipped: Type.Array(
    Type.Object({
      source: Type.String(),
      reason: Type.Union([
        Type.Literal('conflict'),
        Type.Literal('notFound'),
        Type.Literal('nothing'),
      ]),
    }),
  ),
});

export const TagRenameQuerySchema = Type.Object({
  from: Type.String({ minLength: 1, maxLength: 200 }),
  to: Type.String({ minLength: 1, maxLength: 200 }),
});
