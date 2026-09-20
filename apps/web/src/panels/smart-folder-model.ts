// Saved searches as folders, without the DOM.
//
// A saved search is a note, not a setting: one that declares `type: query` in its frontmatter and
// holds a ```rhizom-query block. That is why the sidebar can show it at all — the search is part
// of the vault, so it survives a different browser, a git clone and Rhizom itself.
//
// Everything here is a plain function, for the reason written down in mention-model.ts: the web
// unit tests run without a DOM, so what is worth asserting must not need one. The panel is left
// with the rendering and the fetching.
import { noteNameOf, queryBlocks, type QueryResult } from '@rhizom/core';

import type { QueryAnswer } from '../store/queries.js';

/**
 * The question that finds the saved searches themselves, asked through the same `/api/query` the
 * blocks inside them go to. The limit is the highest a query may name: a vault with more saved
 * searches than that has a sidebar no number here could rescue.
 */
export const SAVED_SEARCH_QUERY = 'type: query\nsort: title\nlimit: 500';

export interface SmartFolder {
  /** Vault path of the note that declares the search. */
  path: string;
  /** What the row is labelled with: the note's title, or its file name when it has none. */
  title: string;
}

/**
 * The folders a `type: query` answer describes, in the order the index returned them.
 *
 * An unanswered or a failed list is no folders, and the panel then shows nothing at all: the list
 * is a question about the whole vault, and when the vault cannot answer it the page around the
 * sidebar is already saying so more loudly than a line in here could.
 */
export function smartFolders(answer: QueryAnswer | undefined): SmartFolder[] {
  if (answer === undefined || answer.state === 'failed') {
    return [];
  }
  return answer.result.rows.map((row) => ({
    path: row.path,
    title: row.title === '' ? noteNameOf(row.path) : row.title,
  }));
}

/** What the note behind a folder says. Its text being undefined means it is still on its way. */
export type FolderNote =
  { state: 'loading' } | { state: 'noBlock' } | { state: 'block'; body: string; blocks: number };

/**
 * The block a folder runs: the first one in the note.
 *
 * A saved search may explain itself in several blocks — `Research/Open questions.md` in the
 * example vault has three — while a folder holds one list. So the first block fills it and the
 * count comes along, because a folder that quietly ignored two thirds of its note would be a
 * folder nobody could trust.
 */
export function folderNote(content: string | undefined): FolderNote {
  if (content === undefined) {
    return { state: 'loading' };
  }
  const blocks = queryBlocks(content);
  const body = blocks[0];
  return body === undefined
    ? { state: 'noBlock' }
    : { state: 'block', body, blocks: blocks.length };
}

/** What an open folder has to show. */
export type FolderContents =
  /** The note, or the answer to its block, is still on its way. */
  | { state: 'loading' }
  /** The note calls itself a saved search but holds no query block. */
  | { state: 'noBlock' }
  /** The index could not be asked at all — a dead server, a vault that went away. */
  | { state: 'failed'; message: string }
  /** The answer, plus how many blocks the note holds, so the row can name the one it ran. */
  | { state: 'ready'; result: QueryResult; blocks: number };

/** An open folder whose block has been answered — what the list of notes is drawn from. */
export type AnsweredFolder = Extract<FolderContents, { state: 'ready' }>;

/**
 * What an open folder shows: the note's state, answered by whatever the query store is holding.
 * An answer that is not there yet is not a failure — the store drops every answer when the index
 * reports a change, and the panel asks again.
 */
export function folderContents(
  note: FolderNote,
  answers: Readonly<Record<string, QueryAnswer>>,
): FolderContents {
  if (note.state !== 'block') {
    // `loading` and `noBlock` say the same thing in both unions.
    return note;
  }
  const answer = answers[note.body];
  if (answer === undefined) {
    return { state: 'loading' };
  }
  return answer.state === 'failed'
    ? { state: 'failed', message: answer.message }
    : { state: 'ready', result: answer.result, blocks: note.blocks };
}

/**
 * The body a folder still needs an answer to, or null when it needs none: it is closed, its note
 * has no block, or the answer is already here.
 *
 * It is null and then a body again whenever the index reports a change, which is what lets one
 * effect watching it do both the first asking and every later one.
 */
export function pendingBody(
  note: FolderNote,
  answers: Readonly<Record<string, QueryAnswer>>,
): string | null {
  if (note.state !== 'block' || answers[note.body] !== undefined) {
    return null;
  }
  return note.body;
}

/**
 * How many notes the row says the folder holds, or null while there is no number to give — it is
 * closed, still asking, or could not ask.
 *
 * The length of the list under it, not `result.total`: a block with a `limit` finds more than it
 * shows, and a row counting what the reader cannot see is a row that lies. What was left out is
 * said underneath instead, in the words the rendered block already uses for it.
 */
export function folderCount(contents: FolderContents | null): number | null {
  return contents?.state === 'ready' ? contents.result.rows.length : null;
}
