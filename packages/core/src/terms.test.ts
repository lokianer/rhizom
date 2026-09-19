import { describe, expect, it } from 'vitest';

import {
  createTermMatcher,
  definedTerms,
  foldTerm,
  glossaryTerms,
  summaryOf,
  type VaultTerm,
} from './terms.js';

function term(surface: string, path = 'glossary/Term.md', alias = false): VaultTerm {
  return { surface, path, alias, summary: '' };
}

function found(matcher: { find(text: string): { text: string; start: number }[] }, text: string) {
  return matcher.find(text).map((match) => [match.text, match.start] as const);
}

describe('definedTerms', () => {
  const note = {
    path: 'glossary/Rhizome.md',
    title: 'Rhizome',
    aliases: ['Rhizom', 'rhizomatic'],
    frontmatter: { type: 'definition' },
  };

  it('takes the title and every alias of a definition note', () => {
    expect(definedTerms(note)).toEqual([
      { surface: 'Rhizome', path: 'glossary/Rhizome.md', alias: false },
      { surface: 'Rhizom', path: 'glossary/Rhizome.md', alias: true },
      { surface: 'rhizomatic', path: 'glossary/Rhizome.md', alias: true },
    ]);
  });

  it('ignores a note that does not declare itself a definition', () => {
    expect(definedTerms({ ...note, frontmatter: {} })).toEqual([]);
    expect(definedTerms({ ...note, frontmatter: { type: 'npc' } })).toEqual([]);
  });

  it('accepts the declaration whatever its case and spacing', () => {
    expect(definedTerms({ ...note, frontmatter: { type: ' Definition ' } })).toHaveLength(3);
  });

  it('drops a surface that holds no word at all', () => {
    const terms = definedTerms({ ...note, title: '—', aliases: ['', ' ', 'Rhizom'] });
    expect(terms.map((entry) => entry.surface)).toEqual(['Rhizom']);
  });

  it('still marks an alias as an alias when the title holds no word', () => {
    const terms = definedTerms({ ...note, title: '★', aliases: ['Star'] });
    expect(terms).toEqual([{ surface: 'Star', path: 'glossary/Rhizome.md', alias: true }]);
  });

  it('trims the surfaces it stores', () => {
    const terms = definedTerms({ ...note, title: '  Rhizome ', aliases: [' Rhizom '] });
    expect(terms.map((entry) => entry.surface)).toEqual(['Rhizome', 'Rhizom']);
  });
});

describe('glossaryTerms', () => {
  const entry = {
    path: 'Glossary/Spring tide.md',
    title: 'Spring tide',
    aliases: ['spring tides'],
    summary: 'The higher tide.',
  };

  it('expands an entry into its title and every alias, all sharing the summary', () => {
    expect(glossaryTerms([entry])).toEqual([
      {
        surface: 'Spring tide',
        path: 'Glossary/Spring tide.md',
        alias: false,
        summary: 'The higher tide.',
      },
      {
        surface: 'spring tides',
        path: 'Glossary/Spring tide.md',
        alias: true,
        summary: 'The higher tide.',
      },
    ]);
  });

  it('says the same word once when a title and an alias differ only in case', () => {
    const terms = glossaryTerms([{ ...entry, aliases: ['SPRING TIDE', 'springs'] }]);
    expect(terms.map((term) => term.surface)).toEqual(['Spring tide', 'springs']);
  });

  it('drops a surface that holds no word, and trims the rest', () => {
    const terms = glossaryTerms([{ ...entry, title: '  Spring tide ', aliases: ['—', ' ebb '] }]);
    expect(terms.map((term) => term.surface)).toEqual(['Spring tide', 'ebb']);
  });

  it('has nothing to expand for an empty glossary', () => {
    expect(glossaryTerms([])).toEqual([]);
  });
});

describe('summaryOf', () => {
  it('takes the first block that is not the note’s own title', () => {
    expect(summaryOf('Rhizome\nA root that spreads.', 'Rhizome')).toBe('A root that spreads.');
    expect(summaryOf('A root that spreads.', 'Rhizome')).toBe('A root that spreads.');
  });

  it('is empty for a note that says nothing but its title', () => {
    expect(summaryOf('Rhizome', 'Rhizome')).toBe('');
    expect(summaryOf('', 'Rhizome')).toBe('');
  });

  it('cuts a long block at a word boundary', () => {
    const long = `${'word '.repeat(200)}end`;
    const cut = summaryOf(long, 'T');
    expect(cut.length).toBeLessThanOrEqual(401);
    expect(cut.endsWith('…')).toBe(true);
    expect(cut).not.toContain('wor…');
  });
});

describe('foldTerm', () => {
  it('normalises to NFC and lower case without dropping accents', () => {
    expect(foldTerm('Rhône')).toBe('rhône');
    expect(foldTerm('Rhône')).toBe(foldTerm('Rhône'));
    expect(foldTerm('Rhone')).not.toBe(foldTerm('Rhône'));
  });
});

