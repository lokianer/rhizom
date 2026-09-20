import { history, undo } from '@codemirror/commands';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { EditorSelection, EditorState } from '@codemirror/state';
import { createNoteIndex, createTermMatcher, type NoteSummary } from '@rhizom/core';
import { describe, expect, it } from 'vitest';

import {
  blockAt,
  blockIdFrom,
  blockIdOn,
  blockLinkKeymap,
  copyBlockLink,
  markerPlacement,
  planBlockLink,
  takenBlockIds,
  type BlockLinkResult,
} from './block-link.js';
import { editorContext, type EditorContextValue, type EditorHandlers } from './context.js';
import { wikilinkExtension } from './wikilink.js';

/**
 * A document parsed the way the editor parses one. No DOM anywhere: the Markdown parser is a
 * plain function of the text, and every command here is a StateCommand.
 */
function stateOf(doc: string, at: number, options: { readOnly?: boolean } = {}): EditorState {
  return EditorState.create({
    doc,
    selection: EditorSelection.single(at),
    extensions: [
      history(),
      markdown({ base: markdownLanguage, extensions: [wikilinkExtension] }),
      EditorState.readOnly.of(options.readOnly ?? false),
    ],
  });
}

/** The position just after the first occurrence of `text`, which is where a cursor is put. */
function after(doc: string, text: string): number {
  return doc.indexOf(text) + text.length;
}

/** A state that also carries the editor context, which is what the command reads. */
function withContext(
  doc: string,
  at: number,
  reported: BlockLinkResult[],
  options: { path?: string; notes?: string[]; readOnly?: boolean } = {},
): EditorState {
  const path = options.path ?? 'Daily/Scratch.md';
  const index = createNoteIndex();
  for (const note of options.notes ?? [path]) {
    index.add(note, []);
  }
  const handlers: { current: EditorHandlers } = {
    current: {
      onChange: () => undefined,
      onSave: () => undefined,
      onOpenLink: () => undefined,
      onUpload: () => Promise.resolve(''),
      onReadNote: () => Promise.resolve(''),
      onBlockLink: (result) => {
        reported.push(result);
      },
    },
  };
  const notes: NoteSummary[] = [];
  const context: EditorContextValue = {
    path,
    notes,
    index,
    terms: createTermMatcher([]),
    templates: { folder: null, dateFormat: 'YYYY-MM-DD', timeFormat: 'HH:mm' },
    commandLabels: {},
    locale: 'en',
    handlers,
  };
  return EditorState.create({
    doc,
    selection: EditorSelection.single(at),
    extensions: [
      history(),
      markdown({ base: markdownLanguage, extensions: [wikilinkExtension] }),
      EditorState.readOnly.of(options.readOnly ?? false),
      editorContext.of(context),
    ],
  });
}

/** Runs the command on a state that carries the context, and says what came of it. */
function run(
  doc: string,
  at: number,
  options: { path?: string; notes?: string[]; readOnly?: boolean } = {},
): { handled: boolean; doc: string; state: EditorState; reported: BlockLinkResult[] } {
  const reported: BlockLinkResult[] = [];
  const state = withContext(doc, at, reported, options);
  let next = state;
  const handled = copyBlockLink({
    state,
    dispatch: (transaction) => {
      next = transaction.state;
    },
  });
  return { handled, doc: next.doc.toString(), state: next, reported };
}

/** The plan for the cursor standing right after `text`, with a coin that never has to be flipped. */
function plan(doc: string, text: string, coin = () => 0) {
  return planBlockLink(stateOf(doc, after(doc, text)), after(doc, text), coin);
}

