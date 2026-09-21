// Today's note: which file it is, and what it starts from.
//
// The vault decides both — the folder and the name's format come from `GET /api/vault`, which
// reads the operator's setting, Obsidian's own `daily-notes.json`, or simply a folder called
// Daily. So a vault brought from Obsidian keeps its own arrangement, and one that was never
// opened there works anyway.
//
// A name may hold slashes (`YYYY/MM/DD` is a common arrangement), and that is deliberate: it
// makes folders, exactly as it does in Obsidian.
import { ensureMarkdownExtension, formatDate, toVaultPath, type DailySettings } from '@rhizom/core';

/**
 * The vault path of the note for this day, or null when the vault keeps no daily notes — in
 * which case the command that would open one is not offered at all.
 *
 * The date is formatted in the language the app is read in, because a format may name a weekday
 * or a month; `dddd` on a German interface should give `Sonntag`.
 */
export function dailyNotePath(daily: DailySettings, now: Date, locale: string): string | null {
  if (daily.folder === null) {
    return null;
  }
  const name = toVaultPath(formatDate(now, daily.format, locale));
  if (name === '') {
    return null;
  }
  return ensureMarkdownExtension(toVaultPath(`${daily.folder}/${name}`));
}
