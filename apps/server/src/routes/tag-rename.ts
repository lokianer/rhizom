// Renaming a tag across the vault, under the rules renaming a note already works by: a dry run
// that says which files would change and how, a hash per file, and a file that moved on reported
// rather than overwritten.
//
// A tag is a hierarchy, so renaming `campaign` renames `campaign/silverstadt/npcs` with it and
// leaves `campaigns` alone. It is also written in two places, and the two need different tools.
// In the prose it is a word in a sentence, and `findTagRefs` hands back the exact span. In the
// frontmatter it is a YAML value, and `setFrontmatter` changes it without disturbing the key's
// spelling, the comments or the order around it — which is why this never edits the block itself.
//
// Unlike a note, a tag has no identity beyond its name: renaming one onto a tag that already
// exists merges them, and there is no way back from that. So the preview names the tags it would
// merge with instead of refusing, and the decision stays with whoever reads it.
import {
  findFrontmatter,
  findTagRefs,
  frontmatterFields,
  isTagName,
  normaliseTag,
  renamedTag,
  rewriteTags,
  setFrontmatter,
  type TagEdit,
} from '@rhizom/core';

import { VaultError } from '../vault/files.js';
import type { VaultContext } from '../vault/context.js';
import { errorBody } from './errors.js';
import {
  ErrorSchema,
  TagRenameBodySchema,
  TagRenamePreviewSchema,
  TagRenameQuerySchema,
  TagRenameResultSchema,
} from './schemas.js';
import type { TypedApp } from './typed-app.js';

/** Occurrences listed per file. Beyond this the preview counts them; the write still does them. */
const REF_LIMIT = 50;
/** Files one rename may touch. A tag on more notes than this is refused rather than half done. */
const FILE_LIMIT = 1000;

/** The frontmatter keys a tag can be written under. Obsidian accepts both. */
const TAG_KEYS = ['tags', 'tag'] as const;

type Refusal = 'notFound' | 'unwritableName' | 'same' | 'tooMany';

interface Change {
  line: number;
  before: string;
  after: string;
  where: 'inline' | 'frontmatter';
  context: string;
}

export function registerTagRenameRoutes(app: TypedApp, context: () => VaultContext): void {
  app.get(
    '/api/tags/rename',
    {
      schema: {
        tags: ['tags'],
        summary: 'What renaming a tag would change, before anything is written',
        querystring: TagRenameQuerySchema,
        response: { 200: TagRenamePreviewSchema, '4xx': ErrorSchema, 503: ErrorSchema },
      },
    },
    async (request) => {
      const ctx = context();
      const from = normaliseTag(request.query.from) ?? '';
      const to = request.query.to.trim();
      const empty = { from, to, files: [], merges: [] };

      const refusal = refusalFor(ctx, from, to);
      if (refusal !== undefined) {
        return { ...empty, refusal };
      }
      const candidates = ctx.index.notesUnderTag(from);
      if (candidates.length > FILE_LIMIT) {
        return { ...empty, refusal: 'tooMany' as const };
      }

      const files = [];
      for (const source of candidates) {
        const file = await readOrSkip(ctx, source);
        if (file === undefined) {
          continue;
        }
        const changes = changesIn(file.content, from, to);
        if (changes.length === 0) {
          continue;
        }
        files.push({
          source,
          sourceTitle: ctx.index.getNote(source)?.title ?? source,
          hash: file.hash,
          refs: changes.slice(0, REF_LIMIT),
          more: Math.max(0, changes.length - REF_LIMIT),
        });
      }
      return { ...empty, files, merges: mergesFor(ctx, from, to) };
    },
  );

  app.post(
    '/api/tags/rename',
    {
      schema: {
        tags: ['tags'],
        summary: 'Rewrites the tag in every file that was listed',
        body: TagRenameBodySchema,
        response: { 200: TagRenameResultSchema, '4xx': ErrorSchema, 503: ErrorSchema },
      },
    },
    async (request, reply) => {
      const ctx = context();
      const from = normaliseTag(request.body.from) ?? '';
      const to = request.body.to.trim();

      const refusal = refusalFor(ctx, from, to);
      if (refusal !== undefined) {
        const code = refusal === 'notFound' ? 404 : 400;
        return reply.code(code).send(errorBody(code, refusalMessage(refusal, request.body)));
      }

      const rewritten: { source: string; count: number }[] = [];
      const skipped: { source: string; reason: 'conflict' | 'notFound' | 'nothing' }[] = [];
      const written: string[] = [];

      try {
        for (const entry of request.body.files) {
          const file = await readOrSkip(ctx, entry.source);
          if (file === undefined) {
            skipped.push({ source: entry.source, reason: 'notFound' });
            continue;
          }
          if (file.hash !== entry.hash) {
            skipped.push({ source: entry.source, reason: 'conflict' });
            continue;
          }
          // Decided again from the file as it stands, not from what the preview was told: the
          // hash only says the file has not moved on, it does not say what is in it.
          const next = rename(file.content, from, to);
          if (next.count === 0) {
            skipped.push({ source: entry.source, reason: 'nothing' });
            continue;
          }
          try {
            await ctx.vault.writeNote(entry.source, next.content, entry.hash);
          } catch (error) {
            if (error instanceof VaultError && error.code === 'HASH_MISMATCH') {
              skipped.push({ source: entry.source, reason: 'conflict' });
              continue;
            }
            throw error;
          }
          rewritten.push({ source: entry.source, count: next.count });
          written.push(entry.source);
        }
      } finally {
        await ctx.indexPaths(written);
      }
      return { from, to, rewritten, skipped };
    },
  );
}

