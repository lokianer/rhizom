// "Copy a link to this block" — the half of block references that was missing. `packages/core`
// finds a block by the `^id` written at the end of it; until now nothing wrote one, so whoever
// wanted a link into the middle of a note had to invent an id and type it there by hand.
//
// The command finds the block the cursor stands in, gives it an id when it has none — in one
// transaction, so one undo takes it back — and hands the note page the `[[Note#^id]]` that leads
// there. Everything that decides is a plain function: which block the cursor is in, whether that
// block may carry an id at all, what the id says, and where in the block's last line it goes.
// Only the dispatching needs an editor, and only the page can speak to the reader.
//
// Nothing here measures text to find a place in the document. Every offset is an index into the
// one line the marker goes on, counted in the UTF-16 units CodeMirror counts the document in, and
// the only string cut to a length — the id — is ASCII by the time it is cut. A block holding
// `Über` or an emoji comes through it unharmed.
import { ensureSyntaxTree, syntaxTree } from '@codemirror/language';
import type { EditorState, StateCommand } from '@codemirror/state';
import type { KeyBinding } from '@codemirror/view';
import type { SyntaxNode, Tree } from '@lezer/common';
import { blockIdOnLine, linkTextFor } from '@rhizom/core';

import { editorContext, frontmatterEnd } from './context.js';

/** Why a block cannot be given an id. Each one is a sentence the note page knows how to say. */
export type BlockLinkRefusal = 'heading' | 'code' | 'noBlock';

/** What the command tells the page it did, which is all the page needs to say it. */
export type BlockLinkResult =
  | { readonly ok: true; readonly link: string }
  | { readonly ok: false; readonly reason: BlockLinkRefusal };

/**
 * The blocks an id may be written on. An allow-list rather than a list of exceptions: a marker
 * appended to the wrong kind of line does not fail, it silently turns that line into something
 * else — ` ^abc` after a thematic break is no longer a thematic break — and a node type nobody
 * thought about should therefore refuse rather than guess.
 *
 * A table is here and its rows are not: an id anywhere in a table addresses the whole table, the
 * way `packages/core` reads it, because a row cut out of a table is a line with pipes in it.
 */
const CAN_CARRY_AN_ID: ReadonlySet<string> = new Set([
  'Paragraph',
  'ListItem',
  'Table',
  'Blockquote',
]);

/** A fence, or four spaces of indent. The marker would be part of the program. */
const IS_CODE: ReadonlySet<string> = new Set(['FencedCode', 'CodeBlock']);

/**
 * A heading, of either spelling. Refused on purpose, and this is the one refusal that is a
 * judgement rather than a necessity: a marker on a heading line does parse, and `![[Note#^abc]]`
 * would show the heading. But an element has one id to give and a heading's is already its slug,
 * so the anchor `[[Note#^abc]]` aims at is never written — the link would open the note and land
 * nowhere. A heading is addressed by its text, which is what `[[Note#Heading]]` is for.
 */
const IS_HEADING = /^(?:ATX|Setext)Heading[1-6]$/;

/** At most four words and twenty-four characters: about a short heading, and no longer. */
const MOST_WORDS = 4;
const MOST_CHARACTERS = 24;

/** The fallback id: six characters out of thirty-six, which is Obsidian's shape as well. */
const RANDOM_LENGTH = 6;
const ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';

/**
 * How long one press may spend parsing. A long note is parsed in slices as it is scrolled and
 * `syntaxTree` hands back however much of it is ready; a deliberate keystroke is worth a few
 * milliseconds rather than an answer of "no block here" about a paragraph plainly on the screen.
 */
const PARSE_BUDGET_MS = 100;

function treeFor(state: EditorState, upto: number): Tree {
  return ensureSyntaxTree(state, upto, PARSE_BUDGET_MS) ?? syntaxTree(state);
}

/** Where a block begins and ends in the document. */
export interface BlockBounds {
  readonly from: number;
  readonly to: number;
}

