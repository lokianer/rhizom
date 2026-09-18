// Vault paths are the identity of notes: POSIX-style, relative to the vault root, NFC-normalised,
// including the file extension (`Campaign/NPCs/Mira.md`). These helpers are pure string
// functions so they work identically in the browser and on every server platform.

const MARKDOWN_EXTENSION = /\.(md|markdown)$/i;
// Windows reserved device names, which cannot be created there whatever the extension.
const RESERVED_NAME = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;
// Characters no supported file system accepts in a name; control characters are checked separately.
const FORBIDDEN_CHARACTERS = /[<>:"|?*]/;

/**
 * Normalises user or file-system input into vault-path form: slashes, no empty or `.`
 * segments, no leading slash, NFC unicode. `..` segments are kept so isSafeVaultPath can reject
 * them.
 */
export function toVaultPath(input: string): string {
  return input
    .trim()
    .normalize('NFC')
    .replaceAll('\\', '/')
    .split('/')
    .filter((segment) => segment !== '' && segment !== '.')
    .join('/');
}

/**
 * Whether a normalised vault path may be used to read or write inside the vault: relative,
 * no traversal, no characters or names a supported file system would refuse.
 */
export function isSafeVaultPath(path: string): boolean {
  if (path === '' || FORBIDDEN_CHARACTERS.test(path) || hasControlCharacter(path)) {
    return false;
  }
  return path
    .split('/')
    .every(
      (segment) =>
        segment !== '' &&
        segment !== '.' &&
        segment !== '..' &&
        !/[. ]$/.test(segment) &&
        !RESERVED_NAME.test(segment.replace(/\.[^.]*$/, '')),
    );
}

function hasControlCharacter(path: string): boolean {
  for (const character of path) {
    if (character.charCodeAt(0) < 0x20) {
      return true;
    }
  }
  return false;
}

/** Appends `.md` unless the path already has a Markdown extension (in any case). */
export function ensureMarkdownExtension(path: string): string {
  return MARKDOWN_EXTENSION.test(path) ? path : `${path}.md`;
}

/** The note name: the last path segment without its Markdown extension. */
export function noteNameOf(path: string): string {
  const segment = path.slice(path.lastIndexOf('/') + 1);
  return segment.replace(MARKDOWN_EXTENSION, '');
}

/** The folder part of a vault path; empty for notes at the vault root. */
export function folderOf(path: string): string {
  const slash = path.lastIndexOf('/');
  return slash === -1 ? '' : path.slice(0, slash);
}
