// Renaming a note, and moving it, which are the same operation: a path changes, and every link
// that leads there through that path has to change with it.
//
// Three rules shape everything below.
//
// The `links` table cannot decide what to rewrite. It records what a note's links say, not how
// they were resolved, so it can hand out candidates and nothing more; the decision is taken by
// resolving each reference again, once against the vault as it is and once against the vault as
// it would be. A link that reaches the note through an alias is left alone — the alias is a word
// the reader chose and has nothing to do with the file's name — and a short `[[Mira]]` that
// still finds the note at its new path is left alone too, which is why moving a note usually
// touches no other file at all.
//
// The dry run promises exact text at exact hashes, and goes stale the moment anyone else writes.
// So the write re-reads, re-parses and re-decides from scratch, and the hashes the client sends
// back are a gate rather than a cut point — the discipline the mentions batch already follows.
//
// And the order is: rewrite every file, then move the note, then index once. Only this order can
// be run again with the same arguments after a failure, because the note is still at `from`
// while the links pointing there are being repaired.
import {
  canLinkTo,
  createNoteIndex,
  ensureMarkdownExtension,
  findLinkRefs,
  isMarkdownFile,
  isSafeVaultPath,
  noteNameOf,
  resolveLinkTarget,
  rewriteLinkTargets,
  toVaultPath,
  writtenTargetFor,
  type LinkRef,
  type LinkTargetEdit,
  type NoteIndex,
  type RenameFile,
  type RenamePreview,
  type RenameRef,
} from '@rhizom/core';

import { VaultError } from '../vault/files.js';
import type { VaultContext } from '../vault/context.js';
import { errorBody } from './errors.js';
import {
  ErrorSchema,
  RenameNoteBodySchema,
  RenameNoteResultSchema,
  RenamePreviewSchema,
  RenameQuerySchema,
} from './schemas.js';
import type { TypedApp } from './typed-app.js';

/** References listed per file. Beyond this the preview counts them; the write still does them. */
const REF_LIMIT = 50;
/**
 * Files one rename may touch. A hub note with more backlinks than this in a large vault is real
 * but rare, and half a rename is worse than none: it is refused with the count rather than paged.
 */
const FILE_LIMIT = 1000;