export type BlockAt =
  | { readonly ok: true; readonly block: BlockBounds }
  | { readonly ok: false; readonly reason: BlockLinkRefusal };

/**
 * The block the cursor stands in — the innermost one, because that is the thing somebody looking
 * at the screen means by "this block".
 *
 * `packages/core` reads a marker the other way round, as the outermost block ending on that line,
 * so an id written at the end of a quoted paragraph addresses the whole quotation. The two agree
 * on the line, which is all that has to be agreed on: the link lands either way, and what it
 * brings along is the core's decision to make.
 */
export function blockAt(
  state: EditorState,
  pos: number,
  tree: Tree = treeFor(state, pos),
): BlockAt {
  // The Markdown parser has no frontmatter node — the keys below a leading `---` are an ordinary
  // paragraph to it — so the block has to be kept out by hand, exactly as the slash menu does.
  if (pos <= frontmatterEnd(state)) {
    return { ok: false, reason: 'noBlock' };
  }
  // Leftwards first: standing at the end of a paragraph is standing in it. Rightwards is for the
  // other boundary, the very first position of a block, where there is nothing to the left of the
  // cursor but the blank line above.
  return (
    blockAround(tree.resolveInner(pos, -1)) ??
    blockAround(tree.resolveInner(pos, 1)) ?? { ok: false, reason: 'noBlock' }
  );
}

/** Undefined when the walk reaches the document without passing anything block-shaped. */
function blockAround(node: SyntaxNode): BlockAt | undefined {
  for (let at: SyntaxNode | null = node; at !== null; at = at.parent) {
    if (IS_CODE.has(at.name)) {
      return { ok: false, reason: 'code' };
    }
    if (IS_HEADING.test(at.name)) {
      return { ok: false, reason: 'heading' };
    }
    if (CAN_CARRY_AN_ID.has(at.name)) {
      return { ok: true, block: { from: at.from, to: at.to } };
    }
  }
  return undefined;
}

/**
 * Every id the note has already handed out.
 *
 * Read with a regular expression rather than with the parser, which means it also collects a
 * `^word` that ends a line inside a code fence and is no address at all. That error is the safe
 * one: an id wrongly thought taken costs a suffix, an id wrongly thought free would quietly move
 * a link somebody has already written.
 */
export function takenBlockIds(doc: string): Set<string> {
  const taken = new Set<string>();
  for (const line of doc.split('\n')) {
    const id = blockIdOnLine(line);
    if (id !== undefined) {
      taken.add(id);
    }
  }
  return taken;
}

/**
 * The id a block gets: the first few words of its first line, slugged.
 *
 * Obsidian generates a short random string, and a random string never lies about a block that has
 * since been rewritten. It also says nothing. This id is read twice by a person — once at the end
 * of the line it marks, once inside the `[[Note#^…]]` in another note — and `^the-ledger-was-open`
 * tells them both times what they are looking at. It is the same bargain the vault already makes
 * for headings, whose anchors are their text, and it keeps a file readable without Rhizom, which
 * is the point of writing plain Markdown at all. An id that no longer describes its block is the
 * price, and it is the right one: an address must never change once something points at it.
 *
 * ASCII only, because that is the grammar the core accepts. Accents are folded (`Über` becomes
 * `uber`), and a block with no ASCII letters in it at all — Japanese, an emoji, a formula — falls
 * back to the random string, because a link that reads as nothing still has to work.
 */
export function blockIdFrom(
  text: string,
  taken: ReadonlySet<string>,
  coin: () => number = Math.random,
): string {
  const words = slugOfBlock(text);
  return firstFree(words === '' ? randomId(coin) : words, taken);
}

