import { describe, expect, it } from 'vitest';

import {
  BUILT_IN_COLUMNS,
  parseQuery,
  QUERY_KEYS,
  QUERY_LANGUAGE,
  QUERY_SORTS,
  QUERY_VIEWS,
  type Query,
} from './query.js';

/** What a query says before a body has said anything. */
const DEFAULTS: Query = {
  folders: [],
  types: [],
  tags: [],
  title: null,
  linksTo: [],
  where: [],
  sort: 'title',
  descending: false,
  limit: 100,
  view: 'list',
  columns: [],
};

/** The query, for the cases where the body is expected to be understood completely. */
function query(body: string): Query {
  const parsed = parseQuery(body);
  expect(parsed.problems).toEqual([]);
  return parsed.query;
}

describe('the closed vocabulary', () => {
  it('names the fence it belongs to and the keys it accepts', () => {
    expect(QUERY_LANGUAGE).toBe('rhizom-query');
    expect(QUERY_KEYS).toEqual([
      'from',
      'type',
      'tag',
      'title',
      'linksTo',
      'where',
      'sort',
      'limit',
      'as',
      'columns',
    ]);
    expect(QUERY_SORTS).toEqual(['title', 'path', 'modified', 'created']);
    expect(QUERY_VIEWS).toEqual(['list', 'table', 'cards']);
    expect(BUILT_IN_COLUMNS).toEqual(['title', 'path', 'folder', 'tags', 'modified', 'size']);
  });
});

describe('parseQuery', () => {
  it('reads a body that says nothing as the whole vault', () => {
    expect(parseQuery('')).toEqual({ query: DEFAULTS, problems: [] });
    expect(parseQuery('   \n\n ')).toEqual({ query: DEFAULTS, problems: [] });
    // A body of nothing but comments asks for nothing in particular either.
    expect(parseQuery('# everything, then\n')).toEqual({ query: DEFAULTS, problems: [] });
  });

  it('reads every key on its own', () => {
    expect(query('from: [Campaign, Notes]').folders).toEqual(['Campaign', 'Notes']);
    expect(query('type: [definition, template]').types).toEqual(['definition', 'template']);
    expect(query('tag: [campaign/npcs, lore]').tags).toEqual(['campaign/npcs', 'lore']);
    expect(query('title: Session').title).toBe('Session');
    expect(query('linksTo: [Campaign/Mira.md, Ravenloft]').linksTo).toEqual([
      'Campaign/Mira.md',
      'Ravenloft',
    ]);
    expect(query('where:\n  status: open').where).toEqual([{ key: 'status', values: ['open'] }]);
    expect(query('sort: modified')).toMatchObject({ sort: 'modified', descending: false });
    expect(query('limit: 25').limit).toBe(25);
    expect(query('as: cards').view).toBe('cards');
    expect(query('as: table\ncolumns: [title, status]').columns).toEqual(['title', 'status']);
  });

  it('accepts a single string wherever a list is allowed', () => {
    expect(query('from: Campaign').folders).toEqual(['Campaign']);
    expect(query('type: definition').types).toEqual(['definition']);
    expect(query('tag: lore').tags).toEqual(['lore']);
    expect(query('linksTo: Mira').linksTo).toEqual(['Mira']);
    expect(query('as: table\ncolumns: path').columns).toEqual(['path']);
  });

  it('ANDs the keys and keeps the defaults for the ones a body leaves out', () => {
    const parsed = parseQuery('from: Campaign\ntag: npcs\nlimit: 10');
    expect(parsed.problems).toEqual([]);
    expect(parsed.query).toEqual({
      ...DEFAULTS,
      folders: ['Campaign'],
      tags: ['npcs'],
      limit: 10,
    });
  });

  it('ignores the case of a key, because ten words fold without colliding', () => {
    expect(query('From: Campaign\nLinksTo: Mira')).toMatchObject({
      folders: ['Campaign'],
      linksTo: ['Mira'],
    });
  });

  it('drops empty entries instead of filtering on nothing', () => {
    expect(query('from:\ntag: ["", "  "]\ntitle: "   "')).toEqual(DEFAULTS);
    // A key with nothing behind it says nothing, and every default stands.
    expect(query('sort:\nas:\nlimit:\nwhere:\ncolumns:')).toEqual(DEFAULTS);
    // Entries that normalise away are dropped too: a slash is not a folder and a hash is not a tag.
    expect(query('from: "/"\ntag: "#"')).toEqual(DEFAULTS);
  });

  it('reads a number in quotes as the number it says', () => {
    // YAML's types are an accident of spelling, so a pair of quotes is not a reason to refuse
    // something that says exactly what it means.
    expect(query('limit: "50"').limit).toBe(50);
  });

  it('drops duplicates within a filter', () => {
    expect(query('tag: [lore, Lore, "#lore"]').tags).toEqual(['lore']);
  });
});

