// Tags as filter chips, grouped by their first segment so that a vault full of
// `campaign/silverstadt/npcs` stays readable.
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import type { TagCount } from '@rhizom/core';

import { groupTags, tagChipLabel } from './tag-model.js';
import './panels.css';

export interface TagListProps {
  tags: readonly TagCount[];
  selected: readonly string[];
  onToggle: (tag: string) => void;
}

export function TagList({ tags, selected, onToggle }: TagListProps) {
  const { t } = useTranslation();
  const groups = useMemo(() => groupTags(tags), [tags]);
  const chosen = useMemo(() => new Set(selected), [selected]);

  if (groups.length === 0) {
    return (
      <div className="rz-panel">
        <p className="rz-panel-empty">{t('tags.empty')}</p>
      </div>
    );
  }

  return (
    <div className="rz-panel">
      <ul className="rz-tag-groups" aria-label={t('tags.label')}>
        {groups.map((group) => (
          <li key={group.name} className="rz-tag-group">
            {group.flat ? null : (
              <h3 className="rz-tag-group-name">
                {group.name}
                <span className="rz-tag-total">{t('tags.count', { count: group.total })}</span>
              </h3>
            )}
            <ul className="rz-tag-chips">
              {group.tags.map((tag) => (
                <li key={tag.tag}>
                  <TagChip
                    tag={tag}
                    label={group.flat ? tag.tag : tagChipLabel(tag.tag, group.name)}
                    pressed={chosen.has(tag.tag)}
                    onToggle={onToggle}
                  />
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ul>
    </div>
  );
}

interface TagChipProps {
  tag: TagCount;
  label: string;
  pressed: boolean;
  onToggle: (tag: string) => void;
}

function TagChip({ tag, label, pressed, onToggle }: TagChipProps) {
  const { t } = useTranslation();

  return (
    <button
      type="button"
      className="rz-tag-chip"
      aria-pressed={pressed}
      aria-label={t('tags.filter', { tag: tag.tag })}
      onClick={() => {
        onToggle(tag.tag);
      }}
    >
      <span className="rz-tag-name">{label}</span>
      <span className="rz-tag-count">{tag.count}</span>
    </button>
  );
}
