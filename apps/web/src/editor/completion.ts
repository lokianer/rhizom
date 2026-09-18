// `[[` completion over the vault's notes, ranked with the same fuzzy matcher as the rest of
// the app. Registered through `markdownLanguage.data.of({ autocomplete })` so the Markdown
// language keeps its own sources instead of being overridden.
import {
  pickedCompletion,
  type Completion,
  type CompletionContext,
  type CompletionResult,
} from '@codemirror/autocomplete';
import type { EditorView } from '@codemirror/view';
import { fuzzyRank, type NoteSummary } from '@rhizom/core';

import { editorContext } from './context.js';

const MARKDOWN_EXTENSION = /\.(md|markdown)$/i;
/** `[[` plus the part of the target typed so far; a `|`, `#` or `]` ends it. */
const QUERY = /\[\[[^[\]\n|#]*$/;
const MAX_OPTIONS = 50;

function linkPath(note: NoteSummary): string {
  return note.path.replace(MARKDOWN_EXTENSION, '');
}

/** Adjacent matched characters become one `[from, to]` pair, which is what getMatch expects. */
function toRanges(positions: readonly number[]): number[] {
  const ranges: number[] = [];
  for (const position of positions) {
    const last = ranges.length - 1;
    if (ranges.length > 0 && ranges[last] === position) {
      ranges[last] = position + 1;
    } else {
      ranges.push(position, position + 1);
    }
  }
  return ranges;
}

function applyNoteLink(insert: string) {
  return (view: EditorView, completion: Completion, from: number, to: number): void => {
    // closeBrackets() turns `[[` into `[[]]`; consume that closer instead of adding a second one.
    const trailing = view.state.sliceDoc(to, to + 2) === ']]' ? 2 : 0;
    const text = `${insert}]]`;
    view.dispatch({
      changes: { from, to: to + trailing, insert: text },
      selection: { anchor: from + text.length },
      userEvent: 'input.complete',
      annotations: pickedCompletion.of(completion),
    });
  };
}

export function wikilinkCompletion(context: CompletionContext): CompletionResult | null {
  const match = context.matchBefore(QUERY);
  if (match === null) {
    return null;
  }
  const notes = context.state.facet(editorContext)?.notes ?? [];
  if (notes.length === 0) {
    return null;
  }

  const query = match.text.slice(2);
  // A query with a slash is about the location, so it ranks against the path instead.
  const byPath = query.includes('/');
  const ranked = fuzzyRank(
    query,
    notes,
    (note) => (byPath ? linkPath(note) : note.title),
    MAX_OPTIONS,
  );

  const matched = new Map<Completion, number[]>();
  const options = ranked.map(({ item, positions }) => {
    const option: Completion = {
      label: item.title,
      ...(item.folder === '' ? {} : { detail: item.folder }),
      apply: applyNoteLink(linkPath(item)),
    };
    matched.set(option, byPath ? [] : toRanges(positions));
    return option;
  });

  return {
    from: match.from + 2,
    options,
    // The options are already ranked here, so CodeMirror must not filter them again.
    filter: false,
    getMatch: (option) => matched.get(option) ?? [],
  };
}
