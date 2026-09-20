// Tags as filter chips, nested the way the tags themselves are: `campaign/silverstadt/npcs` is
// three levels, and each of them can be pressed. Pressing a level asks for everything below it,
// so a vault that keeps its campaign under one prefix can be looked at whole or in parts.
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import type { TagCount } from '@rhizom/core';

import { buildTagTree, type TagNode } from './tag-model.js';
import './panels.css';

export interface TagListProps {
  tags: readonly TagCount[];
  selected: readonly string[];
  onToggle: (tag: string) => void;
  /** Absent in the wiki, which reads the vault and does not write it. */
  onRename?: (tag: string) => void;
}

export function TagList({ tags, selected, onToggle, onRename }: TagListProps) {
  const { t } = useTranslation();
  const tree = useMemo(() => buildTagTree(tags), [tags]);
  const chosen = useMemo(() => new Set(selected), [selected]);

  if (tree.length === 0) {
    return (
      <div className="rz-panel">
        <p className="rz-panel-empty">{t('tags.empty')}</p>
      </div>
    );
  }

  return (
    <div className="rz-panel">
      <ul className="rz-tag-tree" aria-label={t('tags.label')}>
        {tree.map((node) => (
          <TagBranch
            key={node.tag}
            node={node}
            chosen={chosen}
            onToggle={onToggle}
            onRename={onRename}
          />
        ))}
      </ul>
    </div>
  );
}

interface TagBranchProps {
  node: TagNode;
  chosen: ReadonlySet<string>;
  onToggle: (tag: string) => void;
  onRename: ((tag: string) => void) | undefined;
}

function TagBranch({ node, chosen, onToggle, onRename }: TagBranchProps) {
  // A level whose children are all leaves lays them out as a wrapped row rather than one row
  // each: `npc` with six kinds under it is one line of chips, not six, and the sidebar stays a
  // sidebar. Where a child has children of its own the rows come back, because that is where
  // the indent is carrying meaning.
  const leaves = node.children.every((child) => child.children.length === 0);

  return (
    <li className="rz-tag-branch">
      <TagChip node={node} pressed={chosen.has(node.tag)} onToggle={onToggle} onRename={onRename} />
      {node.children.length === 0 ? null : (
        <ul className={leaves ? 'rz-tag-children rz-tag-chips' : 'rz-tag-children'}>
          {node.children.map((child) =>
            leaves ? (
              <li key={child.tag}>
                <TagChip
                  node={child}
                  pressed={chosen.has(child.tag)}
                  onToggle={onToggle}
                  onRename={onRename}
                />
              </li>
            ) : (
              <TagBranch
                key={child.tag}
                node={child}
                chosen={chosen}
                onToggle={onToggle}
                onRename={onRename}
              />
            ),
          )}
        </ul>
      )}
    </li>
  );
}

interface TagChipProps {
  node: TagNode;
  pressed: boolean;
  onToggle: (tag: string) => void;
  onRename: ((tag: string) => void) | undefined;
}

function TagChip({ node, pressed, onToggle, onRename }: TagChipProps) {
  const { t } = useTranslation();
  // A level nobody wrote has no notes of its own; the number that means something there is what
  // lies below it, and showing a bare 0 beside a row holding forty notes would be a lie.
  const shown = node.count === 0 ? node.total : node.count;

  return (
    // The rename sits beside the chip rather than inside it: a chip is a button, and a button
    // inside a button is not something a browser or a screen reader can make sense of. It shows
    // itself when the pair is hovered or holds the focus, so a wall of chips stays a wall of
    // chips until somebody reaches for one.
    <span className="rz-tag-chip-group">
      <button
        type="button"
        className="rz-tag-chip"
        aria-pressed={pressed}
        aria-label={t('tags.filter', { tag: node.tag })}
        title={t('tags.count', { count: shown })}
        onClick={() => {
          onToggle(node.tag);
        }}
      >
        <span className="rz-tag-name">{node.name}</span>
        <span className="rz-tag-count">{shown}</span>
      </button>
      {onRename === undefined ? null : (
        <button
          type="button"
          className="rz-tag-rename"
          aria-label={t('tags.rename', { tag: node.tag })}
          title={t('tags.rename', { tag: node.tag })}
          onClick={() => {
            onRename(node.tag);
          }}
        >
          <span aria-hidden="true">✎</span>
        </button>
      )}
    </span>
  );
}
