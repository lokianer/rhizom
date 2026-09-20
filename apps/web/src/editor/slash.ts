// The slash menu: a few things worth dropping into a note without leaving the keyboard, and
// every template the vault keeps.
//
// It is a second completion source beside the one for `[[`, registered the same way so that the
// Markdown language keeps both. Two things must not open it: an unfinished `[[Folder/` — a path
// holds slashes and the note list is the answer there — and anything that is not prose, because
// a slash is a divide sign in a code fence.
//
// A built-in inserts its text at once. A template has to be fetched first, so its insertion
// point is remembered and mapped through whatever gets typed while the note is on its way,
// exactly as a dropped image is.
import {
  pickedCompletion,
  type Completion,
  type CompletionContext,
  type CompletionResult,
} from '@codemirror/autocomplete';
import { syntaxTree } from '@codemirror/language';
import { StateEffect, StateField } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { expandTemplate, folderOf, noteNameOf, type TemplateContext } from '@rhizom/core';

import { editorContext, frontmatterEnd, NOT_PROSE, type EditorContextValue } from './context.js';
import { templateNotes } from './template-model.js';

/**
 * `/` at the start of a line or after a space, plus the word typed so far. The word is whatever
 * a note may be called: letters of any script, marks, digits — and emoji, because a vault whose
 * templates are named `📓 Daily` is a vault somebody made on purpose. A space is not part of it,
 * so `Daily Note` is picked from the list rather than typed out in full; letting the query run
 * across spaces would keep the menu open over a whole sentence.
 */
const QUERY =
  /(?:^|\s)\/(?:[\p{L}\p{N}\p{M}\p{Extended_Pictographic}\p{Regional_Indicator}_-]|\u200d|\ufe0f)*$/u;
