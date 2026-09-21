// The walk over the parsed note, before it becomes HTML. Everything that changes a node rather
// than the pipeline happens here: wikilinks and embeds become links, a defined term gets its
// mark, a callout and a query fence and a diagram each become the element the app styles, and
// task items are labelled with the line they came from. The headings are collected on the way
// in, the embedded bodies are put back on the way out.
import GithubSlugger from 'github-slugger';
import type { Properties, Root as HastRoot } from 'hast';
import type { List, Parent, Root, RootContent, Text } from 'mdast';
import { visit } from 'unist-util-visit';

import type { Heading } from '../api.js';
import { applyCallout } from '../syntax/callout.js';
import { displayText } from '../syntax/parse.js';
import { blockAnchorId, type BlockMarker } from '../syntax/section.js';
import type { VaultTerm } from '../vault/terms.js';
import { renderWikilink, rewriteImage, rewriteLink } from './links.js';
import type { Context } from './note.js';
import { embedParagraph, mermaidBlock, queryBlock } from './blocks.js';

/**
 * Collects the headings and gives each one its id. The text comes from the untouched mdast tree
 * so that it matches `parseNote`, and the slugger is per note so that duplicate headings get
 * the same `-1`, `-2` suffixes there as here.
 */
export function collectHeadings(tree: Root, idPrefix: string): Heading[] {
  const slugger = new GithubSlugger();
  const headings: Heading[] = [];
  visit(tree, 'heading', (node) => {
    const text = displayText(node);
    const slug = slugger.slug(text);
    // The reported slug stays bare, so an outline and a `#fragment` agree with `parseNote`;
    // only the id written into the page carries the prefix that keeps it unique there.
    headings.push({ level: node.depth, text, slug, line: node.position?.start.line ?? 0 });
    const data = (node.data ??= {});
    data.hProperties = { ...data.hProperties, id: `${idPrefix}${slug}` };
  });
  return headings;
}

/**
 * Takes the `^id` off the text the reader sees. The marker is an address, written for a link to
 * aim at and never meant to be read: Obsidian hides it, and a vault that has to open in both
 * cannot show it in one of them.
 *
 * A text node holding nothing but the marker is dropped rather than left empty, so that
 * `![[Note]] ^abc` is still the standalone embed it was written as.
 */
export function hideBlockMarkers(markers: readonly BlockMarker[]): void {
  for (const marker of markers) {
    marker.text.value = marker.text.value.slice(0, marker.offset);
    if (marker.text.value !== '') {
      continue;
    }
    const children = marker.parent.children;
    const at = children.indexOf(marker.text);
    if (at !== -1) {
      children.splice(at, 1);
    }
  }
}

/**
 * Gives every block that carries an id the anchor a link to it lands on, prefixed like every
 * other id this render emits so that a transcluded note's blocks cannot collide with the host's.
 *
 * After `transform` rather than before it: a callout writes its own properties over the
 * blockquote's and would take the anchor with them.
 *
 * A heading is the one block that keeps the id it already has. An element has one id to give,
 * and a heading's is its slug — what `parseNote` reports, what the outline links to, what every
 * `#Heading` reference aims at. A block id written on a heading still addresses it for an embed;
 * it just does not move the anchor.
 */
export function anchorBlocks(markers: readonly BlockMarker[], idPrefix: string): void {
  for (const marker of markers) {
    if (marker.block.type === 'heading') {
      continue;
    }
    const data = (marker.block.data ??= {});
    data.hProperties = { ...data.hProperties, id: `${idPrefix}${blockAnchorId(marker.id)}` };
  }
}

/** Rewrites every node whose target points into the vault; the rest stays untouched. */
export function transform(parent: Parent, context: Context, insideLink: boolean): void {
  const children = parent.children;
  for (let index = 0; index < children.length; index += 1) {
    const child = children[index];
    if (child === undefined) {
      continue;
    }
    if (child.type === 'paragraph' && embedParagraph(child, context)) {
      continue;
    }
    if (child.type === 'code') {
      const block = queryBlock(child, context) ?? mermaidBlock(child);
      if (block !== undefined) {
        children[index] = block;
      }
      continue;
    }
    if (child.type === 'wikilink') {
      children[index] = renderWikilink(child.value, child.embed, context);
      continue;
    }
    // Only running text carries term marks. Code is a leaf node and never reaches this branch;
    // a wikilink was replaced above; a link is skipped so a word does not end up with two
    // things to click.
    if (child.type === 'text' && !insideLink) {
      const marked = markTerms(child, context);
      if (marked !== undefined) {
        // Spliced by assignment rather than with a spread: a text node can hold more matches
        // than the engine allows arguments, and `splice(i, 1, ...pieces)` would throw on it.
        children.splice(index, 1);
        for (const [offset, piece] of marked.entries()) {
          children.splice(index + offset, 0, piece);
        }
        index += marked.length - 1;
        continue;
      }
    }
    if (child.type === 'link') {
      rewriteLink(child, context);
    } else if (child.type === 'image') {
      rewriteImage(child, context);
    } else if (child.type === 'blockquote') {
      // A callout is a blockquote that named a kind; everything else stays a quotation. Either
      // way the walk goes on into it below, so a callout's body is rendered like any other prose.
      applyCallout(child, context.options.calloutLabels);
    } else if (child.type === 'list') {
      markTasks(child);
    }
    if ('children' in child) {
      transform(
        child,
        context,
        insideLink || child.type === 'link' || child.type === 'linkReference',
      );
    }
  }
}

