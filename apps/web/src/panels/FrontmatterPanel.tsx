// The note's frontmatter as a form: one row per key, a box of the kind the value has, and a line
// at the bottom for adding one. What it writes is the note's own text — `setFrontmatter` rewrites
// the keys it is handed and leaves every other byte of the head alone — which the note page then
// saves along with everything else the editor did. The panel never touches a file itself.
//
// The rows are derived from `content`, which changes on every keystroke in the editor. What is
// being typed in a box is therefore held here until it is committed — on blur, or on Enter —
// because a box whose value came straight from the note would be rewritten by the next render
// and swallow what somebody was in the middle of typing.
import { setFrontmatter, type FieldKind } from '@rhizom/core';
import { useId, useMemo, useState, type FormEvent, type KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';

import {
  ADDABLE_KINDS,
  blankValue,
  boxText,
  canAddKey,
  fieldChange,
  frontmatterForm,
  todayIso,
  type AddableKind,
  type FormField,
} from './frontmatter-model.js';
import './panels.css';

export interface FrontmatterPanelProps {
  /** The note's text as it now stands in the editor. */
  content: string;
  /** Called with the note's new text when a field is changed. */
  onChange: (content: string) => void;
  /** No editing while the note is in a conflict or otherwise not writable. */
  readOnly?: boolean;
}

/** What is being typed in one box, until it is committed. Only one box is typed in at a time. */
interface Draft {
  key: string;
  kind: FieldKind;
  text: string;
}

export function FrontmatterPanel({ content, onChange, readOnly = false }: FrontmatterPanelProps) {
  const { t } = useTranslation();
  const titleId = useId();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [name, setName] = useState('');
  const [kind, setKind] = useState<AddableKind>('text');
  const [refused, setRefused] = useState(false);

  // Reading the head parses its YAML, and `content` arrives again on every keystroke next door.
  const form = useMemo(() => frontmatterForm(content), [content]);
  const keys = form.fields.map((field) => field.key);

  /** Writes changes into the note, and says whether anything came of them. */
  const apply = (changes: Record<string, unknown>): boolean => {
    const next = setFrontmatter(content, changes);
    if (next === content) {
      return false;
    }
    onChange(next);
    return true;
  };

  const commit = () => {
    if (draft === null) {
      return;
    }
    setDraft(null);
    apply(fieldChange(draft.key, draft.kind, draft.text));
  };

  const addKey = (event: FormEvent) => {
    event.preventDefault();
    if (readOnly || !canAddKey(name, keys)) {
      return;
    }
    const written = apply(fieldChange(name, kind, blankValue(kind, todayIso(new Date()))));
    setRefused(!written);
    if (written) {
      setName('');
    }
  };

  /** Enter commits a one-line box; Escape drops what was typed and shows the file again. */
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      commit();
    } else if (event.key === 'Escape') {
      setDraft(null);
    }
  };

  /** The box for one field: what it holds comes from the draft while there is one. */
  const boxFor = (field: FormField, editable: AddableKind) => {
    const text = draft !== null && draft.key === field.key ? draft.text : boxText(field.value);
    const typed = (value: string) => {
      setDraft({ key: field.key, kind: editable, text: value });
    };

    switch (editable) {
      case 'boolean':
        // Nothing is typed into a tick, so there is nothing to hold back: it writes at once.
        return (
          <input
            className="rz-fm-tick"
            type="checkbox"
            checked={field.value === true}
            disabled={readOnly}
            onChange={(event) => {
              apply(fieldChange(field.key, 'boolean', event.target.checked));
            }}
          />
        );
      case 'list':
        // Enter belongs to this box — it is how the next entry is begun — so it is committed
        // when the box loses the focus and not before.
        return (
          <textarea
            className="rz-fm-box rz-fm-lines"
            rows={3}
            value={text}
            disabled={readOnly}
            placeholder={t('frontmatter.listPlaceholder')}
            onChange={(event) => {
              typed(event.target.value);
            }}
            onBlur={commit}
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                setDraft(null);
              }
            }}
          />
        );
      case 'text':
      case 'number':
      case 'date':
        return (
          <input
            className="rz-fm-box"
            type={editable}
            value={text}
            disabled={readOnly}
            onChange={(event) => {
              typed(event.target.value);
            }}
            onBlur={commit}
            onKeyDown={onKeyDown}
          />
        );
    }
  };

  // Folded away to start with, and for a reason: the frontmatter is already in the note, three
  // lines above the cursor. The form is there to edit it, not to read it, and a panel open by
  // default would take a third of the page from the text the reader came for.
  return (
    <aside className="rz-frontmatter" aria-labelledby={titleId}>
      <details className="rz-fm-details">
        <summary className="rz-fm-summary" id={titleId}>
          {t('frontmatter.title')}
          {form.fields.length > 0 ? (
            <span className="rz-frontmatter-note">
              {t('frontmatter.count', { count: form.fields.length })}
            </span>
          ) : null}
        </summary>

        {form.error !== undefined ? (
          <p className="rz-error rz-frontmatter-note">
            {t('frontmatter.broken', { message: form.error })}
          </p>
        ) : (
          <>
            {form.fields.length === 0 ? (
              <p className="rz-frontmatter-note">{t('frontmatter.empty')}</p>
            ) : null}

            <div className="rz-fm-rows">
              {form.fields.map((field) => {
                if (field.kind === 'unsupported') {
                  // Shown so that nobody wonders where a key went, and left alone: a nested value
                  // has no box, and a form that flattened it into one would lose what it holds.
                  return (
                    <div className="rz-fm-row" key={field.key}>
                      <span className="rz-fm-key">{field.key}</span>
                      <p className="rz-frontmatter-note">{t('frontmatter.unsupported')}</p>
                    </div>
                  );
                }
                return (
                  <div className="rz-fm-row" key={field.key}>
                    <label className="rz-fm-field">
                      <span className="rz-fm-key">{field.key}</span>
                      {boxFor(field, field.kind)}
                    </label>
                    <button
                      type="button"
                      className="rz-fm-remove"
                      disabled={readOnly}
                      aria-label={t('frontmatter.remove', { name: field.key })}
                      title={t('frontmatter.remove', { name: field.key })}
                      onClick={() => {
                        setDraft(null);
                        apply({ [field.key]: undefined });
                      }}
                    >
                      ×
                    </button>
                  </div>
                );
              })}
            </div>

            <form className="rz-fm-add" onSubmit={addKey}>
              <label className="rz-fm-add-field">
                <span className="rz-frontmatter-note">{t('frontmatter.newKey')}</span>
                <input
                  type="text"
                  value={name}
                  disabled={readOnly}
                  onChange={(event) => {
                    setName(event.target.value);
                    setRefused(false);
                  }}
                />
              </label>
              <label className="rz-fm-add-field">
                <span className="rz-frontmatter-note">{t('frontmatter.newKind')}</span>
                <select
                  value={kind}
                  disabled={readOnly}
                  onChange={(event) => {
                    const chosen = ADDABLE_KINDS.find((offered) => offered === event.target.value);
                    if (chosen !== undefined) {
                      setKind(chosen);
                    }
                  }}
                >
                  {ADDABLE_KINDS.map((offered) => (
                    <option key={offered} value={offered}>
                      {t(`frontmatter.kinds.${offered}`)}
                    </option>
                  ))}
                </select>
              </label>
              <button type="submit" disabled={readOnly || !canAddKey(name, keys)}>
                {t('frontmatter.add')}
              </button>
            </form>

            {refused ? (
              // Every ordinary reason is caught before this point, so what is left is a head
              // `setFrontmatter` will not write to at all: fences holding something that is not a
              // mapping. Saying nothing would leave a button that looks broken.
              <p className="rz-error rz-frontmatter-note">{t('frontmatter.notEditable')}</p>
            ) : null}
          </>
        )}
      </details>
    </aside>
  );
}
