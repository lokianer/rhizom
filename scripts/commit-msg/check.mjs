// @ts-check
// Commit message rules, shared by the git hook (cli.mjs) and its tests:
//   1. the header follows Conventional Commits: <type>(<scope>)!: <subject>
//   2. no attribution: this project has one author, so a commit says what changed and nothing
//      about who or what helped — no authorship trailer, no "generated with" banner, no bot
//      signature, no robot emoji
// It is a safety net for what tools write into a message by themselves, not a filter on
// language: a sentence in the body is prose, and prose is none of the hook's business.

const TYPES = [
  'build',
  'chore',
  'ci',
  'docs',
  'feat',
  'fix',
  'perf',
  'refactor',
  'revert',
  'style',
  'test',
];
const HEADER = new RegExp(`^(${TYPES.join('|')})(\\([a-z0-9._/-]+\\))?!?: \\S.*$`);
const HEADER_MAX_LENGTH = 100;
const GIT_GENERATED_HEADER =
  /^(Merge (branch(es)?|remote-tracking branch|pull request|tag|commits?)\b|Revert ")/;
const AUTOSQUASH_PREFIX = /^((fixup|squash|amend)! )+/;

const COMMENT = /^#/;
const SCISSORS = /^# -+ >8 -+$/;
// Zero-width characters and the byte order mark: invisible, so they must not hide anything.
const INVISIBLE = /[\u200B-\u200D\u2060\uFEFF]/g;

// A trailer that says who made the change. `Signed-off-by:`, `Reviewed-by:` and `Reported-by:`
// are deliberately not here: they say who vouches for a change or who found the problem, which
// is a different claim from having written it.
const AUTHORSHIP_TRAILER =
  /(?:^|[\s("'[])(?:(?:co-)?(?:authored|written|created|made|built|crafted|produced|generated|assisted|drafted|coded|implemented|refactored|(?:pair-)?programmed)-(?:by|with)|on-behalf-of)\s*:/i;
// A trailer whose value carries a bot's own signature, whatever the key says.
const BOT_SIGNATURE = /^[a-z][a-z-]*\s*:.*\[bot\]/i;
// A line that starts with "Generated with/by …" is the banner form tools write by themselves.
// Leading punctuation is skipped, because the banner usually arrives behind an emoji or a
// bullet — but not a quotation mark: a line that opens by quoting the banner is talking about
// it, which is exactly what a commit touching this rule has to do.
const GENERATED_BANNER = /^(?!["'`“„])\W*generated\s+(with|by|using|via)\b/i;
const ROBOT_EMOJI = /\u{1F916}/u;

/**
 * @param {string} message The raw commit message as git hands it to the commit-msg hook.
 * @returns {{ ok: boolean, errors: string[] }}
 */
export function checkCommitMessage(message) {
  /** @type {string[]} */
  const errors = [];
  const lines = messageLines(message);
  const body = trimBlank(lines.filter(({ text }) => !COMMENT.test(text)));

  if (body.length === 0) {
    return { ok: false, errors: ['commit message is empty'] };
  }

  const header = body[0]?.text ?? '';
  if (!GIT_GENERATED_HEADER.test(header)) {
    const subject = header.replace(AUTOSQUASH_PREFIX, '');
    if (!HEADER.test(subject)) {
      errors.push(
        `header must follow Conventional Commits "<type>(<scope>)!: <subject>" with type one of ${TYPES.join(', ')} and an optional scope in lower-case letters, digits, ".", "_", "/" or "-" (got "${header}")`,
      );
    }
    const length = [...subject].length;
    if (length > HEADER_MAX_LENGTH) {
      errors.push(
        `header is ${String(length)} characters long, the maximum is ${String(HEADER_MAX_LENGTH)}`,
      );
    }
  }

  // Comment lines are checked too: `git commit -m` keeps "#" lines, only the editor flow strips
  // them. Folded lines (a continuation indented by whitespace, RFC 822 style) are joined to the
  // line before so a trailer split over two lines is still seen as one.
  /** @type {Map<number, string>} */
  const flagged = new Map();
  for (const { text, number } of lines) {
    if (isAttribution(text)) {
      flagged.set(number, text);
    }
  }
  for (const { text, number } of fold(lines)) {
    if (!flagged.has(number) && isAttribution(text)) {
      flagged.set(number, text);
    }
  }
  for (const [number, text] of [...flagged].sort((a, b) => a[0] - b[0])) {
    errors.push(`attribution is not allowed (line ${String(number)}): "${text.trim()}"`);
  }

  return { ok: errors.length === 0, errors };
}

/**
 * Splits the message into lines with their 1-based numbers, dropping everything after the
 * scissors marker (`git commit -v`) and any invisible characters.
 * @param {string} message
 * @returns {{ text: string, number: number }[]}
 */
function messageLines(message) {
  /** @type {{ text: string, number: number }[]} */
  const kept = [];
  const raw = message.replace(INVISIBLE, '').split(/\r\n|\r|\n/);
  for (const [index, text] of raw.entries()) {
    if (SCISSORS.test(text)) {
      break;
    }
    kept.push({ text, number: index + 1 });
  }
  return kept;
}

/**
 * @param {{ text: string, number: number }[]} lines
 * @returns {{ text: string, number: number }[]}
 */
function trimBlank(lines) {
  let start = 0;
  let end = lines.length;
  while (start < end && lines[start]?.text.trim() === '') {
    start += 1;
  }
  while (end > start && lines[end - 1]?.text.trim() === '') {
    end -= 1;
  }
  return lines.slice(start, end);
}

/**
 * Joins whitespace-indented continuation lines onto the line before them.
 * @param {{ text: string, number: number }[]} lines
 * @returns {{ text: string, number: number }[]}
 */
function fold(lines) {
  /** @type {{ text: string, number: number }[]} */
  const folded = [];
  for (const { text, number } of lines) {
    const previous = folded[folded.length - 1];
    if (previous && /^\s+\S/.test(text)) {
      previous.text = `${previous.text} ${text.trim()}`;
    } else {
      folded.push({ text, number });
    }
  }
  return folded;
}

/**
 * @param {string} rawLine
 * @returns {boolean}
 */
function isAttribution(rawLine) {
  // A comment marker in front of a trailer hides nothing: `git commit -m` keeps those lines.
  const line = rawLine.trim().replace(/^#+\s*/, '');
  return (
    ROBOT_EMOJI.test(line) ||
    GENERATED_BANNER.test(line) ||
    AUTHORSHIP_TRAILER.test(line) ||
    BOT_SIGNATURE.test(line)
  );
}