/**
 * Splits one text node around the terms the vault defines. Undefined when it holds none, so the
 * overwhelmingly common case allocates nothing.
 *
 * A definition never marks itself: reading the note that defines a word should not present that
 * word as something to look up.
 */
function markTerms(node: Text, context: Context): RootContent[] | undefined {
  const matcher = context.options.terms;
  if (matcher === undefined) {
    return undefined;
  }
  const matches = matcher
    .find(node.value)
    .filter((match) => match.term.path !== context.options.sourcePath);
  if (matches.length === 0) {
    return undefined;
  }

  const pieces: RootContent[] = [];
  let at = 0;
  for (const match of matches) {
    if (match.start > at) {
      pieces.push({ type: 'text', value: node.value.slice(at, match.start) });
    }
    pieces.push({
      // Any node remark-rehype knows will do as the carrier; `hName` decides the tag, and
      // emphasis is the least loaded of the inline containers.
      type: 'emphasis',
      children: [{ type: 'text', value: match.text }],
      data: { hName: 'span', hProperties: termProperties(match.term) },
    });
    at = match.end;
  }
  if (at < node.value.length) {
    pieces.push({ type: 'text', value: node.value.slice(at) });
  }
  return pieces;
}

function termProperties(term: VaultTerm): Properties {
  const properties: Properties = { className: ['rz-term'], dataTerm: term.path };
  if (term.summary !== '') {
    // `title` is allowed on every element by the default schema, so the plainest tooltip there
    // is needs no JavaScript and works in the wiki as well as in the preview.
    properties.title = term.summary;
  }
  return properties;
}

/**
 * Marks a list whose items are tasks — `- [ ]` and `- [x]` — so the stylesheet can drop the
 * bullets the checkboxes stand in for and strike a finished one through. The list is a task list
 * as soon as one item is a task, which is how Markdown writes a list of them.
 *
 * remark-rehype puts a real checkbox in front of the item's content; it renders it disabled, and
 * this leaves it that way. Ticking a box has to write the box back into the Markdown file it came
 * from, and that is a later slice — a box that took the click and then forgot it would be worse
 * than one that plainly cannot be clicked.
 */
function markTasks(list: List): void {
  const tasks = list.children.filter((item) => typeof item.checked === 'boolean');
  if (tasks.length === 0) {
    return;
  }
  // The classes replace the GitHub ones remark-rehype writes: one vocabulary in the page, and
  // `rz-` is the one the stylesheet knows.
  const data = (list.data ??= {});
  data.hProperties = { ...data.hProperties, className: ['rz-tasks'] };
  for (const item of tasks) {
    const itemData = (item.data ??= {});
    itemData.hProperties = {
      ...itemData.hProperties,
      className: item.checked === true ? ['rz-task', 'rz-task-done'] : ['rz-task'],
      // The line the box stands on, so that ticking one in the rendered view can find the `[ ]`
      // it belongs to in the note's own text. It is the line rather than an offset because the
      // reader may have typed above it since this HTML was made, and a line survives that
      // better than a character count; the writer checks the line before touching it anyway.
      ...(item.position === undefined ? {} : { dataTaskLine: item.position.start.line }),
    };
  }
}

/**
 * Puts the embedded bodies and the answered query blocks in place; they are already HTML and
 * must not be escaped again.
 *
 * This runs *after* `rehypeSanitize` and the result is stringified with `allowDangerousHtml`,
 * so whatever reaches here is written into the page untouched. Exactly two producers of such a
 * string are acceptable: `renderNote` itself, which is why `EmbedResult.ready` is the one state
 * that carries HTML, and `renderQueryResult`, which assembles a tree of nodes and stringifies it
 * with the same compiler rather than pasting text into a template — nothing out of a note or an
 * index can become markup on the way through it. Widening that further — `rehype-raw`, a string
 * built by hand, anything — turns a tool whose whole point is opening somebody else's vault into
 * stored cross-site scripting.
 */
export function fillEmbeds(tree: HastRoot, embeds: readonly string[]): void {
  if (embeds.length === 0) {
    return;
  }
  visit(tree, 'element', (element) => {
    const marker = element.properties.dataEmbed;
    if (typeof marker !== 'string') {
      return;
    }
    element.properties.dataEmbed = undefined;
    const body = embeds[Number(marker)];
    if (body !== undefined) {
      element.children = [{ type: 'raw', value: body }];
    }
  });
}
