import { describe, expect, it } from 'vitest';

import { queryBlocks } from './query-blocks.js';

describe('queryBlocks', () => {
  it('takes the text between the fences, in the order the note writes them', () => {
    expect(
      queryBlocks(
        '# Open\n\n```rhizom-query\nfrom: Research\n```\n\nand\n\n```rhizom-query\ntag: campaign\n```\n',
      ),
    ).toEqual(['from: Research', 'tag: campaign']);
  });

  it('takes a tilde fence and an indented one too', () => {
    expect(queryBlocks('~~~rhizom-query\nfrom: A\n~~~\n')).toEqual(['from: A']);
    expect(queryBlocks('- item\n\n  ```rhizom-query\n  from: A\n  ```\n')).toEqual(['from: A']);
  });

  it('leaves a block of another language alone', () => {
    expect(queryBlocks('```js\nfrom: Research\n```\n')).toEqual([]);
    expect(queryBlocks('```\nfrom: Research\n```\n')).toEqual([]);
    expect(queryBlocks('```rhizom-queryish\nfrom: A\n```\n')).toEqual([]);
  });

  it('leaves a query block that is itself an example inside another fence', () => {
    // Four backticks hold three, which is how a note shows what a query block looks like. That
    // is prose about queries, not a query, and the renderer does not run it either.
    expect(queryBlocks('````\n```rhizom-query\nfrom: A\n```\n````\n')).toEqual([]);
  });

  it('does not read the frontmatter as content', () => {
    expect(queryBlocks('---\ntype: query\n---\n\n```rhizom-query\nfrom: A\n```\n')).toEqual([
      'from: A',
    ]);
  });

  it('has nothing to say about a note without one', () => {
    expect(queryBlocks('')).toEqual([]);
    expect(queryBlocks('# Just prose\n\nwith a `rhizom-query` word in it.\n')).toEqual([]);
  });
});