function slugOfBlock(text: string): string {
  const body = (text.split('\n', 1)[0] ?? '')
    // The first line only. It is what the block is called, the way a heading names its section:
    // a table is its header row and not its contents, and a hard-wrapped paragraph is the words
    // that open it. It also makes the id something the eye can predict before the key is pressed.
    //
    // What a block opens with and never says goes first: quote marks, the pipe of a table row, a
    // list bullet, the box of a task. Every other mark falls out with the punctuation below;
    // these would leave a word behind — `- [x] pack the dice` is not `x-pack-the-dice`.
    .replace(/^[\s>|]+/u, '')
    .replace(/^(?:[-*+]|\d{1,9}[.)])\s+/u, '')
    .replace(/^\[[ xX]\]\s+/u, '');
  const ascii = body
    // NFKD takes `ä` apart into a letter and a mark; `ß` it leaves whole, and a German vault
    // meets that letter every other paragraph.
    .replace(/ß/gu, 'ss')
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase();
  const words = ascii.split(/[^a-z0-9]+/u).filter((word) => word !== '');
  return shorten(words.slice(0, MOST_WORDS).join('-'));
}

/** Cut at a word, never in the middle of one — unless the first word is longer than the whole. */
function shorten(slug: string): string {
  // The string is ASCII by now, which is the one reason a length may be counted on it at all.
  if (slug.length <= MOST_CHARACTERS) {
    return slug;
  }
  const cut = slug.slice(0, MOST_CHARACTERS);
  const boundary = cut.lastIndexOf('-');
  return boundary > 0 ? cut.slice(0, boundary) : cut;
}

function randomId(coin: () => number): string {
  let id = '';
  for (let at = 0; at < RANDOM_LENGTH; at += 1) {
    const pick = Math.min(Math.floor(coin() * ALPHABET.length), ALPHABET.length - 1);
    id += ALPHABET.charAt(pick);
  }
  return id;
}

/**
 * The id itself, or the next number along. Counting from two, because this suffix is not a
 * slugger's counter but a word a person reads: `^pack-the-dice-2` is the second one.
 */
function firstFree(base: string, taken: ReadonlySet<string>): string {
  let id = base;
  let next = 1;
  while (taken.has(id)) {
    next += 1;
    id = `${base}-${String(next)}`;
  }
  return id;
}

/** Where the marker goes in a line: `from` and `to` are offsets into that line, not the document. */
export interface MarkerPlacement {
  readonly from: number;
  readonly to: number;
  readonly insert: string;
}

/**
 * The marker at the end of the block's last line, with a single space before it.
 *
 * A table row is the exception, because its last line ends in a `|`: after the closing pipe the
 * id would be a cell of its own and the address would show in the table as a column nobody wrote,
 * so it goes inside the last cell instead. The core reads it there — a `|` behind the marker
 * counts as the end of the line for exactly this reason.
 *
 * Trailing spaces are taken along. They are invisible, and two of them at the end of a block are
 * a line break with nothing left to break.
 */
export function markerPlacement(line: string, id: string, inTableRow: boolean): MarkerPlacement {
  const marker = ` ^${id}`;
  const end = trimmedEnd(line);
  if (inTableRow && line.charAt(end - 1) === '|') {
    const pipe = end - 1;
    return { from: trimmedEnd(line.slice(0, pipe)), to: pipe, insert: `${marker} ` };
  }
  return { from: end, to: line.length, insert: marker };
}

/** Where the line's text stops, counted in the units the document is counted in. */
function trimmedEnd(text: string): number {
  return text.trimEnd().length;
}

/** The marker's edit, in document positions: the shape CodeMirror takes and a test can read. */
export interface MarkerChange {
  readonly from: number;
  readonly to: number;
  readonly insert: string;
}

/** What the command is about to do: the id, and the change that writes it if one is needed. */
export interface BlockLinkPlan {
  readonly id: string;
  /** Undefined when the block already carries an id, which is then the one that is used. */
  readonly change: MarkerChange | undefined;
}

export type BlockLinkOutcome =
  | { readonly ok: true; readonly plan: BlockLinkPlan }
  | { readonly ok: false; readonly reason: BlockLinkRefusal };

