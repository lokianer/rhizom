// The answered side of a query block: a `QueryResult` drawn as the list, table or cards the
// block asked for.
//
// Everything here is assembled as a hast tree and stringified with the same compiler the note
// renderer uses, never by pasting text into a template. That is deliberate. A row carries a
// title, a folder, a tag and whatever the frontmatter said, and all four are text out of a vault
// that may have arrived as somebody else's zip — a note whose title is `<script>` must show up in
// a table as those eight characters and nothing else. Building nodes rather than strings makes
// that the default instead of something to remember: a text node is escaped when it is written
// out, and an attribute value with it.
//
// The words are the caller's, because core carries no language, and so are the hrefs: a link to a
// note goes through the same `resolveLink` the rest of the renderer uses, so a click inside a
// query result lands where every other note link lands.
import type { Element, ElementContent, Properties, Root as HastRoot, Text } from 'hast';
import rehypeStringify from 'rehype-stringify';
import { unified } from 'unified';

import type { LinkKind, QueryResult, QueryRow } from './api.js';
import { BUILT_IN_COLUMNS } from './query.js';
import { noteLinkProperties, type RenderedLink } from './render.js';

/** A column a result can show without asking the note for anything; `BUILT_IN_COLUMNS` in full. */
export type BuiltInColumn = 'title' | 'path' | 'folder' | 'tags' | 'modified' | 'size';

/**
 * The words a rendered result needs. Core carries no language, so the app supplies them, the way
 * `EmbedLabels` supplies the words a placeholder needs.
 */
export interface QueryLabels {
  /** Nothing matched. */
  empty: string;
  /** Shown in place of a block whose answer has not arrived yet; see `RenderOptions.queryLoading`. */
  loading: string;
  /**
   * One thing the block said that could not be read. `line` is 1-based inside the block body and
   * 0 when the complaint is about the body as a whole, which the caller words differently.
   */
  problem: (line: number, message: string) => string;
  /** The footer under a list the query's own `limit` cut short. */
  more: (shown: number, total: number) => string;
  /** The heading of each built-in column. Any other column is a frontmatter key, shown as written. */
  columns: Record<BuiltInColumn, string>;
}

/**
 * Where a link out of a result leads. This is the renderer's own resolver rather than a scheme of
 * its own, so a note link in a query result is the same link it would be in prose: same href, same
 * classes, same behaviour when the note is not there.
 */
export interface QueryLinks {
  /** The note the block stands in; a link resolves relative to it. */
  sourcePath: string;
  resolveLink: (target: string, kind: LinkKind, source: string) => RenderedLink;
}

/**
 * What a table shows when the block named no columns. The title says which note a row is, and the
 * date is the one built-in column a reader looks at without having asked for it; anything more
 * would be guessing at what the query was for.
 */
const DEFAULT_TABLE_COLUMNS: readonly string[] = ['title', 'modified'];

const BUILT_IN: ReadonlySet<string> = new Set(BUILT_IN_COLUMNS);

// Only a compiler, no parser and no plugins: the tree is built here, never read from text. It is
// the same stringifier the note renderer ends with, minus `allowDangerousHtml` — there is no raw
// node in what this module builds, and there is to be no way to introduce one.
const compiler = unified().use(rehypeStringify).freeze();

/**
 * The HTML of one answered block. The caller puts it inside the element the renderer emitted for
 * the fence, so this is a fragment: the view, then the footer for a list that was cut short, then
 * whatever the block said that could not be read.
 */
export function renderQueryResult(
  result: QueryResult,
  labels: QueryLabels,
  links: QueryLinks,
): string {
  const children: ElementContent[] = [];
  if (result.rows.length > 0) {
    children.push(view(result, labels, links));
  } else if (result.problems.length === 0) {
    // With a complaint on screen there is no claim to make about the vault: the block was not
    // read as written, so "nothing matches" would be an answer to a question nobody asked.
    children.push(element('p', { className: ['rz-query-empty'] }, [text(labels.empty)]));
  }
  if (result.total > result.rows.length) {
    children.push(
      element('p', { className: ['rz-query-more'] }, [
        text(labels.more(result.rows.length, result.total)),
      ]),
    );
  }
  if (result.problems.length > 0) {
    children.push(
      element(
        'ul',
        { className: ['rz-query-problems'] },
        result.problems.map((problem) =>
          element('li', {}, [text(labels.problem(problem.line, problem.message))]),
        ),
      ),
    );
  }

  const root: HastRoot = { type: 'root', children };
  return compiler.stringify(root);
}