describe('blockAt', () => {
  it('finds the paragraph the cursor stands in, from either end of it', () => {
    const doc = 'First paragraph.\n\nSecond paragraph.';
    const start = doc.indexOf('Second');
    for (const at of [start, start + 3, doc.length]) {
      const found = blockAt(stateOf(doc, at), at);
      expect(found.ok).toBe(true);
      expect(found.ok ? doc.slice(found.block.from, found.block.to) : '').toBe('Second paragraph.');
    }
  });

  it('refuses a heading, which is addressed by its text and has no anchor to spare', () => {
    const doc = '## Loot\n\nA brass astrolabe.';
    const found = blockAt(stateOf(doc, after(doc, '## Loot')), after(doc, '## Loot'));
    expect(found).toEqual({ ok: false, reason: 'heading' });
  });

  it('refuses a heading written with an underline as well', () => {
    const doc = 'Loot\n====\n\nA brass astrolabe.';
    const found = blockAt(stateOf(doc, after(doc, 'Loo')), after(doc, 'Loo'));
    expect(found).toEqual({ ok: false, reason: 'heading' });
  });

  it('refuses a code fence, where the marker would be part of the program', () => {
    const doc = '```js\nconst answer = 42;\n```\n';
    const at = after(doc, 'const answer');
    expect(blockAt(stateOf(doc, at), at)).toEqual({ ok: false, reason: 'code' });
  });

  it('refuses a fence inside a list item too, rather than seeing the item', () => {
    const doc = '- a step\n\n  ```sh\n  npm run\n  ```\n';
    const at = after(doc, 'npm run');
    expect(blockAt(stateOf(doc, at), at)).toEqual({ ok: false, reason: 'code' });
  });

  it('allows a paragraph that merely holds a code span', () => {
    const doc = 'Run `npm run dev` first.';
    const at = after(doc, 'npm run');
    expect(blockAt(stateOf(doc, at), at).ok).toBe(true);
  });

  it('refuses a blank line, a thematic break and the frontmatter', () => {
    const between = 'One.\n\nTwo.';
    const blank = between.indexOf('\n\n') + 1;
    expect(blockAt(stateOf(between, blank), blank)).toEqual({ ok: false, reason: 'noBlock' });

    const rule = 'One.\n\n---\n\nTwo.';
    const onRule = rule.indexOf('---') + 1;
    expect(blockAt(stateOf(rule, onRule), onRule)).toEqual({ ok: false, reason: 'noBlock' });

    const front = '---\ntitle: Ledger\ntags: [a]\n---\n\nThe body.';
    const inKeys = after(front, 'title: Led');
    expect(blockAt(stateOf(front, inKeys), inKeys)).toEqual({ ok: false, reason: 'noBlock' });
  });
});

describe('blockIdOn', () => {
  it('reads the id a line already ends with, in every shape the core accepts', () => {
    expect(blockIdOn('The ledger was open. ^ledger')).toBe('ledger');
    expect(blockIdOn('The ledger was open.\t^ledger-2  ')).toBe('ledger-2');
    expect(blockIdOn('| Brass | Astrolabe ^loot |')).toBe('loot');
  });

  it('is not fooled by a caret that is not an address', () => {
    expect(blockIdOn('The ledger was open.')).toBeUndefined();
    expect(blockIdOn('2^8 is 256')).toBeUndefined();
    expect(blockIdOn('a ^ b')).toBeUndefined();
    expect(blockIdOn('E = mc^2^')).toBeUndefined();
  });
});

describe('takenBlockIds', () => {
  it('collects every id the note has handed out', () => {
    const doc = ['One. ^one', '', '- two ^two', '', '| a | b ^three |', '', 'plain.'].join('\n');
    expect([...takenBlockIds(doc)].sort()).toEqual(['one', 'three', 'two']);
  });

  it('would rather claim an id that is only text than hand out one that is taken', () => {
    // A caret ending a line inside a fence is no address, and counting it costs a suffix.
    // Missing a real one would quietly move a link somebody has already written.
    expect(takenBlockIds('```\nx = y ^ok\n```\n').has('ok')).toBe(true);
  });
});