describe('what a query cannot be read as', () => {
  it('refuses a body that is not a list of keys', () => {
    const parsed = parseQuery('- Campaign\n- Notes');
    expect(parsed.query).toEqual(DEFAULTS);
    expect(parsed.problems).toEqual([
      { line: 0, message: 'A query is written as `key: value` lines, one key per line.' },
    ]);
  });

  it('reports an unknown key with its line and reads the rest of the block', () => {
    const parsed = parseQuery('from: Campaign\nrecursive: yes\ntag: npcs');
    expect(parsed.problems).toHaveLength(1);
    expect(parsed.problems[0]?.line).toBe(2);
    expect(parsed.problems[0]?.message).toContain('`recursive` is not a query key');
    // An unknown key is a sentence to the reader, not a reason to throw the block away.
    expect(parsed.query).toMatchObject({ folders: ['Campaign'], tags: ['npcs'] });
  });

  it('reports the line yaml could not read and keeps what stood above it', () => {
    const parsed = parseQuery('from: Campaign\ntag: [npcs\n');
    expect(parsed.problems.length).toBeGreaterThan(0);
    expect(parsed.problems[0]?.line).toBeGreaterThan(0);
    // The message is one line: it is shown beside a table, not in a terminal.
    expect(parsed.problems.every((problem) => !problem.message.includes('\n'))).toBe(true);
  });

  it('reports a key written twice rather than silently taking one of them', () => {
    const parsed = parseQuery('tag: lore\ntag: npcs');
    expect(parsed.problems[0]).toEqual({
      line: 2,
      message: 'Map keys must be unique at line 2, column 1',
    });
  });

  it('refuses a value that is not text where text belongs', () => {
    const parsed = parseQuery('title:\n  - a\n  - b');
    expect(parsed.query.title).toBeNull();
    expect(parsed.problems).toEqual([
      { line: 2, message: '`title` matches one substring, not a list of them.' },
    ]);
  });

  it('refuses an unknown note type and keeps the ones it knows', () => {
    const parsed = parseQuery('type: [definition, monster]');
    expect(parsed.query.types).toEqual(['definition']);
    expect(parsed.problems).toHaveLength(1);
    expect(parsed.problems[0]?.message).toContain('`monster` is not a note type');
  });

  it('refuses an unknown sort and an unknown view, and keeps the defaults', () => {
    const parsed = parseQuery('sort: relevance\nas: gallery');
    expect(parsed.query).toMatchObject({ sort: 'title', descending: false, view: 'list' });
    expect(parsed.problems).toHaveLength(2);
    expect(parsed.problems[0]?.message).toContain('`sort: relevance` is not an order');
    expect(parsed.problems[1]?.message).toContain('`as: gallery` is not a view');
  });

  it('refuses a limit outside the range rather than clamping it to a number nobody wrote', () => {
    for (const body of ['limit: 0', 'limit: 501', 'limit: 12.5', 'limit: -3']) {
      const parsed = parseQuery(body);
      expect(parsed.query.limit).toBe(100);
      expect(parsed.problems).toEqual([
        { line: 1, message: '`limit` is a whole number between 1 and 500.' },
      ]);
    }
    expect(query('limit: 500').limit).toBe(500);
  });

  it('refuses a limit that is not a number at all', () => {
    const parsed = parseQuery('limit: lots');
    expect(parsed.query.limit).toBe(100);
    expect(parsed.problems).toEqual([{ line: 1, message: '`limit` expects a number.' }]);
  });

  it('says that columns are only drawn by a table', () => {
    const parsed = parseQuery('from: Campaign\ncolumns: [title, tags]');
    expect(parsed.query.columns).toEqual(['title', 'tags']);
    expect(parsed.problems).toEqual([
      { line: 2, message: '`columns` are only shown by `as: table`.' },
    ]);
  });

  it('refuses a key that is not a word, and reads the keys around it', () => {
    // YAML allows a whole collection as a key. A query key is one of ten words.
    const parsed = parseQuery('? [a, b]\n: 1\nfrom: Campaign');
    expect(parsed.query.folders).toEqual(['Campaign']);
    expect(parsed.problems).toEqual([{ line: 1, message: 'A query key expects text.' }]);
  });

  it('refuses an alias, so that a body cannot unfold into something larger', () => {
    // An anchor is a scalar and reads as one; the alias that would repeat it is not text, and
    // is turned down before the document ever expands it.
    const parsed = parseQuery('from: &folder Campaign\ntag: *folder');
    expect(parsed.query.folders).toEqual(['Campaign']);
    expect(parsed.query.tags).toEqual([]);
    expect(parsed.problems).toEqual([{ line: 2, message: '`tag` expects text.' }]);
  });
});