function view(result: QueryResult, labels: QueryLabels, links: QueryLinks): Element {
  switch (result.view) {
    case 'table':
      return table(result, labels, links);
    case 'cards':
      return cards(result, labels, links);
    default:
      return element(
        'ul',
        { className: ['rz-query-list'] },
        result.rows.map((row) => element('li', {}, [noteLink(row, links, titleOf(row))])),
      );
  }
}

function table(result: QueryResult, labels: QueryLabels, links: QueryLinks): Element {
  const columns = result.columns.length > 0 ? result.columns : DEFAULT_TABLE_COLUMNS;
  const head = element('thead', {}, [
    element(
      'tr',
      {},
      columns.map((column) => element('th', { scope: 'col' }, [text(headingOf(column, labels))])),
    ),
  ]);
  const body = element(
    'tbody',
    {},
    result.rows.map((row) =>
      element(
        'tr',
        {},
        columns.map((column) => element('td', {}, cell(row, column, links))),
      ),
    ),
  );
  return element('table', { className: ['rz-query-table'] }, [head, body]);
}

function cards(result: QueryResult, labels: QueryLabels, links: QueryLinks): Element {
  return element(
    'ul',
    { className: ['rz-query-cards'] },
    result.rows.map((row) => {
      const meta: ElementContent[] = [];
      if (row.folder !== '') {
        meta.push(element('span', { className: ['rz-query-folder'] }, [text(row.folder)]));
      }
      meta.push(...tags(row));
      meta.push(element('span', { className: ['rz-query-date'] }, [text(dateOf(row.modifiedAt))]));
      return element('li', { className: ['rz-query-card'] }, [
        element('p', { className: ['rz-query-card-title'] }, [noteLink(row, links, titleOf(row))]),
        element('p', { className: ['rz-query-meta'] }, meta),
      ]);
    }),
  );
}

/** What one cell of a table holds: a built-in taken off the row, anything else off its fields. */
function cell(row: QueryRow, column: string, links: QueryLinks): ElementContent[] {
  switch (column) {
    case 'title':
      return [noteLink(row, links, titleOf(row))];
    // A path is a link too: a table of paths alone should still get the reader to the note.
    case 'path':
      return [noteLink(row, links, row.path)];
    case 'folder':
      return [text(row.folder)];
    case 'tags':
      return tags(row);
    // A date and a size are each one word, marked as such so a narrow column does not break
    // `2026-09-20` over two lines and make the table look wrong.
    case 'modified':
      return [element('span', { className: ['rz-query-date'] }, [text(dateOf(row.modifiedAt))])];
    case 'size':
      return [element('span', { className: ['rz-query-date'] }, [text(sizeOf(row.size))])];
    default:
      // The server has already turned the frontmatter value into text; whatever it says is text.
      return [text(row.fields[column] ?? '')];
  }
}

function tags(row: QueryRow): ElementContent[] {
  return row.tags.map((tag) => element('span', { className: ['rz-query-tag'] }, [text(`#${tag}`)]));
}

function noteLink(row: QueryRow, links: QueryLinks, label: string): Element {
  const link = links.resolveLink(row.path, 'markdown', links.sourcePath);
  return element('a', { ...noteLinkProperties(link, row.path), href: link.href }, [text(label)]);
}

/** A built-in column's heading is a word; any other is a frontmatter key, shown as the note wrote it. */
function headingOf(column: string, labels: QueryLabels): string {
  return BUILT_IN.has(column) ? labels.columns[column as BuiltInColumn] : column;
}

/** The index guarantees a title, but a row without one should still lead somewhere readable. */
function titleOf(row: QueryRow): string {
  return row.title === '' ? row.path : row.title;
}

/**
 * The day, out of the ISO timestamp the API sends. Not a formatted date: core knows no locale,
 * and `2026-09-20` is read the same way everywhere and sorts by eye.
 */
function dateOf(timestamp: string): string {
  return /^\d{4}-\d{2}-\d{2}/.test(timestamp) ? timestamp.slice(0, 10) : timestamp;
}

const SIZE_UNITS: readonly string[] = ['B', 'kB', 'MB', 'GB'];

/** A file size in SI units — symbols rather than words, so they need no translation. */
function sizeOf(bytes: number): string {
  let value = bytes;
  let unit = 0;
  while (value >= 1000 && unit < SIZE_UNITS.length - 1) {
    value /= 1000;
    unit += 1;
  }
  const rounded = unit === 0 ? String(Math.round(value)) : value.toFixed(1);
  return `${rounded} ${SIZE_UNITS[unit] ?? 'B'}`;
}

function element(tagName: string, properties: Properties, children: ElementContent[]): Element {
  return { type: 'element', tagName, properties, children };
}

function text(value: string): Text {
  return { type: 'text', value };
}
