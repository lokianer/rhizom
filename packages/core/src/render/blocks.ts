// The three things a note writes that become a block of their own rather than running text: a
// paragraph holding nothing but an embed, a query fence, and a diagram fence. Each one answers
// the same way — return the node to put in its place, or undefined to leave what was written —
// so the walk in transform.ts stays a list of cases instead of three nested special cases.
import type { Properties } from 'hast';
import type { Blockquote, Code, Paragraph } from 'mdast';

import { QUERY_LANGUAGE } from '../query/language.js';
import { parseWikilink } from '../syntax/wikilink.js';
import { MERMAID_CLASS, MERMAID_LANGUAGE } from './classes.js';
import { embedKind, labelOf } from './links.js';
import type { Context, EmbedReference } from './note.js';

/**
 * Turns a paragraph that holds nothing but `![[Note]]` into the embedded-note block. Only a
 * standalone embed becomes a block, because a `<div>` inside a `<p>` is not valid HTML; an
 * embed in running text falls through and is rendered as a link.
 */
export function embedParagraph(paragraph: Paragraph, context: Context): boolean {
  const render = context.options.renderEmbed;
  const only = paragraph.children[0];
  if (render === undefined || paragraph.children.length !== 1 || only?.type !== 'wikilink') {
    return false;
  }
  // A paragraph that already names its tag is one this renderer built — a callout's title — and
  // a title is a line of text, not a place to hang a block of transcluded note on.
  if (paragraph.data?.hName !== undefined) {
    return false;
  }
  const parts = parseWikilink(only.value);
  if (!only.embed || embedKind(parts.target) !== 'note') {
    return false;
  }
  const link = context.options.resolveLink(parts.target, 'embed', context.options.sourcePath);
  const reference: EmbedReference = { path: link.path, target: parts.target };
  if (parts.heading !== undefined) {
    reference.heading = parts.heading;
  }
  if (parts.blockId !== undefined) {
    reference.blockId = parts.blockId;
  }
  if (parts.alias !== undefined) {
    reference.alias = parts.alias;
  }
  const result = render(reference);
  if (result === undefined) {
    return false;
  }

  const data = (paragraph.data ??= {});
  data.hName = 'div';
  const properties: Properties = {
    className: ['rz-embed'],
    dataState: result.state,
  };
  if (link.path !== null) {
    properties.dataPath = link.path;
  }
  if (result.state === 'ready') {
    // Replaced by the rendered body after sanitising; the label below is what shows if the
    // marker is ever dropped.
    properties.dataEmbed = String(context.embeds.push(result.html) - 1);
  }
  data.hProperties = properties;
  paragraph.children = [
    {
      type: 'text',
      value: result.state === 'ready' ? labelOf(parts, link, only.value) : result.label,
    },
  ];
  return true;
}

/**
 * Turns a ` ```rhizom-query ` fence into the list or table it describes. It looks like a code
 * block and is written like one, but it is a question about the vault, so it is answered rather
 * than printed — and only when something offers to answer it; without the hook the fence stays
 * the code block every other Markdown tool will show.
 *
 * Undefined leaves the node as it stands. Otherwise the fence becomes a block of its own, which
 * is why the node is replaced instead of relabelled: `code` renders as `<pre><code>`, and the
 * text between the fences is a query, never something to print.
 */
export function queryBlock(node: Code, context: Context): Paragraph | undefined {
  const render = context.options.renderQuery;
  // Folded, because an info string is the author's spelling of a language name and `Rhizom-Query`
  // asks the same question.
  if (render === undefined || node.lang?.trim().toLowerCase() !== QUERY_LANGUAGE) {
    return undefined;
  }
  const html = render(node.value);
  const properties: Properties = {
    className: ['rz-query'],
    dataState: html === undefined ? 'loading' : 'ready',
  };
  if (html !== undefined) {
    // Replaced by the answer after sanitising, the same way an embedded body is.
    properties.dataEmbed = String(context.embeds.push(html) - 1);
  }
  return {
    // Any block node remark-rehype knows will do as the carrier; `hName` decides the tag, and a
    // paragraph is the one with nothing of its own to contribute.
    type: 'paragraph',
    children: [
      { type: 'text', value: html === undefined ? (context.options.queryLoading ?? '') : '' },
    ],
    data: { hName: 'div', hProperties: properties },
  };
}

/**
 * Wraps a ` ```mermaid ` fence in the container the app draws the diagram into, with the fence
 * itself left inside it as an ordinary code block.
 *
 * Nothing is rendered here, and nothing here is asynchronous. Mermaid is a browser library that
 * answers with a promise, while this renderer is a pure function that also runs in tests and on
 * the server — so core marks the place and the app fills it in, the same division the embeds and
 * the query blocks already follow. What core emits is therefore the whole answer for anybody
 * without JavaScript, and it is the diagram's source: exactly what a code block would have shown
 * them. The source stays in the page after the diagram arrives, hidden by the stylesheet, so a
 * theme change can be drawn again from it.
 *
 * Undefined for every other fence, which stays the code block it looks like.
 */
export function mermaidBlock(node: Code): Blockquote | undefined {
  if (node.lang?.trim().toLowerCase() !== MERMAID_LANGUAGE) {
    return undefined;
  }
  return {
    // Any block node remark-rehype knows will do as the carrier, and it has to be one that may
    // hold a code block: a paragraph — what the query fence uses — may not. `hName` decides the
    // tag, so nothing of the blockquote survives into the HTML.
    type: 'blockquote',
    children: [{ type: 'code', lang: MERMAID_LANGUAGE, value: node.value }],
    data: { hName: 'div', hProperties: { className: [MERMAID_CLASS] } },
  };
}
