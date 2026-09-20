import { Compartment, EditorState, Transaction } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import type { NoteSummary, TemplateSettings, TermMatcher } from '@rhizom/core';
import { useCallback, useEffect, useMemo, useRef, type JSX } from 'react';

import { useUiStore } from '../store/ui.js';
import {
  buildNoteIndex,
  editorContext,
  type EditorContextValue,
  type EditorHandlers,
} from './context.js';
import './editor.css';
import { baseExtensions, readOnlyExtension } from './extensions.js';

export interface MarkdownEditorProps {
  /** Vault path of the open note. A different path swaps the document (fresh history). */
  path: string;
  /** Content as loaded from the server; used when `path` changes. */
  content: string;
  /** Newer content from the file watcher; applied as a remote change, cursor kept. */
  externalContent?: string | undefined;
  readOnly?: boolean | undefined;
  /** Every note in the vault, for `[[` autocompletion. */
  notes: readonly NoteSummary[];
  /** The terms the vault defines, for marking them and explaining them on hover. */
  terms: TermMatcher;
  /** Where the vault keeps its templates, and what its placeholders default to. */
  templates: TemplateSettings;
  /** What the slash menu calls each built-in command, translated; keyed by command id. */
  commandLabels: Readonly<Record<string, string>>;
  /** BCP 47 tag for the month and weekday names a template writes into the note. */
  locale: string;
  /** Called on every document change (the caller debounces and saves). */
  onChange: (content: string) => void;
  /** Ctrl/Cmd+S. */
  onSave: (content: string) => void;
  /** A clicked wikilink: `target` is the raw link text as written. */
  onOpenLink: (target: string) => void;
  /** Dropped or pasted image: resolve with the vault path it was stored at. */
  onUpload: (file: File) => Promise<string>;
  /** The Markdown of another note, for inserting a template. */
  onReadNote: (path: string) => Promise<string>;
  /** Accessible name for the editor (already translated by the caller). */
  ariaLabel: string;
}

/** The parts of an open editor the effects below reconfigure. */
interface EditorSession {
  readonly view: EditorView;
  readonly context: Compartment;
  readonly contentAttributes: Compartment;
  readonly readOnly: Compartment;
  readonly vim: Compartment;
}

/** Props the editor reads when it (re)builds, rather than reacting to. */
interface LatestProps {
  readonly content: string;
  readonly readOnly: boolean;
  readonly ariaLabel: string;
  readonly context: EditorContextValue;
  readonly vimMode: boolean;
}

function contentAttributes(ariaLabel: string) {
  return EditorView.contentAttributes.of({ 'aria-label': ariaLabel });
}

/**
 * Applies content from outside — the file watcher — by replacing only the part that differs,
 * so the selection maps to a sensible place and the undo history stays the user's own.
 */
function applyExternalContent(view: EditorView, next: string): void {
  const current = view.state.doc.toString();
  if (current === next) {
    return;
  }
  let start = 0;
  const common = Math.min(current.length, next.length);
  while (start < common && current.charCodeAt(start) === next.charCodeAt(start)) {
    start += 1;
  }
  let endCurrent = current.length;
  let endNext = next.length;
  while (
    endCurrent > start &&
    endNext > start &&
    current.charCodeAt(endCurrent - 1) === next.charCodeAt(endNext - 1)
  ) {
    endCurrent -= 1;
    endNext -= 1;
  }
  view.dispatch({
    changes: { from: start, to: endCurrent, insert: next.slice(start, endNext) },
    annotations: [Transaction.remote.of(true), Transaction.addToHistory.of(false)],
  });
}

