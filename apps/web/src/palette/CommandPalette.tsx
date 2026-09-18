// The command palette: one input over a list of commands and notes, on the WAI-ARIA combobox
// pattern. Opening it belongs to the app, which binds the shortcut; this component only
// follows the `open` prop and reports back when it should go away.
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { NoteSummary } from '@rhizom/core';

import { highlightSegments, rankCommands, rankNotes, wrapIndex } from './ranking.js';
import type { HighlightSegment } from './ranking.js';
import './palette.css';

export interface PaletteCommand {
  id: string;
  /** Already translated. */
  label: string;
  run: () => void;
}

export interface CommandPaletteProps {
  open: boolean;
  onClose: () => void;
  notes: readonly NoteSummary[];
  commands: readonly PaletteCommand[];
  onOpenNote: (path: string) => void;
}

/** Enough to choose from without turning the list into a second file tree. */
const COMMAND_LIMIT = 8;
const NOTE_LIMIT = 40;

export function CommandPalette(props: CommandPaletteProps) {
  // Mounting only while open gives every visit a fresh query and selection.
  return props.open ? <PaletteDialog {...props} /> : null;
}

function PaletteDialog({ onClose, notes, commands, onOpenNote }: CommandPaletteProps) {
  const { t } = useTranslation();
  const baseId = useId();
  const listId = `${baseId}-list`;
  const dialogRef = useRef<HTMLDialogElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState('');
  const [chosen, setChosen] = useState(0);

  const matchedCommands = useMemo(
    () => rankCommands(query, commands, COMMAND_LIMIT),
    [query, commands],
  );
  const matchedNotes = useMemo(() => rankNotes(query, notes, NOTE_LIMIT), [query, notes]);

  const total = matchedCommands.length + matchedNotes.length;
  const active = total === 0 ? -1 : Math.min(chosen, total - 1);

  useEffect(() => {
    const dialog = dialogRef.current;
    // Whatever had the focus when the palette opened gets it back when it closes.
    const trigger = document.activeElement;
    dialog?.showModal();
    inputRef.current?.focus();
    return () => {
      dialog?.close();
      if (trigger instanceof HTMLElement && trigger.isConnected) {
        trigger.focus();
      }
    };
  }, []);

  useEffect(() => {
    const option = active < 0 ? null : document.getElementById(optionId(baseId, active));
    option?.scrollIntoView({ block: 'nearest' });
  }, [active, baseId]);

  const pick = (index: number): void => {
    const command = matchedCommands[index];
    if (command !== undefined) {
      command.item.run();
      onClose();
      return;
    }
    const note = matchedNotes[index - matchedCommands.length];
    if (note !== undefined) {
      onOpenNote(note.item.path);
      onClose();
    }
  };

  return (
    <dialog
      ref={dialogRef}
      className="rz-palette"
      aria-label={t('palette.label')}
      onCancel={(event) => {
        // React unmounts the dialog; letting the browser close it too would lose that.
        event.preventDefault();
        onClose();
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <div className="rz-palette-box">
        <input
          ref={inputRef}
          type="text"
          role="combobox"
          className="rz-palette-input"
          aria-label={t('palette.label')}
          aria-expanded={total > 0}
          aria-controls={listId}
          aria-activedescendant={active < 0 ? undefined : optionId(baseId, active)}
          aria-autocomplete="list"
          placeholder={t('palette.placeholder')}
          value={query}
          autoComplete="off"
          spellCheck={false}
          onChange={(event) => {
            setQuery(event.target.value);
            setChosen(0);
          }}
          onKeyDown={(event) => {
            switch (event.key) {
              case 'ArrowDown':
                event.preventDefault();
                setChosen(wrapIndex(active, 1, total));
                break;
              case 'ArrowUp':
                event.preventDefault();
                setChosen(wrapIndex(active, -1, total));
                break;
              case 'Home':
                event.preventDefault();
                setChosen(0);
                break;
              case 'End':
                event.preventDefault();
                setChosen(Math.max(0, total - 1));
                break;
              case 'Enter':
                event.preventDefault();
                pick(active);
                break;
              default:
                break;
            }
          }}
        />

        {total === 0 ? (
          <p className="rz-palette-empty" role="status">
            {t('palette.empty')}
          </p>
        ) : null}

        <div id={listId} role="listbox" className="rz-palette-list" aria-label={t('palette.label')}>
          {matchedCommands.length > 0 ? (
            <div role="group" aria-label={t('palette.commands')}>
              <div className="rz-palette-section" aria-hidden="true">
                {t('palette.commands')}
              </div>
              {matchedCommands.map((match, position) => (
                <PaletteOption
                  key={match.item.id}
                  id={optionId(baseId, position)}
                  selected={position === active}
                  label={highlightSegments(match.item.label, match.positions)}
                  detail={[]}
                  onPick={() => {
                    pick(position);
                  }}
                />
              ))}
            </div>
          ) : null}

          {matchedNotes.length > 0 ? (
            <div role="group" aria-label={t('palette.notes')}>
              <div className="rz-palette-section" aria-hidden="true">
                {t('palette.notes')}
              </div>
              {matchedNotes.map((match, position) => {
                const index = matchedCommands.length + position;
                const onTitle = match.field === 'title';
                return (
                  <PaletteOption
                    key={match.item.path}
                    id={optionId(baseId, index)}
                    selected={index === active}
                    label={highlightSegments(match.item.title, onTitle ? match.positions : [])}
                    detail={highlightSegments(match.item.path, onTitle ? [] : match.positions)}
                    onPick={() => {
                      pick(index);
                    }}
                  />
                );
              })}
            </div>
          ) : null}
        </div>
      </div>
    </dialog>
  );
}

function optionId(baseId: string, index: number): string {
  return `${baseId}-option-${String(index)}`;
}

interface PaletteOptionProps {
  id: string;
  selected: boolean;
  label: readonly HighlightSegment[];
  detail: readonly HighlightSegment[];
  onPick: () => void;
}

function PaletteOption({ id, selected, label, detail, onPick }: PaletteOptionProps) {
  return (
    <div
      id={id}
      role="option"
      aria-selected={selected}
      className={selected ? 'rz-palette-option rz-palette-option-active' : 'rz-palette-option'}
      // The input keeps the focus, so the click must not move it away first.
      onMouseDown={(event) => {
        event.preventDefault();
      }}
      onClick={onPick}
    >
      <span className="rz-palette-label">
        <Highlighted segments={label} />
      </span>
      {detail.length > 0 ? (
        <span className="rz-palette-detail">
          <Highlighted segments={detail} />
        </span>
      ) : null}
    </div>
  );
}

function Highlighted({ segments }: { segments: readonly HighlightSegment[] }) {
  return (
    <>
      {segments.map((segment, index) =>
        segment.match ? (
          <mark key={index}>{segment.text}</mark>
        ) : (
          <span key={index}>{segment.text}</span>
        ),
      )}
    </>
  );
}
