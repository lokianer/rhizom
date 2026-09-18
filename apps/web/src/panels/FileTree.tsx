// The vault as a WAI-ARIA treeview. The rows are flattened into one list so that large vaults
// can render a window of them; the nesting is rebuilt for the rendered slice, which keeps the
// role="group" structure intact without walking the whole tree on every scroll.
import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react';
import { useTranslation } from 'react-i18next';
import { folderOf } from '@rhizom/core';
import type { TreeEntry } from '@rhizom/core';

import { useUiStore } from '../store/ui.js';
import {
  ancestorFolders,
  flattenTree,
  nestRows,
  rowIndexOf,
  rowWindow,
  treeKeyAction,
  type TreeNode,
  type TreeRow,
} from './tree-model.js';
import './panels.css';

export interface FileTreeProps {
  tree: readonly TreeEntry[];
  activePath: string | null;
  onOpen: (path: string) => void;
  /** "New note" in a folder; `folder` is '' at the vault root. */
  onCreate: (folder: string) => void;
}

export function FileTree({ tree, activePath, onOpen, onCreate }: FileTreeProps) {
  const { t } = useTranslation();
  const baseId = useId();
  const expandedFolders = useUiStore((state) => state.expandedFolders);
  const toggleFolder = useUiStore((state) => state.toggleFolder);
  const expandFolders = useUiStore((state) => state.expandFolders);

  const expanded = useMemo(() => new Set(expandedFolders), [expandedFolders]);
  const rows = useMemo(() => flattenTree(tree, expanded), [tree, expanded]);

  const [focusPath, setFocusPath] = useState<string | null>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(0);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Reveal the open note: whenever it changes, the folders above it are opened.
  useEffect(() => {
    if (activePath === null) {
      return;
    }
    const open = useUiStore.getState().expandedFolders;
    const missing = ancestorFolders(activePath).filter((folder) => !open.includes(folder));
    if (missing.length > 0) {
      expandFolders(missing);
    }
  }, [activePath, expandFolders]);

  useEffect(() => {
    const element = scrollRef.current;
    if (element === null) {
      return undefined;
    }
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry !== undefined) {
        setViewportHeight(entry.contentRect.height);
      }
    });
    observer.observe(element);
    return () => {
      observer.disconnect();
    };
  }, []);

  // The roving tabindex follows the keyboard, then the open note, then the first row.
  const focusIndex = useMemo(() => {
    const chosen = focusPath === null ? -1 : rowIndexOf(rows, focusPath);
    if (chosen >= 0) {
      return chosen;
    }
    const active = activePath === null ? -1 : rowIndexOf(rows, activePath);
    if (active >= 0) {
      return active;
    }
    return rows.length > 0 ? 0 : -1;
  }, [rows, focusPath, activePath]);

  const view = rowWindow(rows.length, scrollTop, viewportHeight, focusIndex);
  const nodes = useMemo(
    () => nestRows(rows.slice(view.start, view.end), view.start),
    [rows, view.start, view.end],
  );

  // Move the browser focus with the roving tabindex, but only while the tree already has it,
  // so opening a note from somewhere else never pulls the focus into the sidebar.
  useLayoutEffect(() => {
    const container = scrollRef.current;
    if (container === null || focusIndex < 0 || !container.contains(document.activeElement)) {
      return;
    }
    document.getElementById(rowId(baseId, focusIndex))?.focus();
  }, [baseId, focusIndex]);

  const activate = useCallback(
    (row: TreeRow) => {
      setFocusPath(row.path);
      if (row.kind === 'folder') {
        toggleFolder(row.path);
      } else {
        onOpen(row.path);
      }
    },
    [onOpen, toggleFolder],
  );

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const action = treeKeyAction(event.key, rows, focusIndex);
    if (action === null) {
      return;
    }
    event.preventDefault();
    if (action.type === 'focus') {
      setFocusPath(rows[action.index]?.path ?? null);
      return;
    }
    setFocusPath(action.path);
    if (action.type === 'toggle') {
      toggleFolder(action.path);
    } else {
      onOpen(action.path);
    }
  };

  // The header button creates in the folder the focus sits in, which is also the keyboard way
  // to the per-folder buttons in the rows.
  const focusedRow = focusIndex < 0 ? undefined : rows[focusIndex];
  const createFolder =
    focusedRow === undefined
      ? ''
      : focusedRow.kind === 'folder'
        ? focusedRow.path
        : folderOf(focusedRow.path);

  return (
    <div className="rz-panel">
      <div className="rz-panel-bar">
        <button
          type="button"
          className="rz-panel-action"
          onClick={() => {
            onCreate(createFolder);
          }}
        >
          {t('tree.newNote')}
        </button>
      </div>

      {rows.length === 0 ? (
        <p className="rz-panel-empty">{t('sidebar.empty')}</p>
      ) : (
        <div
          className="rz-tree-scroll"
          ref={scrollRef}
          onScroll={(event) => {
            setScrollTop(event.currentTarget.scrollTop);
          }}
        >
          <div
            role="tree"
            aria-label={t('tree.label')}
            className="rz-tree"
            style={{
              paddingBlockStart: `${String(view.padTop)}px`,
              paddingBlockEnd: `${String(view.padBottom)}px`,
            }}
            onKeyDown={handleKeyDown}
          >
            {nodes.map((node) => (
              <TreeItem
                key={node.row.path}
                node={node}
                baseId={baseId}
                focusIndex={focusIndex}
                activePath={activePath}
                onActivate={activate}
                onCreate={onCreate}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function rowId(baseId: string, index: number): string {
  return `${baseId}-row-${String(index)}`;
}

interface TreeItemProps {
  node: TreeNode;
  baseId: string;
  focusIndex: number;
  activePath: string | null;
  onActivate: (row: TreeRow) => void;
  onCreate: (folder: string) => void;
}

function TreeItem({ node, baseId, focusIndex, activePath, onActivate, onCreate }: TreeItemProps) {
  const { t } = useTranslation();
  const { row, index, children } = node;
  const isFolder = row.kind === 'folder';
  const labelId = `${baseId}-label-${String(index)}`;

  return (
    <div
      role="treeitem"
      id={rowId(baseId, index)}
      // The name is the row's own label: a folder item contains its children, whose text would
      // otherwise end up in its accessible name.
      aria-labelledby={labelId}
      aria-level={row.level}
      aria-posinset={row.posInSet}
      aria-setsize={row.setSize}
      aria-expanded={isFolder ? row.expanded : undefined}
      aria-selected={isFolder ? undefined : row.path === activePath}
      tabIndex={index === focusIndex ? 0 : -1}
      onClick={(event) => {
        // Items are nested, so a click on a child would otherwise reach its folders as well.
        event.stopPropagation();
        onActivate(row);
      }}
    >
      <span
        className={rowClassName(isFolder, !isFolder && row.path === activePath)}
        style={{ paddingInlineStart: indentOf(row.level) }}
        title={row.path}
      >
        <span className="rz-tree-twisty" aria-hidden="true">
          {isFolder ? (row.expanded ? '▾' : '▸') : ''}
        </span>
        <span className="rz-tree-label" id={labelId}>
          {row.label}
        </span>
        {isFolder && row.noteCount > 0 ? (
          <span className="rz-tree-count">{t('tree.notes', { count: row.noteCount })}</span>
        ) : null}
        {isFolder ? (
          // A shortcut for the mouse. It stays out of the roving tabindex, which belongs to the
          // rows; the panel's own button creates in the focused folder for the keyboard.
          <button
            type="button"
            className="rz-tree-add"
            tabIndex={-1}
            aria-label={t('tree.newNote')}
            title={t('tree.newNote')}
            onClick={(event) => {
              event.stopPropagation();
              onCreate(row.path);
            }}
          >
            +
          </button>
        ) : null}
      </span>

      {children.length > 0 ? (
        <div role="group">
          {children.map((child) => (
            <TreeItem
              key={child.row.path}
              node={child}
              baseId={baseId}
              focusIndex={focusIndex}
              activePath={activePath}
              onActivate={onActivate}
              onCreate={onCreate}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}

function rowClassName(isFolder: boolean, isActive: boolean): string {
  return [
    'rz-tree-row',
    isFolder ? 'rz-tree-row-folder' : 'rz-tree-row-note',
    isActive ? 'rz-tree-row-active' : '',
  ]
    .filter((name) => name !== '')
    .join(' ');
}

function indentOf(level: number): string {
  return `calc(var(--rz-space-2) + ${String(level - 1)} * var(--rz-space-4))`;
}