/** An unfinished wikilink; its target may hold slashes, and the note list belongs to it. */
const OPEN_WIKILINK = /\[\[[^[\]\n]*$/;

/** The built-in commands, in the order the menu shows them. */
export const COMMANDS = ['table', 'definition', 'date', 'time'] as const;

export type CommandId = (typeof COMMANDS)[number];

/**
 * What each built-in inserts, as a template — so `{{date}}` means here what it means in a
 * template file, and `{{cursor}}` says where the caret should land. `definition` has no text of
 * its own: it edits the frontmatter rather than writing at the cursor.
 */
const BODIES: Readonly<Record<CommandId, string>> = {
  table: '| {{cursor}} |  |\n| --- | --- |\n|  |  |\n',
  definition: '',
  date: '{{date}}',
  time: '{{time}}',
};

export function slashCompletion(context: CompletionContext): CompletionResult | null {
  const match = context.matchBefore(QUERY);
  if (match === null || context.matchBefore(OPEN_WIKILINK) !== null) {
    return null;
  }
  if (!isProse(context)) {
    return null;
  }
  const value = context.state.facet(editorContext);
  if (value === undefined) {
    return null;
  }

  const options: Completion[] = COMMANDS.map((id) => ({
    // The label is what you type; the vault's own language is what you read.
    label: id,
    displayLabel: value.commandLabels[id] ?? id,
    apply: applyCommand(id),
  }));
  for (const note of templateNotes(value.notes, value.templates)) {
    options.push({
      label: noteNameOf(note.path),
      detail: folderOf(note.path),
      apply: applyTemplate(note.path),
    });
  }

  // `from` is past the slash so that what the reader typed is what gets matched; the slash
  // itself is swallowed when an option is applied.
  return { from: match.to - typed(match.text).length, options };
}

/** What has been typed after the slash. */
function typed(text: string): string {
  return text.slice(text.indexOf('/') + 1);
}

/** Whether the cursor stands in prose rather than in code, a link, an embed or the frontmatter. */
function isProse(context: CompletionContext): boolean {
  // The Markdown parser has no frontmatter node — a leading `---` is a thematic break to it and
  // the keys below are an ordinary paragraph — so the block has to be recognised by hand. A
  // table dropped into the frontmatter is not a table; it is a broken note.
  if (context.pos <= frontmatterEnd(context.state)) {
    return false;
  }
  let node = syntaxTree(context.state).resolveInner(context.pos, -1);
  while (node.parent !== null) {
    if (NOT_PROSE.has(node.name)) {
      return false;
    }
    node = node.parent;
  }
  return true;
}

/** A piece of a document edit, in the shape CodeMirror takes and a test can read. */
export interface DocChange {
  from: number;
  to?: number;
  insert: string;
}

/** What a built-in does to the document, and where it leaves the cursor. */
export interface SlashEdit {
  changes: DocChange[];
  anchor: number;
}

/**
 * The change a built-in makes. Separate from the dispatch so that a test without a DOM can say
 * what `/table` writes and where the cursor ends up.
 */
export function commandChange(
  id: CommandId,
  context: EditorContextValue,
  doc: string,
  from: number,
  to: number,
): SlashEdit {
  if (id === 'definition') {
    return definitionChange(doc, from, to);
  }
  const { text, cursor } = expandTemplate(BODIES[id], templateContextOf(context));
  // A table is a block: it has to begin a line, or GFM reads it as a sentence full of pipes.
  const lead = BLOCK.has(id) && !atLineStart(doc, from) ? '\n' : '';
  const insert = lead + text;
  return { changes: [{ from, to, insert }], anchor: from + lead.length + (cursor ?? text.length) };
}

/** The built-ins that are block-level Markdown and cannot share a line with anything. */
const BLOCK: ReadonlySet<CommandId> = new Set(['table']);

function atLineStart(doc: string, at: number): boolean {
  const start = doc.lastIndexOf('\n', at - 1) + 1;
  return doc.slice(start, at).trim() === '';
}

/**
 * The change that makes the open note a definition: `type: definition` in its frontmatter,
 * which is what the glossary and the term marks look for. The note gets a frontmatter block if
 * it has none, and a note that already declares a type is left with the one it has.
 */
export function definitionChange(doc: string, from: number, to: number): SlashEdit {
  const removal = { from, to, insert: '' };
  // The newline before the closing fence is optional: `---\n---` is an empty frontmatter block,
  // and a note that has one must not be given a second.
  const block = /^---\r?\n([\s\S]*?)\r?\n?---(\r?\n|$)/.exec(doc);
  if (block === null) {
    const insert = '---\ntype: definition\n---\n\n';
    return { changes: [{ from: 0, insert }, removal], anchor: from + insert.length };
  }
  if (/^type\s*:/m.test(block[1] ?? '')) {
    return { changes: [removal], anchor: from };
  }
  // Right after the opening fence, where the eye looks for it.
  const insert = 'type: definition\n';
  const at = doc.indexOf('\n') + 1;
  return { changes: [{ from: at, insert }, removal], anchor: from + insert.length };
}

/** The context a template is expanded in: this note, this vault's formats, this language. */
export function templateContextOf(context: EditorContextValue, now = new Date()): TemplateContext {
  return {
    title: noteNameOf(context.path),
    path: context.path,
    now,
    dateFormat: context.templates.dateFormat,
    timeFormat: context.templates.timeFormat,
    locale: context.locale,
  };
}

function applyCommand(id: CommandId) {
  return (view: EditorView, completion: Completion, from: number, to: number): void => {
    const context = view.state.facet(editorContext);
    if (context === undefined) {
      return;
    }
    // One before `from`: the slash itself, which is not part of what was matched.
    const { changes, anchor } = commandChange(id, context, view.state.doc.toString(), from - 1, to);
    view.dispatch({
      changes,
      selection: { anchor },
      userEvent: 'input.complete',
      annotations: pickedCompletion.of(completion),
    });
  };
}

/** A template being fetched, and where it is going once it arrives. */
interface PendingTemplate {
  readonly id: number;
  readonly pos: number;
}

const startTemplate = StateEffect.define<PendingTemplate>();
const endTemplate = StateEffect.define<number>();

export const slashTemplates = StateField.define<readonly PendingTemplate[]>({
  create: () => [],
  update(value, transaction) {
    let pending = transaction.docChanged
      ? value.map((entry) => ({ id: entry.id, pos: transaction.changes.mapPos(entry.pos, 1) }))
      : value;
    for (const effect of transaction.effects) {
      if (effect.is(startTemplate)) {
        pending = [...pending, effect.value];
      } else if (effect.is(endTemplate)) {
        pending = pending.filter((entry) => entry.id !== effect.value);
      }
    }
    return pending;
  },
});

let nextTemplateId = 0;

function applyTemplate(path: string) {
  return (view: EditorView, completion: Completion, from: number, to: number): void => {
    const context = view.state.facet(editorContext);
    if (context === undefined) {
      return;
    }
    const id = nextTemplateId;
    nextTemplateId += 1;
    // What is about to be taken out, kept so that a template that never arrives can be undone.
    const typed = view.state.sliceDoc(from - 1, to);
    // The slash and the word go now, so the menu closes on a document that reads properly; the
    // body arrives where they were, however much has been typed there in the meantime.
    view.dispatch({
      changes: { from: from - 1, to, insert: '' },
      effects: startTemplate.of({ id, pos: from - 1 }),
      userEvent: 'input.complete',
      annotations: pickedCompletion.of(completion),
    });
    void context.handlers.current.onReadNote(path).then(
      (body) => {
        const pending = view.state.field(slashTemplates).find((entry) => entry.id === id);
        if (pending === undefined || view.state.readOnly) {
          view.dispatch({ effects: endTemplate.of(id) });
          return;
        }
        const { text, cursor } = expandTemplate(body, templateContextOf(context));
        view.dispatch({
          changes: { from: pending.pos, insert: text },
          selection: { anchor: pending.pos + (cursor ?? text.length) },
          effects: endTemplate.of(id),
        });
      },
      () => {
        // The note could not be read — renamed, deleted, or the server did not answer. Whoever
        // typed it should get their `/name` back rather than an empty line where a template was
        // supposed to appear; the handler that fetched it says what went wrong.
        const pending = view.state.field(slashTemplates).find((entry) => entry.id === id);
        if (pending === undefined || view.state.readOnly) {
          view.dispatch({ effects: endTemplate.of(id) });
          return;
        }
        view.dispatch({
          changes: { from: pending.pos, insert: typed },
          selection: { anchor: pending.pos + typed.length },
          effects: endTemplate.of(id),
        });
      },
    );
  };
}
