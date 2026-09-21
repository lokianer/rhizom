/** The parts of an Obsidian-style wikilink: `[[target#heading|alias]]` or `[[target#^blockId]]`. */
export interface WikilinkTarget {
  /** The note reference as written, trimmed; empty for a link into the same note (`[[#Heading]]`). */
  target: string;
  heading?: string;
  blockId?: string;
  alias?: string;
}

/**
 * Parses the text between `[[` and `]]`. The first `|` starts the alias (later pipes belong to
 * it); the first `#` before that starts a heading, or a block reference when it is followed by `^`.
 *
 * A `\|` is that same separator written so that a GFM table cell does not take it for a column
 * break — Obsidian requires the backslash inside a table and so does Rhizom, so it is stripped
 * here rather than becoming part of the note's name.
 */
export function parseWikilink(inner: string): WikilinkTarget {
  const pipe = inner.indexOf('|');
  // A backslash directly before the separator escaped it; it is not part of the name.
  const reference = (pipe === -1 ? inner : inner.slice(0, pipe)).replace(/\\$/, '');
  const alias = pipe === -1 ? '' : inner.slice(pipe + 1).trim();

  const hash = reference.indexOf('#');
  const target = (hash === -1 ? reference : reference.slice(0, hash)).trim();
  const fragment = hash === -1 ? '' : reference.slice(hash + 1).trim();

  const result: WikilinkTarget = { target };
  if (fragment.startsWith('^')) {
    const blockId = fragment.slice(1).trim();
    if (blockId !== '') {
      result.blockId = blockId;
    }
  } else if (fragment !== '') {
    result.heading = fragment;
  }
  if (alias !== '') {
    result.alias = alias;
  }
  return result;
}
