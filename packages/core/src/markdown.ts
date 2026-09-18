/** File extensions that count as Markdown notes, lower-case and including the dot. */
export const MARKDOWN_EXTENSIONS = ['.md', '.markdown'] as const;

/**
 * Whether a path points to a Markdown note, judged by its file name alone.
 *
 * Both `/` and `\` are accepted as separators so the answer is the same on every platform, and
 * the extension is compared case-insensitively because Windows and macOS file systems usually
 * are. A name that consists of nothing but the extension (`.md`) is not a note.
 */
export function isMarkdownFile(filePath: string): boolean {
  const name = fileName(filePath).toLowerCase();
  return MARKDOWN_EXTENSIONS.some((ext) => name.length > ext.length && name.endsWith(ext));
}

function fileName(filePath: string): string {
  const separator = Math.max(filePath.lastIndexOf('/'), filePath.lastIndexOf('\\'));
  return separator === -1 ? filePath : filePath.slice(separator + 1);
}