describe('folders', () => {
  it('normalises what a reader types into a vault path', () => {
    expect(query('from: Campaign\\NPCs').folders).toEqual(['Campaign/NPCs']);
    expect(query('from: /Campaign/').folders).toEqual(['Campaign']);
    expect(query('from: ./Campaign/./NPCs').folders).toEqual(['Campaign/NPCs']);
    // A folder that looks like a date is a folder: YAML's types are an accident of spelling.
    expect(query('from: 2026-09-20').folders).toEqual(['2026-09-20']);
  });

  it('keeps the case as written, because the disk may not agree about it', () => {
    expect(query('from: Templates').folders).toEqual(['Templates']);
  });

  it('refuses a folder that leaves the vault', () => {
    const parsed = parseQuery('from: [../secrets, Campaign]');
    expect(parsed.query.folders).toEqual(['Campaign']);
    expect(parsed.problems).toHaveLength(1);
    expect(parsed.problems[0]?.message).toContain('leaves the vault');
  });
});

describe('tags', () => {
  it('reads a tag with or without the hash and whatever the case', () => {
    expect(query('tag: ["#Campaign/NPCs", lore, "##Deep"]').tags).toEqual([
      'campaign/npcs',
      'lore',
      'deep',
    ]);
  });

  it('asks the same question for `campaign` and `campaign/`', () => {
    expect(query('tag: Campaign/').tags).toEqual(['campaign']);
  });

  it('refuses what the index could never have recorded as a tag', () => {
    // A tag made only of digits is not a tag to the parser that wrote the index, so a query
    // asking for one would match nothing for a reason nobody could see.
    const parsed = parseQuery('tag: [2024, "two words", lore]');
    expect(parsed.query.tags).toEqual(['lore']);
    expect(parsed.problems).toHaveLength(2);
    expect(parsed.problems[0]?.message).toContain('`2024` is not a tag');
    expect(parsed.problems[1]?.line).toBe(1);
  });
});

describe('sort', () => {
  it('reads a leading minus as descending', () => {
    expect(query('sort: -modified')).toMatchObject({ sort: 'modified', descending: true });
    expect(query('sort: -title')).toMatchObject({ sort: 'title', descending: true });
    expect(query('sort: created')).toMatchObject({ sort: 'created', descending: false });
    expect(query('sort: Path')).toMatchObject({ sort: 'path', descending: false });
  });

  it('refuses a minus with nothing behind it', () => {
    const parsed = parseQuery('sort: "-"');
    expect(parsed.query).toMatchObject({ sort: 'title', descending: false });
    expect(parsed.problems).toHaveLength(1);
  });
});

describe('where', () => {
  it('compares a field with one value, or with any of a list', () => {
    expect(query('where:\n  status: [open, blocked]\n  draft: false\n  session: 12').where).toEqual(
      [
        { key: 'status', values: ['open', 'blocked'] },
        { key: 'draft', values: [false] },
        { key: 'session', values: [12] },
      ],
    );
  });

  it('keeps a value exactly as the note wrote it', () => {
    // YAML has already dropped the space around anything that was not deliberately quoted, so
    // what is left inside the quotes is what the frontmatter has to equal.
    expect(query('where:\n  code: "  spaced  "').where).toEqual([
      { key: 'code', values: ['  spaced  '] },
    ]);
  });

  it('refuses a dotted key, because a query has no path into a value', () => {
    const parsed = parseQuery('where:\n  author.name: Mira\n  tags[0]: lore\n  status: open');
    expect(parsed.query.where).toEqual([{ key: 'status', values: ['open'] }]);
    expect(parsed.problems).toHaveLength(2);
    expect(parsed.problems[0]).toEqual({
      line: 2,
      message:
        '`where` compares one frontmatter field; `author.name` reads like a path into a value.',
    });
    expect(parsed.problems[1]?.line).toBe(3);
  });

  it('refuses a nested mapping, an empty list and a value that is missing', () => {
    const parsed = parseQuery('where:\n  author:\n    name: Mira\n  status: []\n  due:');
    expect(parsed.query.where).toEqual([]);
    expect(parsed.problems).toHaveLength(3);
    expect(parsed.problems[0]?.message).toContain('`where: author` compares a plain value');
    expect(parsed.problems[1]?.line).toBe(4);
    expect(parsed.problems[2]?.line).toBe(5);
  });

  it('refuses one bad entry of a list and keeps the rest of it', () => {
    const parsed = parseQuery('where:\n  status:\n    - open\n    - [nested]');
    expect(parsed.query.where).toEqual([{ key: 'status', values: ['open'] }]);
    expect(parsed.problems).toHaveLength(1);
    expect(parsed.problems[0]?.line).toBe(4);
  });

  it('drops a field with no name, the way it drops any other empty entry', () => {
    const parsed = parseQuery('where:\n  "": open');
    expect(parsed.query.where).toEqual([]);
    expect(parsed.problems).toEqual([]);
  });

  it('refuses a `where` that is not a mapping at all', () => {
    const parsed = parseQuery('where: open');
    expect(parsed.query.where).toEqual([]);
    expect(parsed.problems).toEqual([
      {
        line: 1,
        message: '`where` is a mapping of frontmatter fields to the values they must have.',
      },
    ]);
  });

  it('treats a `where` with nothing under it as no filter', () => {
    expect(query('where:\nfrom: Campaign')).toMatchObject({ where: [], folders: ['Campaign'] });
  });
});

