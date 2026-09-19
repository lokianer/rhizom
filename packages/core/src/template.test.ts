import { describe, expect, it } from 'vitest';

import { expandTemplate, formatDate, roll, type TemplateContext } from './template.js';

// A Thursday afternoon, so that weekday and twelve-hour tokens have something to say.
const NOW = new Date(2026, 8, 17, 14, 5, 9);

function expand(source: string, overrides: Partial<TemplateContext> = {}) {
  return expandTemplate(source, {
    title: 'Session 12',
    now: NOW,
    random: () => 0.5,
    ...overrides,
  });
}

describe('expandTemplate', () => {
  it('fills the placeholders Obsidian writes', () => {
    expect(expand('# {{title}}\n\n{{date}} at {{time}}').text).toBe(
      '# Session 12\n\n2026-09-17 at 14:05',
    );
  });

  it('takes a format where one is given', () => {
    expect(expand('{{date:DD.MM.YYYY}} {{time:h:mm a}}').text).toBe('17.09.2026 2:05 pm');
  });

  it("follows the vault's own formats where the placeholder names none", () => {
    // What Obsidian's own settings say, so the same template writes the same date in both.
    const formats = { dateFormat: 'DD.MM.YYYY', timeFormat: 'HH:mm:ss' };
    expect(expand('{{date}} {{time}}', formats).text).toBe('17.09.2026 14:05:09');
    expect(expand('{{date:YYYY}}', formats).text).toBe('2026');
  });

  it('leaves alone what it does not understand', () => {
    // A template is a Markdown file like any other, and files hold all sorts of braces.
    const source = 'Hello {{name}}, {{#each items}}{{/each}} and $\\{{x}}$.';
    expect(expand(source).text).toBe(source);
  });

  it('leaves a known name alone when its argument makes no sense', () => {
    // An empty format is not a date, and writing nothing would be a silent deletion.
    expect(expand('{{title:loud}} {{date:}} {{time: }} {{roll:d}}').text).toBe(
      '{{title:loud}} {{date:}} {{time: }} {{roll:d}}',
    );
  });

  it('never reaches past the end of a line for its closing braces', () => {
    // An unclosed `{{date:` used to find the next `}}` anywhere in the file and eat everything
    // in between — in a tool whose whole promise is that it does not touch your text.
    const source = 'Start {{date:\n\nA paragraph.\n\nAnother one.\n\n}} end';
    expect(expand(source).text).toBe(source);
  });

  it('leaves {{path}} as it stands when there is no path to fill in', () => {
    expect(expand('{{path}}').text).toBe('{{path}}');
    expect(expand('{{path}}', { path: 'Daily/2026-09-17.md' }).text).toBe('Daily/2026-09-17.md');
  });

  it('does not touch a placeholder standing in code', () => {
    // `B{{date}}` is a hexagon in a Mermaid diagram, and a code span is the only way to write
    // a placeholder literally in a note about templates.
    const source = 'Write `{{date}}` to get a date.\n\n```mermaid\ngraph TD\nB{{date}}\n```\n';
    expect(expand(source).text).toBe(source);
  });

  it('fills the frontmatter, where the templates in a real vault put it', () => {
    const source = '---\ncreated: "{{date}}"\n---\n\n# {{title}}\n';
    expect(expand(source).text).toBe('---\ncreated: "2026-09-17"\n---\n\n# Session 12\n');
  });

  it('fills a link, because a template linking to today is the point of one', () => {
    expect(expand('See [[Daily/{{date}}]] and [today]({{date}}.md).').text).toBe(
      'See [[Daily/2026-09-17]] and [today](2026-09-17.md).',
    );
  });

  it('reports where the cursor should go and leaves nothing behind', () => {
    const { text, cursor } = expand('## {{title}}\n\n{{cursor}}\n\n#session');
    expect(text).toBe('## Session 12\n\n\n\n#session');
    expect(cursor).toBe('## Session 12\n\n'.length);
  });

  it('keeps the first cursor when a template names two', () => {
    const { text, cursor } = expand('a{{cursor}}b{{cursor}}c');
    expect(text).toBe('abc');
    expect(cursor).toBe(1);
  });

  it('has no cursor to report when the template does not ask for one', () => {
    expect(expand('plain').cursor).toBeUndefined();
  });

  it('rolls dice with the die it was handed', () => {
    expect(expand('{{roll:2d6+3}}', { random: () => 0 }).text).toBe('5');
    expect(expand('{{roll:2d6+3}}', { random: () => 0.999 }).text).toBe('15');
  });

  it('changes nothing in a text without placeholders', () => {
    expect(expand('# Notes\n\nNothing to fill in.').text).toBe('# Notes\n\nNothing to fill in.');
  });
});

