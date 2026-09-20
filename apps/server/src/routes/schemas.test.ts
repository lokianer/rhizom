// The TypeBox schemas in schemas.ts and the TypeScript contracts in @rhizom/core are two
// descriptions of the same API, and nothing generates one from the other. This file makes the
// compiler compare them: every pair below must be assignable in both directions, so a field
// added, removed or made optional on one side and not the other fails `pnpm typecheck` — which
// type-checks this file through apps/server/tsconfig.test.json — rather than reaching a client.
import type {
  ApiError,
  AssetSummary,
  Backlink,
  CreateNoteRequest,
  GlossaryEntry,
  GraphResponse,
  Heading,
  HealthResponse,
  LinkKind,
  LinkMentionsRequest,
  LinkMentionsResult,
  Mention,
  MentionGroup,
  MentionWrite,
  MentionsResponse,
  NoteDocument,
  NoteLink,
  NoteSummary,
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
} from '@rhizom/core';
import type { Static } from '@sinclair/typebox';
import { describe, expect, it } from 'vitest';

import type {
  AssetSummarySchema,
  BacklinkSchema,
  CreateNoteBodySchema,
  ErrorSchema,
  GlossaryEntrySchema,
  GraphSchema,
  HeadingSchema,
  HealthSchema,
  LinkKindSchema,
  LinkMentionsBodySchema,
  LinkMentionsResultSchema,
  MentionGroupSchema,
  MentionSchema,
  MentionWriteSchema,
  MentionsResponseSchema,
  NoteDocumentSchema,
  NoteLinkSchema,
  NoteSummarySchema,
  RenameFileSchema,
  RenameNoteBodySchema,
  RenameNoteResultSchema,
  RenamePreviewSchema,
  RenameRefSchema,
  SaveNoteBodySchema,
  SearchHitSchema,
  SearchResponseSchema,
  TagCountSchema,
  TemplateSettingsSchema,
  TreeEntrySchema,
  UploadResponseSchema,
  VaultInfoSchema,
} from './schemas.js';

/**
 * True only when the two types accept exactly the same values *and* declare the same fields.
 * Mutual assignability alone is not enough: a type with an extra optional property is still
 * assignable both ways, so a schema that grew an `embeds?: number` its contract never got would
 * slip through. Comparing the key sets catches that.
 */
type Same<A, B> = [A] extends [B]
  ? [B] extends [A]
    ? [keyof A] extends [keyof B]
      ? [keyof B] extends [keyof A]
        ? true
        : false
      : false
    : false
  : false;

/** Fails to compile unless the pair matches; `Pair<X, Y>` is the whole assertion. */
type Pair<A, B> = Same<A, B> extends true ? true : never;

// The guard's own teeth: each of these must be false, and the annotation is what proves it —
// if `Same` said true, assigning `false` to it would not compile.
const missingOptional: Same<{ a: number }, { a: number; b?: number }> = false;
const requiredVersusOptional: Same<{ a: number }, { a?: number }> = false;
const widerType: Same<{ a: 'x' }, { a: string }> = false;
const matching: Same<{ a: number; b?: string }, { a: number; b?: string }> = true;

type Checked = [
  Pair<HealthResponse, Static<typeof HealthSchema>>,
  Pair<VaultInfo, Static<typeof VaultInfoSchema>>,
  Pair<Heading, Static<typeof HeadingSchema>>,
  Pair<NoteSummary, Static<typeof NoteSummarySchema>>,
  Pair<NoteDocument, Static<typeof NoteDocumentSchema>>,
  Pair<LinkKind, Static<typeof LinkKindSchema>>,
  Pair<NoteLink, Static<typeof NoteLinkSchema>>,
  Pair<Backlink, Static<typeof BacklinkSchema>>,
  Pair<SearchHit, Static<typeof SearchHitSchema>>,
  Pair<SearchResponse, Static<typeof SearchResponseSchema>>,
  Pair<TagCount, Static<typeof TagCountSchema>>,
  Pair<TreeEntry, Static<typeof TreeEntrySchema>>,
  Pair<TemplateSettings, Static<typeof TemplateSettingsSchema>>,
  Pair<GraphResponse, Static<typeof GraphSchema>>,
  Pair<CreateNoteRequest, Static<typeof CreateNoteBodySchema>>,
  Pair<SaveNoteRequest, Static<typeof SaveNoteBodySchema>>,
  Pair<AssetSummary, Static<typeof AssetSummarySchema>>,
  Pair<UploadResponse, Static<typeof UploadResponseSchema>>,
  Pair<ApiError, Static<typeof ErrorSchema>>,
  Pair<GlossaryEntry, Static<typeof GlossaryEntrySchema>>,
  Pair<Mention, Static<typeof MentionSchema>>,
  Pair<MentionGroup, Static<typeof MentionGroupSchema>>,
  Pair<MentionsResponse, Static<typeof MentionsResponseSchema>>,
  Pair<MentionWrite, Static<typeof MentionWriteSchema>>,
  Pair<LinkMentionsRequest, Static<typeof LinkMentionsBodySchema>>,
  Pair<LinkMentionsResult, Static<typeof LinkMentionsResultSchema>>,
  Pair<RenameRef, Static<typeof RenameRefSchema>>,
  Pair<RenameFile, Static<typeof RenameFileSchema>>,
  Pair<RenamePreview, Static<typeof RenamePreviewSchema>>,
  Pair<RenameNoteRequest, Static<typeof RenameNoteBodySchema>>,
  Pair<RenameNoteResult, Static<typeof RenameNoteResultSchema>>,
];

describe('API contracts', () => {
  it('describe the same shapes in TypeBox and in @rhizom/core', () => {
    // The work happens in the type above; this keeps the file an honest test file.
    const checked: Checked = [
      true,
      true,
      true,
      true,
      true,
      true,
      true,
      true,
      true,
      true,
      true,
      true,
      true,
      true,
      true,
      true,
      true,
      true,
      true,
      true,
      true,
      true,
      true,
      true,
      true,
      true,
      true,
      true,
      true,
      true,
      true,
    ];
    expect(checked).toHaveLength(31);
  });

  it('has teeth: the comparison rejects a shape that only looks the same', () => {
    // The work is in the type annotations above; assigning `false` to a type that said `true`
    // would not have compiled.
    expect([missingOptional, requiredVersusOptional, widerType]).toEqual([false, false, false]);
    expect(matching).toBe(true);
  });
});