export function registerRenameRoutes(app: TypedApp, context: () => VaultContext): void {
  app.get(
    '/api/rename',
    {
      schema: {
        tags: ['notes'],
        summary: 'What renaming or moving a note would change, before anything is written',
        querystring: RenameQuerySchema,
        response: { 200: RenamePreviewSchema, '4xx': ErrorSchema, 503: ErrorSchema },
      },
    },
    async (request, reply) => {
      const ctx = context();
      const from = toVaultPath(request.query.from);
      const to = ensureMarkdownExtension(toVaultPath(request.query.to));

      const note = ctx.index.getNote(from);
      const file = await readOrSkip(ctx, from);
      if (note === undefined || file === undefined) {
        return reply.code(404).send(errorBody(404, `No such note: ${from}`));
      }
      const empty = {
        from,
        to,
        fromHash: file.hash,
        files: [],
        nameClash: [],
        leftAlone: 0,
        title: note.title,
        titleFollowsFileName: note.title === noteNameOf(from),
      } satisfies RenamePreview;

      const before = indexOf(ctx);
      const refusal = refusalFor(from, to, before);
      if (refusal !== undefined) {
        return refused(empty, refusal);
      }

      const candidates = candidatesFor(ctx, from);
      if (candidates.length > FILE_LIMIT) {
        return refused(empty, 'tooMany');
      }

      const after = movedIndex(ctx, from, to);
      const files: RenameFile[] = [];
      let leftAlone = 0;
      for (const source of candidates) {
        const content = await readOrSkip(ctx, source);
        if (content === undefined) {
          continue;
        }
        const refs = decide(content.content, source, from, to, before, after).map(
          (entry) => entry.as,
        );
        leftAlone += refs.filter((ref) => !ref.rewrite).length;
        // A file where nothing would be written is not part of the review: listing it would bury
        // the files that do change under the ones that do not.
        if (!refs.some((ref) => ref.rewrite)) {
          continue;
        }
        files.push({
          source,
          sourceTitle: ctx.index.getNote(source)?.title ?? source,
          hash: content.hash,
          refs: refs.slice(0, REF_LIMIT),
          more: Math.max(0, refs.length - REF_LIMIT),
        });
      }

      return { ...empty, files, nameClash: nameClashesFor(from, to, after), leftAlone };
    },
  );

  app.post(
    '/api/rename',
    {
      schema: {
        tags: ['notes'],
        summary: 'Rewrites the links, then moves the note',
        body: RenameNoteBodySchema,
        response: { 200: RenameNoteResultSchema, '4xx': ErrorSchema, 503: ErrorSchema },
      },
    },
    async (request, reply) => {
      const ctx = context();
      const from = toVaultPath(request.body.from);
      const to = ensureMarkdownExtension(toVaultPath(request.body.to));

      if (ctx.index.getNote(from) === undefined) {
        return reply.code(404).send(errorBody(404, `No such note: ${from}`));
      }
      const before = indexOf(ctx);
      const refusal = refusalFor(from, to, before);
      if (refusal !== undefined) {
        return reply
          .code(refusal === 'exists' ? 409 : 400)
          .send(errorBody(refusal === 'exists' ? 409 : 400, refusalMessage(refusal, to)));
      }
      const after = movedIndex(ctx, from, to);

      const rewritten: { source: string; count: number }[] = [];
      const skipped: { source: string; reason: 'conflict' | 'notFound' | 'nothing' }[] = [];
      const written: string[] = [];

      try {
        for (const entry of request.body.files) {
          const content = await readOrSkip(ctx, entry.source);
          if (content === undefined) {
            skipped.push({ source: entry.source, reason: 'notFound' });
            continue;
          }
          if (content.hash !== entry.hash) {
            skipped.push({ source: entry.source, reason: 'conflict' });
            continue;
          }
          // Decided again from the file as it is now, not from what the preview was told: the
          // hashes only say the file has not moved on, they do not say what is in it.
          const edits = editsFor(decide(content.content, entry.source, from, to, before, after));
          if (edits.length === 0) {
            skipped.push({ source: entry.source, reason: 'nothing' });
            continue;
          }
          try {
            await ctx.vault.writeNote(
              entry.source,
              rewriteLinkTargets(content.content, edits),
              entry.hash,
            );
          } catch (error) {
            if (error instanceof VaultError && error.code === 'HASH_MISMATCH') {
              skipped.push({ source: entry.source, reason: 'conflict' });
              continue;
            }
            throw error;
          }
          rewritten.push({ source: entry.source, count: edits.length });
          written.push(entry.source);
        }

        // The note itself may have been one of the rewritten files — a note can link to itself
        // by name — in which case its hash on disk is no longer the one the client holds.
        const own = rewritten.some((entry) => entry.source === from)
          ? (await ctx.vault.readNote(from)).hash
          : request.body.hash;
        await ctx.vault.moveNote(from, to, own);
      } finally {
        // One index pass for the whole operation, and `to` before `from`: removing `from` re-
        // resolves every link that pointed at it, and by then the note is already known at its
        // new path, so an alias link lands there in one pass instead of dangling for one.
        await ctx.indexPaths([...written.filter((path) => path !== from), to, from]);
      }
      return { from, to, rewritten, skipped };
    },
  );
}

/** A preview that says why nothing will happen. */
function refused(empty: RenamePreview, refusal: Refusal): RenamePreview {
  return { ...empty, refusal };
}

/** The vault as it is: the same names and aliases the live resolver holds. */
function indexOf(ctx: VaultContext): NoteIndex {
  const index = createNoteIndex();
  for (const note of ctx.index.noteAliases()) {
    index.add(note.path, note.aliases);
  }
  return index;
}

/** The vault as it would be, with the one note at its new path. */
function movedIndex(ctx: VaultContext, from: string, to: string): NoteIndex {
  const index = createNoteIndex();
  for (const note of ctx.index.noteAliases()) {
    if (note.path !== from) {
      index.add(note.path, note.aliases);
    }
  }
  index.add(to, ctx.index.getNote(from)?.aliases ?? []);
  return index;
}

type Refusal = NonNullable<RenamePreview['refusal']>;

