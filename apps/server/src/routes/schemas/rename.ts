// Renaming or moving a note, and the preview that says what it would rewrite first.
import { Type } from '@sinclair/typebox';

export const RenameRefSchema = Type.Object(
  {
    line: Type.Integer({ minimum: 1 }),
    start: Type.Integer({ minimum: 0 }),
    end: Type.Integer({ minimum: 0 }),
    before: Type.String(),
    after: Type.String(),
    rewrite: Type.Boolean({ description: 'False when the link is left as it stands' }),
    skipReason: Type.Optional(
      Type.Union([Type.Literal('alias'), Type.Literal('stillResolves')], {
        description: 'On what grounds the link is left alone',
      }),
    ),
    inHeading: Type.Boolean({ description: 'Rewriting here would move a heading anchor' }),
  },
  { $id: 'RenameRef' },
);

export const RenameFileSchema = Type.Object(
  {
    source: Type.String(),
    sourceTitle: Type.String(),
    hash: Type.String({ description: 'Send back when renaming, so a changed file is refused' }),
    refs: Type.Array(RenameRefSchema),
    more: Type.Integer({ minimum: 0, description: 'References beyond the 50 listed per file' }),
  },
  { $id: 'RenameFile' },
);

export const RenamePreviewSchema = Type.Object(
  {
    from: Type.String(),
    to: Type.String(),
    fromHash: Type.String(),
    refusal: Type.Optional(
      Type.Union(
        [
          Type.Literal('notFound'),
          Type.Literal('exists'),
          Type.Literal('unsafePath'),
          Type.Literal('unwritableName'),
          Type.Literal('tooMany'),
        ],
        { description: 'Why the rename cannot happen at all; files is then empty' },
      ),
    ),
    files: Type.Array(RenameFileSchema),
    nameClash: Type.Array(Type.String(), {
      description: 'Notes sharing a name with either end, where links may retarget silently',
    }),
    leftAlone: Type.Integer({
      minimum: 0,
      description: 'Links left as written, counting the files left out of the list entirely',
    }),
    title: Type.String(),
    titleFollowsFileName: Type.Boolean({ description: 'The title is the file name' }),
  },
  { $id: 'RenamePreview' },
);

export const RenameNoteBodySchema = Type.Object({
  from: Type.String({ minLength: 1 }),
  to: Type.String({ minLength: 1 }),
  hash: Type.String({ minLength: 1 }),
  // A rename may touch nothing at all, and past a thousand files the preview refuses instead.
  files: Type.Array(
    Type.Object({ source: Type.String({ minLength: 1 }), hash: Type.String({ minLength: 1 }) }),
    { minItems: 0, maxItems: 1000 },
  ),
});

export const RenameNoteResultSchema = Type.Object({
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

export const RenameQuerySchema = Type.Object({
  from: Type.String({ minLength: 1 }),
  to: Type.String({ minLength: 1 }),
});
