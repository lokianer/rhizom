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
}

export function TagList({ tags, selected, onToggle }: TagListProps) {
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
          <TagBranch key={node.tag} node={node} chosen={chosen} onToggle={onToggle} />
        ))}
      </ul>
    </div>
  );
}

interface TagBranchProps {
  node: TagNode;
  chosen: ReadonlySet<string>;
  onToggle: (tag: string) => void;
}

function TagBranch({ node, chosen, onToggle }: TagBranchProps) {
  return (
    <li className="rz-tag-branch">
      <TagChip node={node} pressed={chosen.has(node.tag)} onToggle={onToggle} />
      {node.children.length === 0 ? null : (
        <ul className="rz-tag-children">
          {node.children.map((child) => (
            <TagBranch key={child.tag} node={child} chosen={chosen} onToggle={onToggle} />
          ))}
        </ul>
      )}
    </li>
  );
}

interface TagChipProps {
  node: TagNode;
  pressed: boolean;
  onToggle: (tag: string) => void;
}

function TagChip({ node, pressed, onToggle }: TagChipProps) {
  const { t } = useTranslation();
  // A level nobody wrote has no notes of its own; the number that means something there is what
  // lies below it, and showing a bare 0 beside a row holding forty notes would be a lie.
  const shown = node.count === 0 ? node.total : node.count;

  return (
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
  );
}
