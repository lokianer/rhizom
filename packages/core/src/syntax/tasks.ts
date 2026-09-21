// Ticking a task off in the rendered view, by changing the one line it stands on.
//
// The rendered checkbox carries the line its list item begins on; this turns that line's `[ ]`
// into `[x]` or back. It is a line edit rather than a re-serialisation of the note on purpose:
// everything else on the line — the text, the links, the trailing tag, the indentation of a
// nested list — has to come through untouched, and a Markdown round trip would reflow it.
//
// It refuses a line that is not a task. The reader may have typed above the list since the HTML
// was made, in which case the line number points at something else, and moving somebody's text
// because a stale number said so is the one thing this must not do.

/** The marker at the start of a list item: the bullet, then `[ ]`, `[x]` or `[X]`. */
const TASK = /^(\s*(?:[-*+]|\d+[.)])\s+\[)([ xX])(\])/;

/** Whether this line of the note is a task that can be ticked. */
export function isTaskLine(line: string): boolean {
  return TASK.test(line);
}

/**
 * The note with the task on `line` (1-based) ticked or unticked — `done` says which, so that a
 * click sets a state rather than flipping whatever it finds. A line that is not a task, or a
 * line that is not there, gives the note back unchanged.
 */
export function setTask(markdown: string, line: number, done: boolean): string {
  const lines = markdown.split('\n');
  const index = line - 1;
  const text = lines[index];
  if (text === undefined || !TASK.test(text)) {
    return markdown;
  }
  // The line ends in `\r` when the note is written with Windows line endings; the replacement
  // touches only the three characters of the box, so the ending comes through with the rest.
  const next = text.replace(TASK, (_whole, open: string, _mark: string, close: string) =>
    [open, done ? 'x' : ' ', close].join(''),
  );
  if (next === text) {
    return markdown;
  }
  lines[index] = next;
  return lines.join('\n');
}
