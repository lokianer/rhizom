// Finding the query blocks in a note.
//
// A note that declares `type: query` is a saved search: the sidebar shows it as a folder and
// fills it by running the block inside it. So something has to get from a note's text to the
// text between its fences, and it has to agree with the renderer about what counts as a fence —
// a `rhizom-query` line inside another fenced block is a line of example code, not a query.
//
// Hence the parser rather than a scan for three backticks: the same reading, one answer.
import type { Nodes, Parent } from 'mdast';
import remarkFrontmatter from 'remark-frontmatter';
import remarkParse from 'remark-parse';
import { unified } from 'unified';

import { QUERY_LANGUAGE } from './language.js';

// Frontmatter only: a query block is a fence at the top level of a note, and neither GFM nor
// wikilinks change where one begins.
const parser = unified().use(remarkParse).use(remarkFrontmatter, ['yaml']).freeze();

/** The text inside each `rhizom-query` block, in the order the note writes them. */
export function queryBlocks(markdown: string): string[] {
  const bodies: string[] = [];
  const walk = (node: Nodes): void => {
    if (node.type === 'code') {
      if (node.lang === QUERY_LANGUAGE) {
        bodies.push(node.value);
      }
      return;
    }
    if ('children' in node) {
      for (const child of (node as Parent).children) {
        walk(child);
      }
    }
  };
  walk(parser.parse(markdown));
  return bodies;
}
