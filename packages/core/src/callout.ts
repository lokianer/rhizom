// Callouts: a blockquote whose first line names a kind, the way Obsidian writes them.
//
//     > [!warning] Watch the tide
//     > The causeway floods twice a day.
//
// A vault written somewhere else has to open right here, so every spelling Obsidian accepts is
// recognised and folded onto the small set a stylesheet can colour. A word nobody knows is still
// a callout: it is drawn as a `note` and keeps the word the note wrote as its title, because
// guessing at a colour for `[!houserule]` would be worse than showing the plain one.
//
// The kind reaches the HTML as a class and nothing else, and a foldable callout is a `<details>`,
// so both work in a page that never runs a line of JavaScript. Core carries no language, so the
// word that stands in for a missing title comes from the app through `RenderOptions.calloutLabels`
// — `CALLOUT_KINDS` is exported so that it cannot forget one.
import type { Properties } from 'hast';
import type { Blockquote, PhrasingContent } from 'mdast';

/** Every kind a callout can be drawn as. The app gives each one a word; the stylesheet, a colour. */
export const CALLOUT_KINDS = [
  'note',
  'abstract',
  'info',
  'todo',
  'tip',
  'success',
  'question',
  'warning',
  'failure',
  'danger',
  'bug',
  'example',
  'quote',
] as const;

export type CalloutKind = (typeof CALLOUT_KINDS)[number];

/**
 * A word for each kind, shown as the title of a callout that was written without one. A full
 * record rather than a partial one on purpose: the app that adds a language has to answer for
 * every kind, and the compiler says so.
 */
export type CalloutLabels = Record<CalloutKind, string>;

/**
 * The spellings Obsidian knows, folded onto the kind that is drawn. Every kind names itself too,
 * so this table alone decides what is recognised.
 */
export const CALLOUT_ALIASES: Readonly<Record<string, CalloutKind>> = {
  note: 'note',
  abstract: 'abstract',
  summary: 'abstract',
  tldr: 'abstract',
  info: 'info',
  todo: 'todo',
  tip: 'tip',
  hint: 'tip',
  important: 'tip',
  success: 'success',
  check: 'success',
  done: 'success',
  question: 'question',
  help: 'question',
  faq: 'question',
  warning: 'warning',
  caution: 'warning',
  attention: 'warning',
  failure: 'failure',
  fail: 'failure',
  missing: 'failure',
  danger: 'danger',
  error: 'danger',
  bug: 'bug',
  example: 'example',
  quote: 'quote',
  cite: 'quote',
};

/**
 * The kind a written word means, or undefined when nobody knows the word. Case does not matter:
 * `[!Warning]` and `[!warning]` are the same thing to every editor that reads these.
 */
export function calloutKindOf(word: string): CalloutKind | undefined {
  return CALLOUT_ALIASES[word.trim().toLowerCase()];
}

// The whole header: the kind in brackets, the fold marker, and the space before the title. It has
// to open the blockquote — a `[!` further in is prose and stays prose.
const HEADER = /^[ \t]*\[!([^\]\n]*)\]([+-]?)[ \t]*/;

type BlockNode = Blockquote['children'][number];

/**
 * Turns a blockquote into a callout, in place. False means its first line named no kind, and the
 * node is left untouched — an ordinary quotation is the far commoner thing to write.
 *
 * The result is a `<div class="rz-callout rz-callout-<kind>">` holding a title and a body, or the
 * same thing as a `<details>` when the author marked it foldable: `+` open, `-` folded. Without a
 * marker the callout is not foldable at all, which is the one shape a `<details>` cannot be.
 */