describe('blockIdFrom', () => {
  it('says what the block says, in the first few words of its first line', () => {
    expect(blockIdFrom('The ledger was open on the desk.', new Set())).toBe('the-ledger-was-open');
    // The second line is not part of the name, any more than a section is named after its body.
    expect(blockIdFrom('| Item | Where |\n| --- | --- |\n| Brass | Archive |', new Set())).toBe(
      'item-where',
    );
  });

  it('drops what a block opens with and never says', () => {
    expect(blockIdFrom('- [x] pack the dice', new Set())).toBe('pack-the-dice');
    expect(blockIdFrom('1. pack the dice', new Set())).toBe('pack-the-dice');
    expect(blockIdFrom('> [!note] Ashes and ink', new Set())).toBe('note-ashes-and-ink');
  });

  it('folds an accent and keeps the letter, and never cuts a word in half', () => {
    expect(blockIdFrom('Über den Wörtern steht ein Wort', new Set())).toBe(
      'uber-den-wortern-steht',
    );
    expect(blockIdFrom('Die Straße nach Silberstadt', new Set())).toBe('die-strasse-nach');
    // Four words, and never more than twenty-four characters: the last word that does not fit
    // is left off rather than cut through.
    expect(blockIdFrom('Beschaffungsmaßnahme gilt', new Set()).length).toBeLessThanOrEqual(24);
    expect(blockIdFrom('Beschaffungsmaßnahme gilt', new Set())).toBe('beschaffungsmassnahme');
  });

  it('falls back to a random string when a block has no ASCII letters at all', () => {
    // Nothing here is measured with `.length`; the emoji and the Japanese simply leave no slug.
    const coin = () => 0;
    expect(blockIdFrom('🌱🌿🍂', new Set(), coin)).toBe('aaaaaa');
    expect(blockIdFrom('銀の街の記録', new Set(), coin)).toBe('aaaaaa');
    // And a block that holds an emoji beside words keeps the words.
    expect(blockIdFrom('🌱 Seedling notes', new Set())).toBe('seedling-notes');
  });

  it('counts from two when the note already has that id', () => {
    const taken = new Set(['pack-the-dice', 'pack-the-dice-2']);
    expect(blockIdFrom('pack the dice', taken)).toBe('pack-the-dice-3');
    expect(blockIdFrom('🌱', taken, () => 0)).toBe('aaaaaa');
  });
});

describe('markerPlacement', () => {
  it('puts the marker at the end of the line, behind a single space', () => {
    const line = 'The ledger was open.';
    const placement = markerPlacement(line, 'ledger', false);
    expect(placement).toEqual({ from: line.length, to: line.length, insert: ' ^ledger' });
  });

  it('takes trailing whitespace along rather than leaving two spaces behind', () => {
    const line = 'The ledger was open.  ';
    const placement = markerPlacement(line, 'ledger', false);
    expect(line.slice(0, placement.from) + placement.insert + line.slice(placement.to)).toBe(
      'The ledger was open. ^ledger',
    );
  });

  it('puts a table row’s id inside its last cell, not behind the closing pipe', () => {
    const line = '| Brass | Astrolabe |';
    const placement = markerPlacement(line, 'loot', true);
    expect(line.slice(0, placement.from) + placement.insert + line.slice(placement.to)).toBe(
      '| Brass | Astrolabe ^loot |',
    );
  });

  it('leaves a paragraph that merely ends in a pipe alone', () => {
    const line = 'a | b |';
    const placement = markerPlacement(line, 'ab', false);
    expect(line.slice(0, placement.from) + placement.insert + line.slice(placement.to)).toBe(
      'a | b | ^ab',
    );
  });
});

describe('planBlockLink', () => {
  it('writes nothing when the block already carries an id, and reuses it', () => {
    const doc = 'The ledger was open. ^ledger\n\nAnother paragraph.';
    const outcome = plan(doc, 'ledger was');
    expect(outcome).toEqual({ ok: true, plan: { id: 'ledger', change: undefined } });
  });

  it('marks a paragraph at the end of its last line', () => {
    const doc = 'The ledger was open\non the desk.\n\nAnother.';
    expect(applied(doc, plan(doc, 'ledger'))).toBe(
      'The ledger was open\non the desk. ^the-ledger-was-open\n\nAnother.',
    );
  });

  it('marks a list item, and only that item', () => {
    const doc = '- print the map\n- pack the dice\n';
    expect(applied(doc, plan(doc, 'print the'))).toBe(
      '- print the map ^print-the-map\n- pack the dice\n',
    );
  });

  it('marks a nested list item on its own line', () => {
    const doc = '- outer item\n  - inner item\n- another\n';
    expect(applied(doc, plan(doc, 'inner'))).toBe(
      '- outer item\n  - inner item ^inner-item\n- another\n',
    );
  });

  it('marks the last block of a note that ends without a newline', () => {
    const doc = '# Ledger\n\nThe last word';
    expect(applied(doc, plan(doc, 'last'))).toBe('# Ledger\n\nThe last word ^the-last-word');
  });

  it('marks a table inside its last cell, however many rows it has', () => {
    const doc = ['| Item | Where |', '| --- | --- |', '| Brass | Archive |', ''].join('\n');
    expect(applied(doc, plan(doc, 'Brass'))).toBe(
      ['| Item | Where |', '| --- | --- |', '| Brass | Archive ^item-where |', ''].join('\n'),
    );
  });

  it('refuses a heading and a code fence rather than writing anything', () => {
    expect(plan('## Loot\n\nA brass astrolabe.', '## Loo')).toEqual({
      ok: false,
      reason: 'heading',
    });
    expect(plan('```js\nconst answer = 42;\n```\n', 'const')).toEqual({
      ok: false,
      reason: 'code',
    });
  });

  it('gives the next number along when the note already holds that id', () => {
    const doc = 'pack the dice ^pack-the-dice\n\npack the dice\n';
    const outcome = plan(doc, 'dice\n\npack the dice');
    expect(outcome.ok && outcome.plan.id).toBe('pack-the-dice-2');
  });

  it('counts the document, not the characters, so any script survives it', () => {
    // An emoji and an umlaut before the marker: an implementation that measured the text it was
    // appending to would put the marker a place or two to the left of where it belongs.
    const doc = '🌱 Über den Wörtern steht ein Wort\n\nAnother.';
    expect(applied(doc, plan(doc, 'Wörtern'))).toBe(
      '🌱 Über den Wörtern steht ein Wort ^uber-den-wortern-steht\n\nAnother.',
    );
  });
});

