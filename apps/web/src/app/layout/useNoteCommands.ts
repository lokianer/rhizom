// Everything the frame can do to a note: open one, make one, open today's, copy one. Each is a
// command the palette offers and a button the sidebar shows, so they are gathered here rather
// than spread through the component that happens to render both.
import { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';

import {
  DEFAULT_DATE_FORMAT,
  DEFAULT_TIME_FORMAT,
  ensureMarkdownExtension,
  expandTemplate,
  noteNameOf,
  type TemplateSettings,
} from '@rhizom/core';

import { api, ApiRequestError } from '../../api/client.js';
import { templateNotes } from '../../editor/template-model.js';
import { headingHref, noteHref } from '../../routing/paths.js';
import { useVaultStore } from '../../store/vault.js';
import { copyPath } from './commands-model.js';
import { dailyNotePath } from './daily.js';

/**
 * The text a new note starts from: a template of the vault's, expanded the way the slash menu
 * expands one, so `{{date}}` and `{{title}}` mean here what they mean there. A template that is
 * named and no longer there is not an error — the note starts empty, which is what it would
 * have done without a template at all.
 */
async function templateText(
  template: string | null,
  path: string,
  templates: TemplateSettings | undefined,
  locale: string,
): Promise<string> {
  if (template === null) {
    return '';
  }
  try {
    const source = await api.note(template);
    return expandTemplate(source.content, {
      title: noteNameOf(path),
      path,
      now: new Date(),
      dateFormat: templates?.dateFormat ?? DEFAULT_DATE_FORMAT,
      timeFormat: templates?.timeFormat ?? DEFAULT_TIME_FORMAT,
      locale,
    }).text;
  } catch {
    return '';
  }
}

/**
 * The note commands, plus the folder a new note is being named in — which is state because the
 * dialog asking for the name stays open for as long as it is not null.
 *
 * `openNotePath` comes in rather than being read here: the component already watches the
 * location, and duplicating a note needs to know which one is open.
 */
export function useNoteCommands(openNotePath: string | null) {
  const { i18n } = useTranslation();
  const navigate = useNavigate();
  const notes = useVaultStore((state) => state.notes);
  const refresh = useVaultStore((state) => state.refresh);
  const daily = useVaultStore((state) => state.info?.daily);
  const templates = useVaultStore((state) => state.info?.templates);

  const [newNoteFolder, setNewNoteFolder] = useState<string | null>(null);

  // The one way into a note from the sidebar. A fragment names a heading in it: the outline
  // sends one, everything else opens the note at the top and leaves the argument out.
  const openNote = useCallback(
    (path: string, fragment?: string) => {
      void navigate(fragment === undefined ? noteHref(path) : headingHref(path, fragment));
    },
    [navigate],
  );

  const createNote = useCallback(
    async (path: string, template: string | null) => {
      setNewNoteFolder(null);
      // A note made from a template is made with its text in hand rather than created empty and
      // then written to: one request, and nothing to clean up if the second one never happens.
      const content = await templateText(
        template,
        ensureMarkdownExtension(path),
        templates,
        i18n.language,
      );
      const created = await api.createNote(content === '' ? { path } : { path, content });
      await refresh();
      void navigate(noteHref(created.path));
    },
    [i18n.language, navigate, refresh, templates],
  );

  // Today's note: the vault says where it goes and what a day is called, and the note is made
  // from the vault's own template when it does not exist yet. The command is not offered at all
  // when the vault keeps no daily notes.
  const openToday = useCallback(async () => {
    const path = daily === undefined ? null : dailyNotePath(daily, new Date(), i18n.language);
    if (path === null) {
      return;
    }
    try {
      await api.note(path);
    } catch (error) {
      if (!(error instanceof ApiRequestError) || error.status !== 404) {
        throw error;
      }
      await api.createNote({
        path,
        content: await templateText(daily?.template ?? null, path, templates, i18n.language),
      });
      await refresh();
    }
    void navigate(noteHref(path));
  }, [daily, i18n.language, navigate, refresh, templates]);

  // Duplicating a note: the same words under the next free name beside it. Nothing is renamed and
  // no link is rewritten — a copy is a new note that happens to say the same thing, and what the
  // original pointed at, the copy points at too.
  const duplicateNote = useCallback(async () => {
    if (openNotePath === null) {
      return;
    }
    const source = await api.note(openNotePath);
    const taken = new Set(notes.map((note) => note.path));
    // The note list is a moment old, so a name it believes free may have been taken since. The
    // server's refusal (409) is an answer rather than a failure: that name is gone, and the next
    // one in the series is asked for instead. Five tries, then it is a failure like any other.
    for (let attempt = 0; ; attempt += 1) {
      const path = copyPath(openNotePath, taken);
      try {
        const created = await api.createNote({ path, content: source.content });
        await refresh();
        void navigate(noteHref(created.path));
        return;
      } catch (error) {
        const nameTaken = error instanceof ApiRequestError && error.status === 409;
        if (!nameTaken || attempt >= 4) {
          throw error;
        }
        taken.add(path);
      }
    }
  }, [navigate, notes, openNotePath, refresh]);

  // The notes a new one can start from: the vault's template folder, by file name, because that
  // is the name the slash menu offers them under and the name their own heading does not give.
  const templateChoices = useMemo(
    () =>
      templates === undefined
        ? []
        : templateNotes(notes, templates).map((note) => ({
            path: note.path,
            name: noteNameOf(note.path),
          })),
    [notes, templates],
  );

  return {
    openNote,
    createNote,
    openToday,
    duplicateNote,
    templateChoices,
    newNoteFolder,
    setNewNoteFolder,
  };
}
