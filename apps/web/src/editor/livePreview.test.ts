import { EditorState } from '@codemirror/state';
import { createTermMatcher } from '@rhizom/core';
import { describe, expect, it } from 'vitest';

import { buildNoteIndex, editorContext, type EditorContextValue } from './context.js';
import { baseExtensions } from './extensions.js';
import { activeLines, imagePreview } from './livePreview.js';

const context: EditorContextValue = {
  path: 'Campaign/Session.md',
  notes: [],
  index: buildNoteIndex([]),
  terms: createTermMatcher([]),
  templates: { folder: 'Templates', dateFormat: 'YYYY-MM-DD', timeFormat: 'HH:mm' },
  commandLabels: {},
  locale: 'en',
  handlers: {
    current: {
      onChange: () => undefined,
      onSave: () => undefined,
      onOpenLink: () => undefined,
      onUpload: () => Promise.resolve(''),
      onReadNote: () => Promise.resolve(''),
      onBlockLink: () => undefined,
    },
  },
};

function createState(doc: string, anchor = 0, readOnly = false): EditorState {
  return EditorState.create({
    doc,
    selection: { anchor },
    extensions: [baseExtensions(), editorContext.of(context), EditorState.readOnly.of(readOnly)],
  });
}

function imageCount(state: EditorState): number {
  let count = 0;
  state.field(imagePreview).between(0, state.doc.length, () => {
    count += 1;
  });
  return count;
}

describe('activeLines', () => {
  it('covers every line the selection touches', () => {
    const state = EditorState.create({
      doc: 'one\ntwo\nthree',
      selection: { anchor: 1, head: 7 },
    });
    expect([...activeLines(state)]).toEqual([1, 2]);
  });

  it('is empty while the editor is read-only, so everything renders', () => {
    const state = EditorState.create({ doc: 'one', extensions: EditorState.readOnly.of(true) });
    expect(activeLines(state).size).toBe(0);
  });
});

describe('imagePreview', () => {
  it('renders an embedded image away from the cursor', () => {
    expect(imageCount(createState('# Notes\n\n![[assets/map.png]]\n'))).toBe(1);
  });

  it('renders a Markdown image as well', () => {
    expect(imageCount(createState('# Notes\n\n![the map](assets/map.png)\n'))).toBe(1);
  });

  it('shows the source again on the line the cursor is on', () => {
    const doc = '# Notes\n\n![[assets/map.png]]\n';
    expect(imageCount(createState(doc, doc.indexOf('![[') + 3))).toBe(0);
  });

  it('keeps rendering in read-only mode wherever the cursor is', () => {
    const doc = '![[assets/map.png]]';
    expect(imageCount(createState(doc, 3, true))).toBe(1);
  });

  it('leaves an embedded note alone', () => {
    expect(imageCount(createState('# Notes\n\n![[Campaign/Mira]]\n'))).toBe(0);
  });
});