/**
 * Why this rename cannot happen, if it cannot. The name is checked against the wikilink syntax
 * as well as the file system: a target holding `#`, `|`, `[` or `]` cannot be written as a link
 * at all, so every link that was rewritten to it would lead somewhere else or nowhere. That
 * covers the note's own name and the folders above it, because a link may name either.
 */
function refusalFor(from: string, to: string, before: NoteIndex): Refusal | undefined {
  if (to === from) {
    return undefined;
  }
  if (!isSafeVaultPath(to) || !isMarkdownFile(to) || to.split('/').some((s) => s.startsWith('.'))) {
    return 'unsafePath';
  }
  if (!canLinkTo(to)) {
    return 'unwritableName';
  }
  // Case-folded, because the file system usually is: `Mira.md` and `mira.md` are one file on two
  // of the three platforms this runs on, and the one that is taken is the one that matters.
  const taken = before.findPath(to);
  if (taken !== undefined && taken !== from) {
    return 'exists';
  }
  return undefined;
}

function refusalMessage(refusal: Refusal, to: string): string {
  switch (refusal) {
    case 'exists':
      return `A note already exists at ${to}`;
    case 'unsafePath':
      return `Path is not allowed: ${to}`;
    case 'unwritableName':
      return `A name holding #, |, [ or ] cannot be linked to: ${to}`;
    default:
      return `Too many notes link here to rename in one go: ${to}`;
  }
}

/**
 * The notes that might have to change: the ones linking here, and the note itself, because a
 * move changes which namesake its own short links land on.
 */
function candidatesFor(ctx: VaultContext, from: string): string[] {
  const sources = ctx.index.linkSources(from);
  return sources.includes(from) ? sources : [...sources, from];
}

/** Notes that share a name with either end of the move, where a link may quietly retarget. */
function nameClashesFor(from: string, to: string, after: NoteIndex): string[] {
  const clashes = new Set<string>();
  for (const name of [noteNameOf(to), noteNameOf(from)]) {
    for (const path of after.findByName(name)) {
      if (path !== to) {
        clashes.add(path);
      }
    }
  }
  return [...clashes].sort();
}

/** One reference, and what the rename decided about it. */
interface Decided {
  ref: LinkRef;
  as: RenameRef;
}

/** What every reference in this file leads to now, and what it should say afterwards. */
function decide(
  content: string,
  source: string,
  from: string,
  to: string,
  before: NoteIndex,
  after: NoteIndex,
): Decided[] {
  // Where this file will be when the links are read again: the note being moved is its own
  // source for the links inside it, and folder proximity breaks ties between namesakes.
  const sourceAfter = source === from ? to : source;
  const decided: Decided[] = [];
  for (const ref of findLinkRefs(content)) {
    const leads = resolveLinkTarget(ref.target, source, before);
    if (!leads.resolved || leads.path !== from || leads.via === 'self') {
      continue;
    }
    const base = {
      line: ref.line,
      start: ref.start,
      end: ref.end,
      before: ref.written,
      after: ref.written,
      inHeading: ref.inHeading,
    };
    if (leads.via === 'alias') {
      decided.push({ ref, as: { ...base, rewrite: false, skipReason: 'alias' } });
      continue;
    }
    const still = resolveLinkTarget(ref.target, sourceAfter, after);
    if (still.resolved && still.path === to && still.ambiguous !== true) {
      decided.push({ ref, as: { ...base, rewrite: false, skipReason: 'stillResolves' } });
      continue;
    }
    decided.push({
      ref,
      as: { ...base, after: writtenTargetFor(ref, to, sourceAfter, after), rewrite: true },
    });
  }
  return decided;
}

/** The same decision, as the spans and replacements a rewrite takes. */
function editsFor(decided: readonly Decided[]): LinkTargetEdit[] {
  return decided
    .filter((entry) => entry.as.rewrite)
    .map((entry) => ({
      targetStart: entry.ref.targetStart,
      targetEnd: entry.ref.targetEnd,
      text: entry.as.after,
    }));
}

/** Reads a note, or nothing when it is gone: the index may be a moment behind the disk. */
async function readOrSkip(
  ctx: VaultContext,
  path: string,
): Promise<{ content: string; hash: string } | undefined> {
  try {
    return await ctx.vault.readNote(path);
  } catch (error) {
    if (error instanceof VaultError) {
      return undefined;
    }
    throw error;
  }
}
