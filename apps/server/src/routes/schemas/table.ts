// The player view's shapes. Each carries only what the table may read: a path, a public title and
// public Markdown — never a frontmatter value.
import { Type } from '@sinclair/typebox';

export const TableSessionsSchema = Type.Object(
  {
    campaign: Type.Boolean({ description: 'Whether the vault has a campaign at all' }),
    sessions: Type.Array(Type.Integer(), { description: 'The session numbers, in order' }),
  },
  { $id: 'TableSessions' },
);

export const PublicNoteSchema = Type.Object(
  {
    path: Type.String(),
    title: Type.String({ description: 'The public title: the first heading of the public text' }),
  },
  { $id: 'PublicNote' },
);

export const PublicNoteDocumentSchema = Type.Object(
  {
    path: Type.String(),
    title: Type.String(),
    markdown: Type.String({ description: 'The note without anything gated at that session' }),
    session: Type.Integer({ description: 'The session the text was cut for' }),
  },
  { $id: 'PublicNoteDocument' },
);

export const TableSessionQuerySchema = Type.Object({
  session: Type.Optional(
    Type.Integer({ minimum: 0, description: 'Defaults to the latest session' }),
  ),
});

export const TableSearchQuerySchema = Type.Object({
  q: Type.String({ maxLength: 500 }),
  session: Type.Optional(Type.Integer({ minimum: 0 })),
});