export function applyCallout(node: Blockquote, labels: CalloutLabels | undefined): boolean {
  // A callout's body is carried in a blockquote of its own (below), and the first paragraph of a
  // body may perfectly well start with a `[!` of its own. Anything that already names its tag has
  // been through here and is not a blockquote the author wrote.
  if (node.data?.hName !== undefined) {
    return false;
  }
  const first = node.children[0];
  if (first?.type !== 'paragraph') {
    return false;
  }
  const opener = first.children[0];
  if (opener?.type !== 'text') {
    return false;
  }
  const header = HEADER.exec(opener.value);
  if (header === null) {
    return false;
  }
  const written = (header[1] ?? '').trim();
  if (written === '') {
    // `[!]` names nothing, so there is nothing to draw it as: it stays the blockquote it is.
    return false;
  }

  const kind = calloutKindOf(written);
  const marker = header[2] ?? '';
  // What follows the header on that line is the title; the rest of the paragraph is already body.
  const line = splitFirstLine([
    { type: 'text', value: opener.value.slice(header[0].length) },
    ...first.children.slice(1),
  ]);
  const title: PhrasingContent[] = hasContent(line.title)
    ? line.title
    : // No title of its own: the kind's word, in the app's language when it supplied one. An
      // unknown kind has no word to look up, so it keeps the one the note wrote.
      [{ type: 'text', value: kind === undefined ? written : (labels?.[kind] ?? written) }];

  const body: BlockNode[] = node.children.slice(1);
  if (hasContent(line.rest)) {
    body.unshift({ type: 'paragraph', children: line.rest });
  }

  const foldable = marker !== '';
  const properties: Properties = {
    className: ['rz-callout', `rz-callout-${kind ?? 'note'}`],
  };
  if (marker === '+') {
    properties.open = true;
  }
  const data = (node.data ??= {});
  data.hName = foldable ? 'details' : 'div';
  data.hProperties = properties;

  const children: BlockNode[] = [
    {
      // A paragraph is the block node that contributes nothing of its own; `hName` decides what
      // it becomes. `<summary>` is what makes a `<details>` fold without JavaScript.
      type: 'paragraph',
      children: title,
      data: {
        hName: foldable ? 'summary' : 'div',
        hProperties: { className: ['rz-callout-title'] },
      },
    },
  ];
  if (body.length > 0) {
    children.push({
      // A blockquote again, because it is the mdast node that holds blocks and nothing else; the
      // tag it becomes is a plain div. A callout with a title and no body gets no body element.
      type: 'blockquote',
      children: body,
      data: { hName: 'div', hProperties: { className: ['rz-callout-body'] } },
    });
  }
  node.children = children;
  return true;
}

/**
 * Splits the inline content of the first paragraph at its first line break. A callout's title is
 * one line: `> [!note] Title` followed by `> body` is a single paragraph to Markdown, and without
 * this the body would be read as part of the title.
 */
function splitFirstLine(children: PhrasingContent[]): {
  title: PhrasingContent[];
  rest: PhrasingContent[];
} {
  const title: PhrasingContent[] = [];
  for (let index = 0; index < children.length; index += 1) {
    const child = children[index];
    if (child === undefined) {
      continue;
    }
    // Two trailing spaces end the line just as plainly as the newline does.
    if (child.type === 'break') {
      return { title, rest: children.slice(index + 1) };
    }
    if (child.type === 'text') {
      const brk = child.value.indexOf('\n');
      if (brk !== -1) {
        // `trimEnd` also takes the `\r` of a file written on Windows.
        const head = child.value.slice(0, brk).trimEnd();
        const tail = child.value.slice(brk + 1);
        if (head !== '') {
          title.push({ type: 'text', value: head });
        }
        const rest: PhrasingContent[] = tail === '' ? [] : [{ type: 'text', value: tail }];
        rest.push(...children.slice(index + 1));
        return { title, rest };
      }
      if (child.value === '') {
        continue;
      }
    }
    title.push(child);
  }
  return { title, rest: [] };
}

/** Whether a run of inline nodes says anything, or is only the whitespace around a line break. */
function hasContent(children: readonly PhrasingContent[]): boolean {
  return children.some((child) => child.type !== 'text' || child.value.trim() !== '');
}
