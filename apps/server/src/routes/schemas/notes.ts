// A note as the API hands it over: what the vault says about it, what it says about itself,
// and the links between the two.
import { Type } from '@sinclair/typebox';

export const TemplateSettingsSchema = Type.Object(
  {
    folder: Type.Union([Type.String(), Type.Null()], {
      description: 'Vault path of the template folder, or null when the vault has none',
    }),
    dateFormat: Type.String({ description: 'What {{date}} means without a format of its own' }),
    timeFormat: Type.String({ description: 'What {{time}} means without a format of its own' }),
  },
  { $id: 'TemplateSettings' },
);

export const DailySettingsSchema = Type.Object(
  {
    folder: Type.Union([Type.String(), Type.Null()], {
      description: 'Vault path of the daily-note folder, or null when the vault keeps none',
    }),
    format: Type.String({ description: 'The file name, in a template format' }),
    template: Type.Union([Type.String(), Type.Null()], {
      description: 'The note a new day starts from',
    }),
  },
  { $id: 'DailySettings' },
);

export const VaultInfoSchema = Type.Object(
  {
    name: Type.String({ description: 'Folder name of the vault' }),
    noteCount: Type.Integer(),
    indexedAt: Type.Union([Type.String({ format: 'date-time' }), Type.Null()]),
    templates: TemplateSettingsSchema,
    daily: DailySettingsSchema,
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

export const noteSummaryFields = {
  path: Type.String({ description: 'Vault path of the note, including the extension' }),
  name: Type.String(),
  title: Type.String(),
  folder: Type.String(),
  tags: Type.Array(Type.String()),
  aliases: Type.Array(Type.String(), { description: 'Other names the note answers to' }),
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

export const GlossaryEntrySchema = Type.Object(
  {
    path: Type.String(),
    title: Type.String(),
    aliases: Type.Array(Type.String()),
    summary: Type.String({ description: "The note's first block as plain text" }),
  },
  { $id: 'GlossaryEntry' },
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

export const CreateNoteBodySchema = Type.Object({
  path: Type.String({ minLength: 1, description: 'Vault path; .md is added when missing' }),
  content: Type.Optional(Type.String()),
});

export const SaveNoteBodySchema = Type.Object({
  content: Type.String(),
});
