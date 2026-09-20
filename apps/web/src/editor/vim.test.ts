import { Compartment, EditorSelection, EditorState } from '@codemirror/state';
import { describe, expect, it } from 'vitest';

import { baseExtensions } from './extensions.js';
import { vimExtension } from './vim.js';

describe('vimExtension', () => {
  it('goes in and out of a compartment leaving the document and the cursor where they were', () => {
    const vim = new Compartment();
    const start = EditorState.create({
      doc: 'first line\nsecond line',
      selection: EditorSelection.cursor(4),
      extensions: [baseExtensions(), vim.of([])],
    });

    // On, off, on again: what the editor does every time somebody runs the palette command.
    const on = start.update({ effects: vim.reconfigure(vimExtension) }).state;
    const off = on.update({ effects: vim.reconfigure([]) }).state;
    const again = off.update({ effects: vim.reconfigure(vimExtension) }).state;

    for (const state of [on, off, again]) {
      expect(state.doc.toString()).toBe('first line\nsecond line');
      expect(state.selection.main.head).toBe(4);
    }
  });
});
