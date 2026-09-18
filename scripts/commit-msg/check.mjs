// @ts-check
// Commit message rules, shared by the git hook (cli.mjs) and its tests:
//   1. the header follows Conventional Commits: <type>(<scope>)!: <subject>
//   2. no attribution of any kind: AI co-author trailers, "generated with" banners, credits that
//      name an AI tool, robot emoji
// The hook is a safety net for what tools emit and for common credit phrasings, not a
// natural-language filter.

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

// Names that only ever mean an AI tool, plus names that need context because they are ordinary
// words or first names on their own (cursor, devin, codex, gemini, bot).
const TOOL_NAMES =
  /\b(claude|anthropic|copilot|chatgpt|openai|windsurf|aider|gpt-?\d)\b|\bcursor\s+(agent|ai|ide)\b|@cursor\.(com|sh)\b|\bdevin\s+ai\b|@devin\.ai\b|\bcodex\s+(cli|agent)\b|\bgemini\s+(cli|code|ai)\b|\[bot\]|noreply@anthropic\.com/i;
const GENERIC_AI = /\b(ai|llm)\b/i;
// A line that starts with "Generated with/by …" is the banner form every tool emits.
const GENERATED_BANNER = /^\W*generated\s+(with|by|using|via)\b/i;
const GENERATED = /\bgenerated\s+(with|by|using|via)\b/i;
const CREDIT =
  /\b(written|co-written|made|created|built|authored|co-authored|assisted|produced|crafted|developed|implemented|refactored|drafted|coded|(pair-)?programmed)\s+(with|by|using|via)\b/i;
// Any "<Something>-by:" or "<Something>-with:" trailer key, anywhere in the line.
const TRAILER = /\b[a-z]+(-[a-z]+)*-(by|with)\s*:/i;
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
  const line = rawLine.trim();
  if (ROBOT_EMOJI.test(line) || GENERATED_BANNER.test(line)) {
    return true;
  }
  if (!TOOL_NAMES.test(line) && !GENERIC_AI.test(line)) {
    return false;
  }
  return TRAILER.test(line) || GENERATED.test(line) || CREDIT.test(line);
}