describe('columns', () => {
  it('spells a built-in column canonically and leaves a frontmatter field alone', () => {
    expect(query('as: table\ncolumns: [Title, Modified, Status, dueDate]').columns).toEqual([
      'title',
      'modified',
      'Status',
      'dueDate',
    ]);
  });

  it('refuses a column that reads like a path into a value', () => {
    const parsed = parseQuery('as: table\ncolumns: [author.name, title]');
    expect(parsed.query.columns).toEqual(['title']);
    expect(parsed.problems).toHaveLength(1);
    expect(parsed.problems[0]?.message).toContain('A column is one field');
  });
});

describe('a query is read, never run', () => {
  // The point of the whole design: a vault arrives from anywhere, so nothing in a block body is
  // ever evaluated, interpolated, or compiled into a pattern. Everything below comes back as the
  // characters that were typed.

  it('takes a title as a substring, not as a regular expression', () => {
    expect(query('title: .*').title).toBe('.*');
    expect(query('title: "(a|b)+$"').title).toBe('(a|b)+$');
    expect(query('title: "[unclosed"').title).toBe('[unclosed');
    // A pattern that would take exponential time to match is three dozen plain characters here.
    expect(query('title: "(a+)+(a+)+(a+)+(a+)+(a+)+b"').title).toBe('(a+)+(a+)+(a+)+(a+)+(a+)+b');
  });

  it('hands a shell-shaped value straight back', () => {
    const bodies = [
      'where:\n  x: "$(rm -rf /)"',
      'where:\n  x: "`whoami`"',
      'where:\n  x: "${process.env.HOME}"',
      'where:\n  x: "; DROP TABLE notes; --"',
    ];
    const values = bodies.map((body) => query(body).where[0]?.values[0]);
    expect(values).toEqual([
      '$(rm -rf /)',
      '`whoami`',
      '${process.env.HOME}',
      '; DROP TABLE notes; --',
    ]);
    for (const value of values) {
      expect(typeof value).toBe('string');
    }
  });

  it('carries a very long value without looking at it twice', () => {
    const long = 'a'.repeat(10_000);
    const parsed = parseQuery(`title: ${long}\nwhere:\n  x: ${long}`);
    expect(parsed.problems).toEqual([]);
    expect(parsed.query.title).toBe(long);
    expect(parsed.query.where).toEqual([{ key: 'x', values: [long] }]);
  });

  it('returns nothing but plain data', () => {
    const parsed = parseQuery(
      'from: Campaign\ntype: definition\ntag: "#lore"\ntitle: .*\nlinksTo: Mira\n' +
        'where:\n  status: [open, false, 3]\nsort: -created\nlimit: 7\nas: table\ncolumns: [title]',
    );
    expect(parsed.problems).toEqual([]);
    // Structured-cloneable and JSON-round-trippable: no functions, no patterns, no class
    // instances the renderer or the server would have to trust.
    expect(JSON.parse(JSON.stringify(parsed.query))).toEqual(parsed.query);
    expect(parsed.query).toEqual({
      folders: ['Campaign'],
      types: ['definition'],
      tags: ['lore'],
      title: '.*',
      linksTo: ['Mira'],
      where: [{ key: 'status', values: ['open', false, 3] }],
      sort: 'created',
      descending: true,
      limit: 7,
      view: 'table',
      columns: ['title'],
    });
  });
});
