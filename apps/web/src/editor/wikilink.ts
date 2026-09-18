// Lezer inline syntax for Obsidian-style links: `[[target]]`, `[[target|alias]]`,
// `[[target#heading]]` and `![[embed]]`. Parsing them into real syntax nodes — instead of
// matching regexes over the text — is what lets live preview, the `[[` completion and click
// handling all agree on one structure.
import { Tag, tags } from '@lezer/highlight';
import type { Element as MarkdownElement, MarkdownConfig } from '@lezer/markdown';

/** Sub-tag of `tags.link`, so a style for links also covers wikilinks unless one targets this. */
export const wikiLinkTag = Tag.define('wikilink', tags.link);

const BANG = 33;
const NEWLINE = 10;
const BRACKET_OPEN = 91;
const BRACKET_CLOSE = 93;
const PIPE = 124;

export const wikilinkExtension: MarkdownConfig = {
  defineNodes: [
    { name: 'WikiLink' },
    { name: 'WikiEmbed' },
    { name: 'WikiLinkMark', style: tags.processingInstruction },
    { name: 'WikiLinkTarget', style: wikiLinkTag },
    { name: 'WikiLinkAlias', style: wikiLinkTag },
  ],
  parseInline: [
    {
      name: 'WikiLink',
      // Before the CommonMark link parser, which would otherwise claim `[` and `![` first.
      before: 'Link',
      parse(cx, next, pos) {
        const embed = next === BANG;
        const start = embed ? pos + 1 : pos;
        if (cx.char(start) !== BRACKET_OPEN || cx.char(start + 1) !== BRACKET_OPEN) {
          return -1;
        }
        let pipe = -1;
        let close = -1;
        // `char()` past the end of the inline section yields NaN, so stay one char inside it.
        for (let at = start + 2; at + 1 < cx.end; at += 1) {
          const code = cx.char(at);
          if (code === NEWLINE || code === BRACKET_OPEN) {
            return -1;
          }
          if (code === PIPE && pipe === -1) {
            pipe = at;
          }
          if (code === BRACKET_CLOSE && cx.char(at + 1) === BRACKET_CLOSE) {
            close = at;
            break;
          }
        }
        if (close === -1) {
          return -1;
        }
        const targetEnd = pipe === -1 ? close : pipe;
        if (targetEnd === start + 2) {
          return -1; // `[[]]` is not a link
        }

        const children: MarkdownElement[] = [
          cx.elt('WikiLinkMark', start, start + 2),
          cx.elt('WikiLinkTarget', start + 2, targetEnd),
        ];
        if (pipe !== -1) {
          children.push(cx.elt('WikiLinkMark', pipe, pipe + 1));
          if (close > pipe + 1) {
            children.push(cx.elt('WikiLinkAlias', pipe + 1, close));
          }
        }
        children.push(cx.elt('WikiLinkMark', close, close + 2));
        const link = cx.elt('WikiLink', start, close + 2, children);
        if (!embed) {
          return cx.addElement(link);
        }
        // The leading `!` is a mark of its own so live preview hides it with the brackets.
        return cx.addElement(
          cx.elt('WikiEmbed', pos, close + 2, [cx.elt('WikiLinkMark', pos, pos + 1), link]),
        );
      },
    },
  ],
};
