import { describe, expect, it } from 'vitest';

import { isTaskLine, setTask } from './tasks.js';

describe('isTaskLine', () => {
  it('holds for every bullet a task list may use', () => {
    expect(isTaskLine('- [ ] print the map')).toBe(true);
    expect(isTaskLine('* [x] pack the dice')).toBe(true);
    expect(isTaskLine('+ [X] shouting counts too')).toBe(true);
    expect(isTaskLine('1. [ ] ordered lists are lists')).toBe(true);
    expect(isTaskLine('  - [ ] nested, and still a task')).toBe(true);
  });

  it('does not hold for a line that merely looks like one', () => {
    expect(isTaskLine('- an ordinary item')).toBe(false);
    expect(isTaskLine('- [a link](x.md)')).toBe(false);
    expect(isTaskLine('[ ] no bullet at all')).toBe(false);
    expect(isTaskLine('- [] no room for a mark')).toBe(false);
    expect(isTaskLine('')).toBe(false);
  });
});

describe('setTask', () => {
  const note = '# Before the session\n\n- [ ] print the map\n- [x] pack the dice\n- an item\n';

  it('ticks a task and unticks it, leaving the rest of the line alone', () => {
    expect(setTask(note, 3, true)).toBe(
      '# Before the session\n\n- [x] print the map\n- [x] pack the dice\n- an item\n',
    );
    expect(setTask(note, 4, false)).toBe(
      '# Before the session\n\n- [ ] print the map\n- [ ] pack the dice\n- an item\n',
    );
  });

  it('sets a state rather than flipping one, so two clicks in a row agree', () => {
    const once = setTask(note, 3, true);
    expect(setTask(once, 3, true)).toBe(once);
  });

  it('leaves everything else on the line exactly as it stands', () => {
    const rich = '- [ ] read [[Campaign/NPCs/Sable]] again #prep  \n';
    expect(setTask(rich, 1, true)).toBe('- [x] read [[Campaign/NPCs/Sable]] again #prep  \n');
    // Indentation, an ordered marker and a shouted X all survive.
    expect(setTask('  1. [X] deep\n', 1, false)).toBe('  1. [ ] deep\n');
  });

  it('keeps a Windows line ending', () => {
    expect(setTask('- [ ] one\r\n- [ ] two\r\n', 1, true)).toBe('- [x] one\r\n- [ ] two\r\n');
  });

  it('refuses a line that is not a task, rather than writing into it', () => {
    // The reader may have typed above the list since the page was drawn, in which case the line
    // number points at something else entirely.
    expect(setTask(note, 1, true)).toBe(note);
    expect(setTask(note, 5, true)).toBe(note);
    expect(setTask(note, 99, true)).toBe(note);
    expect(setTask(note, 0, true)).toBe(note);
  });

  it('carries a task written in any script, and one holding emoji', () => {
    const german = '- [ ] Über die Wurzeln lesen 🌱\n';
    expect(setTask(german, 1, true)).toBe('- [x] Über die Wurzeln lesen 🌱\n');
  });
});