/**
 * Everything the command decides, decided without an editor: the whole of it can be driven in a
 * test that never opens a browser.
 */
export function planBlockLink(
  state: EditorState,
  pos: number,
  coin: () => number = Math.random,
): BlockLinkOutcome {
  const tree = treeFor(state, pos);
  const found = blockAt(state, pos, tree);
  if (!found.ok) {
    return found;
  }

  const line = state.doc.lineAt(found.block.to);
  // The reader's own rule, so the side that writes an id and the side that looks one up cannot
  // drift apart. `sliceBlock` would answer it too, and brings the whole remark pipeline with it.
  const existing = blockIdOnLine(line.text);
  if (existing !== undefined) {
    // An address that something may already point at. It is reused rather than replaced, and
    // pressing the key twice on the same block copies the same link both times.
    return { ok: true, plan: { id: existing, change: undefined } };
  }

  const id = blockIdFrom(
    state.sliceDoc(found.block.from, found.block.to),
    takenBlockIds(state.doc.toString()),
    coin,
  );
  const placement = markerPlacement(line.text, id, endsInTableRow(tree, line.to));
  return {
    ok: true,
    plan: {
      id,
      change: {
        from: line.from + placement.from,
        to: line.from + placement.to,
        insert: placement.insert,
      },
    },
  };
}

/** Whether the line the marker is going on is a row of a table. */
function endsInTableRow(tree: Tree, at: number): boolean {
  for (let node: SyntaxNode | null = tree.resolveInner(at, -1); node !== null; node = node.parent) {
    if (node.name === 'Table') {
      return true;
    }
  }
  return false;
}

/**
 * The command itself: one transaction for the marker, and one call to say what happened.
 *
 * `[[Note#^id]]` is written the way this vault writes a link to this note — the bare name where
 * that is unambiguous, the path where a namesake would steal it — because `linkTextFor` is the
 * one place that answers that question, for the mention batch and for a rename alike.
 *
 * The clipboard is the page's to write. Reaching it is a browser capability with a promise on the
 * end of it, and the page is the half of the app that can both do that and say that it happened.
 */
export const copyBlockLink: StateCommand = ({ state, dispatch }) => {
  const context = state.facet(editorContext);
  if (context === undefined) {
    return false;
  }
  const report = context.handlers.current.onBlockLink;
  const outcome = planBlockLink(state, state.selection.main.head);
  if (!outcome.ok) {
    report({ ok: false, reason: outcome.reason });
    return true;
  }

  const { id, change } = outcome.plan;
  if (change !== undefined) {
    // A read-only document cannot be given an id it does not have yet. One it already carries is
    // still worth copying, which is why this is asked here and not at the top.
    if (state.readOnly) {
      return false;
    }
    // `input.format` rather than `input.type`: the history joins adjacent typing into one event,
    // and marking a block is its own step, undone without the sentence around it going too.
    dispatch(state.update({ changes: change, scrollIntoView: true, userEvent: 'input.format' }));
  }
  report({
    ok: true,
    link: `[[${linkTextFor(context.path, context.path, context.index)}#^${id}]]`,
  });
  return true;
};

/**
 * Ctrl/Cmd+Shift+X. The letters that would say it better are all spoken for: Mod-K is a Markdown
 * link, Shift-Mod-K deletes a line, Mod-Shift-L selects every occurrence — and outside the editor
 * the browser has taken Ctrl+Shift+C, I and J for its developer tools, B for the bookmarks bar and
 * A for the add-ons. X is free in every keymap this editor loads and on every browser this app
 * runs in, and x marks the spot, which is the whole of what the command does.
 *
 * `preventDefault` even when nothing happens: Firefox reads the same chord in an editable area as
 * "switch text direction", and a note that silently turned right-to-left would be a bad afternoon.
 */
export const blockLinkKeymap: readonly KeyBinding[] = [
  { key: 'Mod-Shift-x', preventDefault: true, run: copyBlockLink },
];