export function MarkdownEditor(props: MarkdownEditorProps): JSX.Element {
  const {
    path,
    content,
    externalContent,
    readOnly = false,
    notes,
    terms,
    templates,
    commandLabels,
    locale,
    onChange,
    onSave,
    onOpenLink,
    onUpload,
    onReadNote,
    ariaLabel,
  } = props;

  // The one thing this editor reads for itself rather than being handed: the note page knows
  // nothing about how a person likes to type, and the setting outlives every open note.
  const vimMode = useUiStore((state) => state.vimMode);

  const hostRef = useRef<HTMLDivElement | null>(null);
  const sessionRef = useRef<EditorSession | null>(null);
  const handlersRef = useRef<EditorHandlers>({
    onChange,
    onSave,
    onOpenLink,
    onUpload,
    onReadNote,
  });
  /** The content last handed to `onChange`, so the flush on unmount knows what is pending. */
  const reportedRef = useRef(content);

  const index = useMemo(() => buildNoteIndex(notes), [notes]);
  const context = useMemo<EditorContextValue>(
    () => ({ path, notes, index, terms, templates, commandLabels, locale, handlers: handlersRef }),
    [path, notes, index, terms, templates, commandLabels, locale],
  );

  const latestRef = useRef<LatestProps>({ content, readOnly, ariaLabel, context, vimMode });

  // Runs before the effect below on every commit, so a rebuilt editor starts from fresh props
  // while a re-rendered one keeps its view.
  useEffect(() => {
    handlersRef.current = { onChange, onSave, onOpenLink, onUpload, onReadNote };
    latestRef.current = { content, readOnly, ariaLabel, context, vimMode };
  });

  /**
   * Puts the Vim keymap into its compartment, or takes it out again. A compartment rather than
   * a new editor: the mode is a way of typing, and switching it must leave the text, the undo
   * history and the cursor exactly where they were.
   *
   * The keymap arrives by `import()`, so whoever never asks for it never downloads it.
   */
  const applyVimMode = useCallback((session: EditorSession, enabled: boolean) => {
    if (!enabled) {
      session.view.dispatch({ effects: session.vim.reconfigure([]) });
      return;
    }
    void import('./vim.js')
      .then(({ vimExtension }) => {
        // The chunk can arrive after the note was closed, or after the mode was switched off
        // again; either way this editor is no longer the one that asked.
        if (sessionRef.current !== session || !latestRef.current.vimMode) {
          return;
        }
        session.view.dispatch({ effects: session.vim.reconfigure(vimExtension) });
      })
      .catch(() => {
        // Nothing to fall back to and nothing lost: without its chunk the editor keeps the
        // keys it always had, and asking again will try the network again.
      });
  }, []);

  useEffect(() => {
    const host = hostRef.current;
    if (host === null) {
      return undefined;
    }
    const initial = latestRef.current;
    const compartments = {
      context: new Compartment(),
      contentAttributes: new Compartment(),
      readOnly: new Compartment(),
      vim: new Compartment(),
    };
    const view = new EditorView({
      parent: host,
      state: EditorState.create({
        doc: initial.content,
        extensions: [
          // Ahead of everything else, as the Vim package asks: whatever it is given, the
          // editor's own keys have to be what is left over, not the other way round.
          compartments.vim.of([]),
          baseExtensions(),
          compartments.context.of(editorContext.of(initial.context)),
          compartments.contentAttributes.of(contentAttributes(initial.ariaLabel)),
          compartments.readOnly.of(readOnlyExtension(initial.readOnly)),
          EditorView.updateListener.of((update) => {
            if (!update.docChanged) {
              return;
            }
            // Changes applied from the outside must not travel back out as edits.
            if (update.transactions.every((tr) => tr.annotation(Transaction.remote) === true)) {
              return;
            }
            const text = update.state.doc.toString();
            reportedRef.current = text;
            handlersRef.current.onChange(text);
          }),
        ],
      }),
    });
    const session: EditorSession = { view, ...compartments };
    sessionRef.current = session;
    reportedRef.current = initial.content;
    // The mode belongs to the person, not to the note: a new document opens in it as well.
    // Only when it is on — the compartment starts empty, which is what "off" means.
    if (initial.vimMode) {
      applyVimMode(session, true);
    }

    return () => {
      // Hand over an edit that has not been reported yet before the document goes away.
      const text = session.view.state.doc.toString();
      if (text !== reportedRef.current) {
        reportedRef.current = text;
        handlersRef.current.onChange(text);
      }
      session.view.destroy();
      sessionRef.current = null;
    };
  }, [applyVimMode, path]);

  useEffect(() => {
    const session = sessionRef.current;
    session?.view.dispatch({ effects: session.context.reconfigure(editorContext.of(context)) });
  }, [context]);

  useEffect(() => {
    const session = sessionRef.current;
    session?.view.dispatch({
      effects: session.contentAttributes.reconfigure(contentAttributes(ariaLabel)),
    });
  }, [ariaLabel]);

  useEffect(() => {
    const session = sessionRef.current;
    session?.view.dispatch({
      effects: session.readOnly.reconfigure(readOnlyExtension(readOnly)),
    });
  }, [readOnly]);

  useEffect(() => {
    const session = sessionRef.current;
    if (session !== null) {
      applyVimMode(session, vimMode);
    }
  }, [applyVimMode, vimMode]);

  useEffect(() => {
    const session = sessionRef.current;
    if (session === null || externalContent === undefined) {
      return;
    }
    applyExternalContent(session.view, externalContent);
    reportedRef.current = session.view.state.doc.toString();
  }, [externalContent]);

  return <div ref={hostRef} className="rz-editor" data-rz-note={path} />;
}