/** The document after the planned change, for saying what the marker did to it. */
function applied(doc: string, outcome: ReturnType<typeof plan>): string {
  if (!outcome.ok) {
    throw new Error(`refused: ${outcome.reason}`);
  }
  const change = outcome.plan.change;
  if (change === undefined) {
    return doc;
  }
  return doc.slice(0, change.from) + change.insert + doc.slice(change.to);
}

describe('copyBlockLink', () => {
  it('writes the marker and hands back the link the vault writes to this note', () => {
    const doc = 'The ledger was open.\n';
    const result = run(doc, after(doc, 'ledger'));
    expect(result.handled).toBe(true);
    expect(result.doc).toBe('The ledger was open. ^the-ledger-was-open\n');
    expect(result.reported).toEqual([{ ok: true, link: '[[Scratch#^the-ledger-was-open]]' }]);
  });

  it('writes the path instead once another note answers to the same name', () => {
    const doc = 'The ledger was open.\n';
    const result = run(doc, after(doc, 'ledger'), {
      path: 'Daily/Scratch.md',
      notes: ['Daily/Scratch.md', 'Archive/Scratch.md'],
    });
    expect(result.reported).toEqual([{ ok: true, link: '[[Daily/Scratch#^the-ledger-was-open]]' }]);
  });

  it('is one step of the undo history, not a marker left behind', () => {
    const doc = 'The ledger was open.\n';
    const marked = run(doc, 5);
    expect(marked.doc).not.toBe(doc);
    let undone = marked.state;
    undo({
      state: marked.state,
      dispatch: (transaction) => {
        undone = transaction.state;
      },
    });
    expect(undone.doc.toString()).toBe(doc);
  });

  it('says why nothing happened instead of doing nothing at all', () => {
    const doc = '## Loot\n\nA brass astrolabe.';
    const result = run(doc, 5);
    expect(result.doc).toBe(doc);
    expect(result.reported).toEqual([{ ok: false, reason: 'heading' }]);
  });

  it('will not write an id into a read-only note, but will copy one it already has', () => {
    const fresh = run('The ledger was open.\n', 5, { readOnly: true });
    expect(fresh.handled).toBe(false);
    expect(fresh.reported).toEqual([]);

    const marked = run('The ledger was open. ^ledger\n', 5, { readOnly: true });
    expect(marked.doc).toBe('The ledger was open. ^ledger\n');
    expect(marked.reported).toEqual([{ ok: true, link: '[[Scratch#^ledger]]' }]);
  });
});

describe('blockLinkKeymap', () => {
  it('binds one key, and not one the editor already answers to', () => {
    expect(blockLinkKeymap.map((binding) => binding.key)).toEqual(['Mod-Shift-x']);
    expect(blockLinkKeymap.map((binding) => binding.run)).toEqual([copyBlockLink]);
  });
});