/** Why the rename cannot happen at all, or nothing when it can. */
function refusalFor(ctx: VaultContext, from: string, to: string): Refusal | undefined {
  if (from === '' || !ctx.index.tags().some((entry) => entry.tag === from)) {
    return 'notFound';
  }
  if (!isTagName(to)) {
    return 'unwritableName';
  }
  return normaliseTag(to) === from ? 'same' : undefined;
}

function refusalMessage(refusal: Refusal, asked: { from: string; to: string }): string {
  switch (refusal) {
    case 'notFound':
      return `No note carries the tag ${asked.from}`;
    case 'unwritableName':
      return `${asked.to} cannot be written as a tag`;
    case 'same':
      return 'The new name is the old one';
    case 'tooMany':
      return 'Too many files carry this tag to rename it in one go';
  }
}

/** Tags that already exist under the new name, so renaming makes the two one tag. */
function mergesFor(ctx: VaultContext, from: string, to: string): string[] {
  const tags = ctx.index.tags();
  const taken = new Set(tags.map((entry) => entry.tag));
  const merges: string[] = [];
  for (const entry of tags) {
    const renamed = renamedTag(entry.tag, from, to);
    const target = renamed === undefined ? undefined : normaliseTag(renamed);
    if (target !== undefined && target !== entry.tag && taken.has(target)) {
      merges.push(target);
    }
  }
  return [...new Set(merges)].sort();
}

/** Every occurrence a rename would change, for the preview. */
function changesIn(markdown: string, from: string, to: string): Change[] {
  const changes: Change[] = [];
  for (const entry of frontmatterChanges(markdown, from, to)) {
    changes.push(entry);
  }
  for (const ref of findTagRefs(markdown)) {
    const after = renamedTag(ref.written, from, to);
    if (after !== undefined) {
      changes.push({
        line: ref.line,
        before: ref.written,
        after,
        where: 'inline',
        context: ref.context,
      });
    }
  }
  return changes.sort((a, b) => a.line - b.line);
}

/**
 * The note with the tag renamed everywhere it stands, or nothing when it stands nowhere. The
 * frontmatter goes first: it is rewritten by key, so it must not run on offsets the inline pass
 * has already moved.
 */
function rename(markdown: string, from: string, to: string): { content: string; count: number } {
  const frontmatter = frontmatterChanges(markdown, from, to);
  const withKeys =
    frontmatter.length === 0 ? markdown : setFrontmatter(markdown, newValues(markdown, from, to));

  const edits: TagEdit[] = [];
  for (const ref of findTagRefs(withKeys)) {
    const after = renamedTag(ref.written, from, to);
    if (after !== undefined) {
      edits.push({ start: ref.start, end: ref.end, text: after });
    }
  }
  return { content: rewriteTags(withKeys, edits), count: frontmatter.length + edits.length };
}

/** What the tag keys should hold afterwards, for `setFrontmatter`; only the keys that change. */
function newValues(markdown: string, from: string, to: string): Record<string, unknown> {
  const block = findFrontmatter(markdown);
  const values: Record<string, unknown> = {};
  if (block === undefined) {
    return values;
  }
  for (const key of TAG_KEYS) {
    const value = block.values[key];
    const next = renamedValue(value, from, to);
    if (next !== undefined) {
      values[key] = next;
    }
  }
  return values;
}

/**
 * One tag key's value with the renamed entries replaced, or nothing when none of them is.
 *
 * A list keeps its entries and their order; a string keeps its separators, because Obsidian
 * writes `tags: a, b` as often as a list and rewriting it as one would be a change nobody asked
 * for. Anything else — a mapping, a number — is left as it is.
 */
function renamedValue(value: unknown, from: string, to: string): unknown {
  if (typeof value === 'string') {
    let changed = false;
    const next = value.replace(/[^,\s]+/g, (token) => {
      const renamed = renamedTag(token, from, to);
      changed ||= renamed !== undefined;
      return renamed ?? token;
    });
    return changed ? next : undefined;
  }
  if (!Array.isArray(value)) {
    return undefined;
  }
  // `Array.isArray` narrows to `any[]`, and a YAML value is anything at all.
  const entries: unknown[] = value;
  let changed = false;
  const next = entries.map((entry) => {
    if (typeof entry !== 'string') {
      return entry;
    }
    const renamed = renamedTag(entry, from, to);
    changed ||= renamed !== undefined;
    return renamed ?? entry;
  });
  return changed ? next : undefined;
}

/** One entry per tag key whose value changes, with the line the key stands on in the file. */
function frontmatterChanges(markdown: string, from: string, to: string): Change[] {
  const block = findFrontmatter(markdown);
  if (block === undefined) {
    return [];
  }
  const lines = new Map(frontmatterFields(block).map((field) => [field.key, field.line]));
  const changes: Change[] = [];
  for (const key of TAG_KEYS) {
    const value = block.values[key];
    const next = renamedValue(value, from, to);
    if (next === undefined) {
      continue;
    }
    const before = display(value);
    changes.push({
      // A field's line is 1-based inside the block, and a block only counts when it opens on the
      // first line of the file, so the line in the file is one more.
      line: (lines.get(key) ?? 0) + 1,
      before,
      after: display(next),
      where: 'frontmatter',
      context: `${key}: ${before}`,
    });
  }
  return changes;
}

function display(value: unknown): string {
  return Array.isArray(value) ? value.map((entry) => String(entry)).join(', ') : String(value);
}

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
