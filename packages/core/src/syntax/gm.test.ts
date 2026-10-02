import { describe, expect, it } from 'vitest';

import { findGates, hiddenAt, isPublicNote, publicMarkdown, sessionNumberOf } from './gm.js';

const at = (markdown: string, session = 0) => publicMarkdown(markdown, session);

describe('GM callouts', () => {
  it('removes a GM callout with its whole lines and keeps what is around it', () => {
    const source = 'Before.\n\n> [!gm]\n> SECRET one\n> SECRET two\n\nAfter.\n';
    expect(at(source)).toBe('Before.\n\nAfter.\n');
  });

  it('knows every spelling Obsidian accepts', () => {
    for (const header of ['[!GM]', '[!gm]-', '[!Gm]+ Behind the curtain', '[!gm]Title']) {
      expect(at(`> ${header}\n> SECRET\n`)).not.toContain('SECRET');
    }
  });

  it('removes one nested in a list or in another quote, and its lazy lines', () => {
    expect(at('- item\n  > [!gm]\n  > SECRET\n- next\n')).not.toContain('SECRET');
    expect(at('> outer\n>\n> > [!gm]\n> > SECRET\n')).not.toContain('SECRET');
    expect(at('> [!gm]\nSECRET lazy line\n\nAfter.\n')).toBe('After.\n');
  });

  it('leaves an ordinary callout and a quote alone', () => {
    const source = '> [!note]\n> visible\n\n> quoted\n';
    expect(at(source)).toBe(source);
  });

  it('is not fooled by a GM header in a fence or a code span', () => {
    const source = '```\n> [!gm]\n> shown\n```\n\nWrite `> [!gm]` to hide.\n';
    expect(at(source)).toBe(source);
  });

  it('reveals a block from its session on, and not before', () => {
    const source = '> [!gm] revealed: 12\n> The bell was cracked on purpose.\n';
    expect(at(source, 11)).not.toContain('cracked');
    expect(at(source, 12)).toContain('cracked');
    expect(at(source, 13)).toContain('cracked');
  });

  it('keeps a block gated for good when its reveal cannot be read', () => {
    for (const header of ['[!gm] revealed: soon', '[!gm] revealed:', '[!gm] revealed: -3']) {
      expect(at(`> ${header}\n> SECRET\n`, 1000)).not.toContain('SECRET');
    }
  });
});

describe('what the review tried', () => {
  it('keeps a GM callout inside a revealed one hidden', () => {
    const source = '> [!gm] revealed: 1\n> The heist.\n> > [!gm]\n> > SECRET nested\n';
    expect(at(source, 5)).toContain('The heist.');
    expect(at(source, 5)).not.toContain('SECRET');
  });

  it('hides every spelling the GM lens draws as a GM callout', () => {
    for (const header of ['[!GM ]', '[! gm]', '[!gm|wide]', '[&#33;gm]', '[!gm|wide]- Title']) {
      expect(at(`> ${header}\n> SECRET\n`, 99), header).not.toContain('SECRET');
    }
  });

  it('is not fooled by a setext underline or a reference definition', () => {
    expect(at('> [!gm] Title\n> ---\n> SECRET\n')).not.toContain('SECRET');
    expect(at('[!gm]: https://example.test\n\n> [!gm]\n> SECRET\n')).not.toContain('SECRET');
  });

  it('cuts the frontmatter the way the parser reads it', () => {
    expect(at('---  \nsecret: SECRET\n---\n# T\n')).not.toContain('SECRET');
  });

  it('reads lone carriage returns as line ends', () => {
    expect(at('> [!gm]\r> SECRET\r\rAfter.\r')).not.toContain('SECRET');
  });

  it('takes an escaped %% as text, so it cannot flip the comments after it', () => {
    expect(at('Odds are 50\\%% today. %%SECRET%% Public.\n')).toBe(
      'Odds are 50\\%% today.  Public.\n',
    );
  });

  it('hides an HTML block that holds a GM callout or a comment', () => {
    expect(at('<details>\n> [!gm]\n> SECRET\n</details>\n')).not.toContain('SECRET');
    expect(at('<div>\n%% SECRET %%\n</div>\n', 99)).not.toContain('SECRET');
  });
});

describe('comments', () => {
  it('removes an inline comment and one across lines, always', () => {
    expect(at('Mira %%SECRET is the treasurer%% smiles.\n', 1000)).toBe('Mira  smiles.\n');
    expect(at('Before.\n\n%%\nSECRET\nmore\n%%\n\nAfter.\n', 1000)).not.toContain('SECRET');
  });

  it('removes everything after a comment that never closes', () => {
    expect(at('Public.\n\n%% SECRET from here\n\nand SECRET on.\n')).toBe('Public.\n\n');
  });

  it('leaves %% in code alone', () => {
    const source = 'Use `%%` for comments.\n\n```\n%% not a comment %%\n```\n';
    expect(at(source)).toBe(source);
  });
});

describe('the frontmatter', () => {
  it('is never public', () => {
    expect(at('---\nsecret: SECRET\n---\n# Mira\n', 1000)).toBe('# Mira\n');
  });
});

describe('findGates and hiddenAt', () => {
  it('reports each gate with its lines and reveal', () => {
    const gates = findGates('Line 1\n> [!gm] revealed: 3\n> two\n\nText %%x%% here\n');
    expect(gates).toEqual([
      expect.objectContaining({ kind: 'callout', startLine: 2, endLine: 3, revealed: 3 }),
      expect.objectContaining({ kind: 'comment', startLine: 5, endLine: 5, revealed: null }),
    ]);
    expect(hiddenAt(gates, 2, 2)).toBe(true);
    expect(hiddenAt(gates, 2, 3)).toBe(false);
    expect(hiddenAt(gates, 5, 100)).toBe(true);
    expect(hiddenAt(gates, 1, 0)).toBe(false);
  });
});

describe('session notes and public notes', () => {
  it('reads an integer session number and nothing else', () => {
    expect(sessionNumberOf({ type: 'session', session: 12 })).toBe(12);
    expect(sessionNumberOf({ type: 'Session', session: '7' })).toBe(7);
    expect(sessionNumberOf({ type: 'session', session: 1.5 })).toBeUndefined();
    expect(sessionNumberOf({ type: 'session' })).toBeUndefined();
    expect(sessionNumberOf({ type: 'npc', session: 3 })).toBeUndefined();
  });

  it('takes only a true public flag as public', () => {
    expect(isPublicNote({ public: true })).toBe(true);
    expect(isPublicNote({ public: 'yes' })).toBe(false);
    expect(isPublicNote({})).toBe(false);
  });
});
