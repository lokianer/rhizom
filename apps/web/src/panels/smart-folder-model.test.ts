import type { QueryResult, QueryRow } from '@rhizom/core';
import { describe, expect, it } from 'vitest';

import type { QueryAnswer } from '../store/queries.js';
import {
  folderContents,
  folderCount,
  folderNote,
  pendingBody,
  SAVED_SEARCH_QUERY,
  smartFolders,
} from './smart-folder-model.js';

function row(path: string, title: string): QueryRow {
  return {
    path,
    title,
    folder: path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '',
    tags: [],
    modifiedAt: '2026-01-02T00:00:00.000Z',
    size: 120,
    fields: {},
  };
}

function result(rows: QueryRow[], overrides: Partial<QueryResult> = {}): QueryResult {
  return { rows, total: rows.length, view: 'list', columns: [], problems: [], ...overrides };
}

function ready(value: QueryResult): QueryAnswer {
  return { state: 'ready', result: value };
}

const SEARCHES = ready(
  result([row('Research/Open questions.md', 'Open questions'), row('Inbox.md', 'Inbox')]),
);

describe('SAVED_SEARCH_QUERY', () => {
  it('asks for the notes that declare themselves a saved search', () => {
    expect(SAVED_SEARCH_QUERY).toContain('type: query');
  });
});

describe('smartFolders', () => {
  it('turns the answer into one folder per note, in the order the index gave them', () => {
    expect(smartFolders(SEARCHES)).toEqual([
      { path: 'Research/Open questions.md', title: 'Open questions' },
      { path: 'Inbox.md', title: 'Inbox' },
    ]);
  });

  it('labels a note that has no title with its file name', () => {
    expect(smartFolders(ready(result([row('Research/Open questions.md', '')])))).toEqual([
      { path: 'Research/Open questions.md', title: 'Open questions' },
    ]);
  });

  it('shows nothing while the question is unanswered, and nothing when it fails', () => {
    expect(smartFolders(undefined)).toEqual([]);
    expect(smartFolders({ state: 'failed', message: 'No vault is configured.' })).toEqual([]);
  });
});

describe('folderNote', () => {
  it('waits while the note is still on its way', () => {
    expect(folderNote(undefined)).toEqual({ state: 'loading' });
  });

  it('runs the first block and says how many the note holds', () => {
    const content = [
      '---',
      'type: query',
      '---',
      '',
      '```rhizom-query',
      'from: Research',
      '```',
      '',
      'And a second one, which the folder does not run:',
      '',
      '```rhizom-query',
      'from: Campaign/NPCs',
      '```',
      '',
    ].join('\n');

    expect(folderNote(content)).toEqual({
      state: 'block',
      body: 'from: Research',
      blocks: 2,
    });
  });

  it('reports a note that calls itself a saved search without asking anything', () => {
    expect(folderNote('---\ntype: query\n---\n\n# Someday\n')).toEqual({ state: 'noBlock' });
  });
});

describe('folderContents', () => {
  const note = folderNote('```rhizom-query\nfrom: Research\n```\n');
  const answer = result([row('Research/Ley lines.md', 'Ley lines')]);

  it('waits for the answer to the block it chose', () => {
    expect(folderContents(note, {})).toEqual({ state: 'loading' });
  });

  it('hands on the answer together with how many blocks the note holds', () => {
    expect(folderContents(note, { 'from: Research': ready(answer) })).toEqual({
      state: 'ready',
      result: answer,
      blocks: 1,
    });
  });

  it('shows the reason when the index could not be asked', () => {
    const failed: QueryAnswer = { state: 'failed', message: 'No vault is configured.' };
    expect(folderContents(note, { 'from: Research': failed })).toEqual({
      state: 'failed',
      message: 'No vault is configured.',
    });
  });

  it('carries a note that asks nothing straight through', () => {
    expect(folderContents({ state: 'noBlock' }, {})).toEqual({ state: 'noBlock' });
    expect(folderContents({ state: 'loading' }, {})).toEqual({ state: 'loading' });
  });
});

describe('pendingBody', () => {
  const note = folderNote('```rhizom-query\nfrom: Research\n```\n');

  it('names the body while nobody has answered it', () => {
    expect(pendingBody(note, {})).toBe('from: Research');
  });

  it('asks for nothing once the answer is here', () => {
    expect(pendingBody(note, { 'from: Research': ready(result([])) })).toBeNull();
  });

  it('asks again after the index change that dropped the answer', () => {
    const answered = { 'from: Research': ready(result([])) };
    expect(pendingBody(note, answered)).toBeNull();
    // What `invalidate` leaves behind: every answer gone, the question unchanged.
    expect(pendingBody(note, {})).toBe('from: Research');
  });

  it('asks for nothing when there is no block and nothing to fetch yet', () => {
    expect(pendingBody({ state: 'noBlock' }, {})).toBeNull();
    expect(pendingBody({ state: 'loading' }, {})).toBeNull();
  });
});

describe('folderCount', () => {
  it('has no number for a folder nobody has opened', () => {
    expect(folderCount(null)).toBeNull();
  });

  it('counts the notes it lists, not the ones a limit left out', () => {
    const cut = result([row('Research/A.md', 'A'), row('Research/B.md', 'B')], { total: 17 });
    expect(folderCount({ state: 'ready', result: cut, blocks: 1 })).toBe(2);
  });

  it('counts nothing while it is still asking, or after it could not', () => {
    expect(folderCount({ state: 'loading' })).toBeNull();
    expect(folderCount({ state: 'failed', message: 'gone' })).toBeNull();
    expect(folderCount({ state: 'noBlock' })).toBeNull();
  });
});
