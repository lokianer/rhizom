import { Compartment, EditorState, Transaction } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import type { NoteSummary, TermMatcher } from '@rhizom/core';
import { useEffect, useMemo, useRef, type JSX } from 'react';

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
  /** Called on every document change (the caller debounces and saves). */
  onChange: (content: string) => void;
  /** Ctrl/Cmd+S. */
  onSave: (content: string) => void;
  /** A clicked wikilink: `target` is the raw link text as written. */
  onOpenLink: (target: string) => void;
  /** Dropped or pasted image: resolve with the vault path it was stored at. */
  onUpload: (file: File) => Promise<string>;
  /** Accessible name for the editor (already translated by the caller). */
  ariaLabel: string;
}

/** The parts of an open editor the effects below reconfigure. */
interface EditorSession {
  readonly view: EditorView;
  readonly context: Compartment;
  readonly contentAttributes: Compartment;
  readonly readOnly: Compartment;
}

/** Props the editor reads when it (re)builds, rather than reacting to. */
interface LatestProps {
  readonly content: string;
  readonly readOnly: boolean;
  readonly ariaLabel: string;
  readonly context: EditorContextValue;
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
    onChange,
    onSave,
    onOpenLink,
    onUpload,
    ariaLabel,
  } = props;

  const hostRef = useRef<HTMLDivElement | null>(null);
  const sessionRef = useRef<EditorSession | null>(null);
  const handlersRef = useRef<EditorHandlers>({ onChange, onSave, onOpenLink, onUpload });
  /** The content last handed to `onChange`, so the flush on unmount knows what is pending. */
  const reportedRef = useRef(content);

  const index = useMemo(() => buildNoteIndex(notes), [notes]);
  const context = useMemo<EditorContextValue>(
    () => ({ path, notes, index, terms, handlers: handlersRef }),
    [path, notes, index, terms],
  );

  const latestRef = useRef<LatestProps>({ content, readOnly, ariaLabel, context });

  // Runs before the effect below on every commit, so a rebuilt editor starts from fresh props
  // while a re-rendered one keeps its view.
  useEffect(() => {
    handlersRef.current = { onChange, onSave, onOpenLink, onUpload };
    latestRef.current = { content, readOnly, ariaLabel, context };
  });

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
    };
    const view = new EditorView({
      parent: host,
      state: EditorState.create({
        doc: initial.content,
        extensions: [
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
  }, [path]);

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
    if (session === null || externalContent === undefined) {
      return;
    }
    applyExternalContent(session.view, externalContent);
    reportedRef.current = session.view.state.doc.toString();
  }, [externalContent]);

  return <div ref={hostRef} className="rz-editor" data-rz-note={path} />;
}