describe('formatDate', () => {
  it('writes the numeric tokens', () => {
    expect(formatDate(NOW, 'YYYY-MM-DD HH:mm:ss')).toBe('2026-09-17 14:05:09');
    expect(formatDate(NOW, 'YY/M/D H:m:s')).toBe('26/9/17 14:5:9');
  });

  it('names months and weekdays in the language it is given', () => {
    expect(formatDate(NOW, 'dddd, D MMMM YYYY', 'en')).toBe('Thursday, 17 September 2026');
    expect(formatDate(NOW, 'dddd, D. MMMM YYYY', 'de')).toBe('Donnerstag, 17. September 2026');
    expect(formatDate(NOW, 'ddd MMM', 'en')).toBe('Thu Sep');
  });

  it('writes the ordinal Obsidian uses in its own example', () => {
    expect(formatDate(NOW, 'MMMM Do, YYYY')).toBe('September 17th, 2026');
    expect(formatDate(new Date(2026, 8, 1), 'Do')).toBe('1st');
    expect(formatDate(new Date(2026, 8, 2), 'Do')).toBe('2nd');
    expect(formatDate(new Date(2026, 8, 3), 'Do')).toBe('3rd');
    expect(formatDate(new Date(2026, 8, 11), 'Do')).toBe('11th');
    expect(formatDate(new Date(2026, 8, 22), 'Do')).toBe('22nd');
  });

  it('counts the day of the year, which is what DDD means', () => {
    expect(formatDate(new Date(2026, 0, 1), 'DDD')).toBe('1');
    expect(formatDate(NOW, 'DDDD')).toBe('260');
    expect(formatDate(new Date(2024, 11, 31), 'DDD')).toBe('366');
  });

  it('writes the ISO week, including the year that week belongs to', () => {
    expect(formatDate(NOW, 'gggg-[W]ww')).toBe('2026-W38');
    // 1 January 2027 is a Friday, so it is still week 53 of 2026.
    expect(formatDate(new Date(2027, 0, 1), 'GGGG-[W]WW')).toBe('2026-W53');
    expect(formatDate(new Date(2026, 0, 5), 'gg w')).toBe('26 2');
  });

  it('reads the twelve-hour clock', () => {
    expect(formatDate(new Date(2026, 8, 17, 0, 30), 'h:mm A')).toBe('12:30 AM');
    expect(formatDate(new Date(2026, 8, 17, 12, 30), 'h:mm A')).toBe('12:30 PM');
    expect(formatDate(NOW, 'hh:mm a')).toBe('02:05 pm');
  });

  it('writes the quarter and the two unix stamps', () => {
    expect(formatDate(NOW, 'Q')).toBe('3');
    expect(formatDate(NOW, 'X')).toBe(String(Math.floor(NOW.getTime() / 1000)));
    expect(formatDate(NOW, 'x')).toBe(String(NOW.getTime()));
  });

  it('writes an offset the rest of the timestamp agrees with', () => {
    // Whatever zone the test machine is in, the offset has to be this machine's.
    const minutes = -NOW.getTimezoneOffset();
    const sign = minutes < 0 ? '-' : '+';
    const absolute = Math.abs(minutes);
    const hh = String(Math.floor(absolute / 60)).padStart(2, '0');
    const mm = String(absolute % 60).padStart(2, '0');
    expect(formatDate(NOW, 'Z')).toBe(`${sign}${hh}:${mm}`);
    expect(formatDate(NOW, 'ZZ')).toBe(`${sign}${hh}${mm}`);
  });

  it('writes the two-letter weekday Moment writes for dd', () => {
    // One letter would read Tuesday and Thursday as the same day, and Saturday as Sunday.
    const week = [13, 14, 15, 16, 17, 18, 19].map((day) =>
      formatDate(new Date(2026, 8, day), 'dd', 'en'),
    );
    expect(week).toEqual(['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa']);
    expect(formatDate(NOW, 'dd', 'de')).toBe('Do');
  });

  it('runs through a long stretch of literal text without stopping to think', () => {
    // Every character between two tokens used to cost its own scan of everything after it.
    // A hyphen is no token; an `x` would have been the unix timestamp, a hundred thousand times.
    const literal = '-'.repeat(100_000);
    const started = Date.now();
    const written = formatDate(NOW, `${literal}YYYY`);
    expect(written).toBe(`${literal}2026`);
    expect(Date.now() - started).toBeLessThan(2_000);
  });

  it('takes what is in square brackets literally, as Moment does', () => {
    expect(formatDate(NOW, '[Day] D [of] MMMM')).toBe('Day 17 of September');
  });

  it('takes the rest literally when a bracket is never closed', () => {
    expect(formatDate(NOW, '[unclosed D')).toBe('unclosed D');
  });

  it('passes through what is not a token', () => {
    expect(formatDate(NOW, '[Week of] D.M.')).toBe('Week of 17.9.');
  });

  it('treats a bare letter as a token, which is what the brackets are for', () => {
    // Moment does the same: the W of "Week" is the ISO week number unless it is bracketed.
    expect(formatDate(NOW, 'Week')).toBe('38eek');
  });
});

describe('roll', () => {
  it('reads the usual notations', () => {
    const half = () => 0.5;
    expect(roll('1d100', half)).toBe('51');
    expect(roll('d20', half)).toBe('11');
    expect(roll('2d6', half)).toBe('8');
    expect(roll('2d6-2', half)).toBe('6');
    expect(roll(' 3 d 8 + 1 ', half)).toBe('16');
  });

  it('stays inside the sides of the die', () => {
    expect(roll('1d6', () => 0)).toBe('1');
    expect(roll('1d6', () => 0.999_999)).toBe('6');
  });

  it('refuses what is not a roll', () => {
    for (const notation of ['', 'd', '1d', 'two d6', '1d6+', '0d6', '101d6', '1d0', '1e6']) {
      expect(roll(notation, () => 0.5)).toBeUndefined();
    }
  });
});
