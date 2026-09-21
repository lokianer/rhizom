// Where a note is named without a link, and what turning one into a link reports.
import { Type } from '@sinclair/typebox';

export const MentionSchema = Type.Object(
  {
    target: Type.String(),
    line: Type.Integer({ minimum: 1 }),
    start: Type.Integer({ minimum: 0 }),
    end: Type.Integer({ minimum: 0 }),
    text: Type.String(),
    context: Type.String(),
    inHeading: Type.Boolean({ description: 'Linking here would move a heading anchor' }),
    inTableCell: Type.Boolean({ description: 'The alias separator has to be escaped here' }),
    linkable: Type.Boolean({ description: 'False when the words break across a line' }),
  },
  { $id: 'Mention' },
);

export const MentionGroupSchema = Type.Object(
  {
    source: Type.String(),
    sourceTitle: Type.String(),
    hash: Type.String({ description: 'Send back when linking, so a changed file is refused' }),
    mentions: Type.Array(MentionSchema),
  },
  { $id: 'MentionGroup' },
);

export const MentionsResponseSchema = Type.Object(
  {
    path: Type.String(),
    terms: Type.Array(Type.String()),
    groups: Type.Array(MentionGroupSchema),
    truncated: Type.Boolean({ description: 'The search stopped at its cap' }),
  },
  { $id: 'MentionsResponse' },
);

export const MentionWriteSchema = Type.Object(
  {
    source: Type.String({ minLength: 1 }),
    hash: Type.String({ minLength: 1 }),
    offsets: Type.Array(Type.Integer({ minimum: 0 }), { minItems: 1, maxItems: 500 }),
  },
  { $id: 'MentionWrite' },
);

export const LinkMentionsBodySchema = Type.Object({
  path: Type.String({ minLength: 1 }),
  // The one batch write in the app: bounded, because nothing else bounds it.
  writes: Type.Array(MentionWriteSchema, { minItems: 1, maxItems: 200 }),
});

export const LinkMentionsResultSchema = Type.Object({
  linked: Type.Array(Type.Object({ source: Type.String(), count: Type.Integer() })),
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

export const MentionsQuerySchema = Type.Object({ path: Type.String({ minLength: 1 }) });