describe('createTermMatcher', () => {
  it('finds a term whatever its case', () => {
    const matcher = createTermMatcher([term('Rhizome')]);
    expect(found(matcher, 'A rhizome, and the Rhizome again.')).toEqual([
      ['rhizome', 2],
      ['Rhizome', 19],
    ]);
  });

  it('only matches whole words', () => {
    const matcher = createTermMatcher([term('Insel')]);
    expect(found(matcher, 'Inselgruppe and Halbinsel')).toEqual([]);
    expect(found(matcher, 'Die Insel.')).toEqual([['Insel', 4]]);
  });

  it('matches a term of several words across a hard wrap', () => {
    const matcher = createTermMatcher([term('Grüne Insel')]);
    expect(found(matcher, 'the Grüne\nInsel lies north')).toEqual([['Grüne\nInsel', 4]]);
    expect(found(matcher, 'the Grüne   Insel lies north')).toEqual([['Grüne   Insel', 4]]);
  });

  it('never matches across a blank line', () => {
    const matcher = createTermMatcher([term('Grüne Insel')]);
    expect(found(matcher, 'the Grüne\n\nInsel lies north')).toEqual([]);
    expect(found(matcher, 'the Grüne\n   \nInsel lies north')).toEqual([]);
  });

  it('sees through emphasis written with underscores', () => {
    const matcher = createTermMatcher([term('Grüne Insel')]);
    expect(found(matcher, 'the _Grüne Insel_ lies north')).toEqual([['Grüne Insel', 5]]);
  });

  it('keeps an underscore inside a word meaningful', () => {
    const matcher = createTermMatcher([term('snake_case')]);
    expect(found(matcher, 'a snake_case name')).toEqual([['snake_case', 2]]);
    expect(found(matcher, 'a snake case name')).toEqual([]);
    expect(found(createTermMatcher([term('case')]), 'a snake_case name')).toEqual([]);
  });

  it('keeps the punctuation a term carries at its edges', () => {
    const matcher = createTermMatcher([term('C++')]);
    expect(found(matcher, 'a C program written in C++ today')).toEqual([['C++', 23]]);

    const dotted = createTermMatcher([term('.NET')]);
    expect(found(dotted, 'built on .NET and on NET')).toEqual([['.NET', 9]]);
  });

  it('prefers the term whose edge punctuation also matches', () => {
    const matcher = createTermMatcher([term('C', 'a.md'), term('C++', 'b.md')]);
    expect(matcher.find('C++ and C').map((match) => [match.text, match.term.path])).toEqual([
      ['C++', 'b.md'],
      ['C', 'a.md'],
    ]);
  });

  it('requires the separator inside a term to be the same kind', () => {
    const matcher = createTermMatcher([term('D&D')]);
    expect(found(matcher, 'we play D&D tonight')).toEqual([['D&D', 8]]);
    expect(found(matcher, 'we play D D tonight')).toEqual([]);
  });

  it('prefers the longest term and never overlaps', () => {
    const matcher = createTermMatcher([term('Grüne'), term('Grüne Insel')]);
    expect(found(matcher, 'Grüne Insel und Grüne See')).toEqual([
      ['Grüne Insel', 0],
      ['Grüne', 16],
    ]);
  });

  it('does not match a term the text runs out of room for', () => {
    const matcher = createTermMatcher([term('Grüne Insel')]);
    expect(found(matcher, 'am Ende steht Grüne')).toEqual([]);
  });

  it('matches composed and decomposed spellings alike', () => {
    const matcher = createTermMatcher([term('Rhône')]);
    expect(found(matcher, 'along the Rhône')).toEqual([['Rhône', 10]]);
  });

  it('reports which note defines the match', () => {
    const matcher = createTermMatcher([
      term('Rhizom', 'glossary/Rhizome.md', true),
      term('Insel', 'places/Insel.md'),
    ]);
    expect(matcher.find('Rhizom und Insel').map((match) => match.term)).toEqual([
      { surface: 'Rhizom', path: 'glossary/Rhizome.md', alias: true, summary: '' },
      { surface: 'Insel', path: 'places/Insel.md', alias: false, summary: '' },
    ]);
  });

  it('is deterministic when two notes define the same term', () => {
    const first = createTermMatcher([term('Insel', 'b.md'), term('Insel', 'a.md')]);
    const second = createTermMatcher([term('Insel', 'a.md'), term('Insel', 'b.md')]);
    expect(first.find('Insel')[0]?.term.path).toBe('a.md');
    expect(second.find('Insel')[0]?.term.path).toBe('a.md');
  });

  it('counts the terms it knows and skips those without a word', () => {
    expect(createTermMatcher([term('Insel'), term('—')]).size).toBe(1);
  });

  it('finds nothing when it knows nothing', () => {
    const matcher = createTermMatcher([]);
    expect(matcher.size).toBe(0);
    expect(matcher.find('Insel')).toEqual([]);
  });

  it('reports offsets that slice the original text back out', () => {
    const text = 'Die Grüne Insel, im Norden.';
    const matcher = createTermMatcher([term('Grüne Insel')]);
    const match = matcher.find(text)[0];
    expect(match).toBeDefined();
    expect(text.slice(match?.start ?? 0, match?.end ?? 0)).toBe('Grüne Insel');
  });
});
