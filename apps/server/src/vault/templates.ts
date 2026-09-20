// What a vault says about itself: where it keeps its templates, and where it keeps its daily
// notes. Both answers come from the same three places and are read the same way, which is why
// they live together.
//
// A template is not marked in the note; it is a note that lives in the template folder. That is
// how Obsidian does it, and the two templates in this repository's own example vault carry
// `type: npc` and `type: session` — the type of the note they produce, not of themselves. A rule
// keyed on the frontmatter would find neither, and would copy itself into every note made from
// one.
//
// The folder is looked for in three places, in this order: the operator's own setting, the
// vault's `.obsidian/templates.json`, and finally a top-level folder called Templates. The last
// one is what makes a vault that was never opened in Obsidian work anyway.
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import {
  DEFAULT_DATE_FORMAT,
  DEFAULT_TIME_FORMAT,
  ensureMarkdownExtension,
  toVaultPath,
  type DailySettings,
  type TemplateSettings,
} from '@rhizom/core';

// `TemplateSettings` and `DailySettings` are the core's: they are what `GET /api/vault` answers
// with, so the shape belongs where both ends of that answer can see it rather than being spelled
// once here and once there, with nothing to keep the two in step.
/** Folder names to look for when nothing has been configured, compared case-folded. */
const CONVENTIONAL = 'templates';
const CONVENTIONAL_DAILY = 'daily';

/**
 * Reads the template settings of the vault rooted at `root`. Nothing here throws: a vault with
 * no settings, an unreadable `.obsidian` or a file holding something other than JSON all mean
 * "this vault has not said", not "this vault cannot be opened".
 */
export function readTemplateSettings(root: string, configured?: string): TemplateSettings {
  const obsidian = readObsidianSettings(root, 'templates.json');
  const folder =
    vaultFolder(configured) ?? vaultFolder(obsidian.folder) ?? conventional(root, CONVENTIONAL);
  return {
    folder,
    dateFormat: nonEmpty(obsidian.dateFormat) ?? DEFAULT_DATE_FORMAT,
    timeFormat: nonEmpty(obsidian.timeFormat) ?? DEFAULT_TIME_FORMAT,
  };
}

/**
 * Reads what the vault says about daily notes. Same three places as the templates, same
 * silence on a vault that has not said: a folder called Daily is enough to make one work.
 *
 * The template is only reported when it names something inside the vault; whether the note is
 * actually there is the caller's business, because a settings file outlives the note it names.
 */
export function readDailySettings(root: string, configured?: string): DailySettings {
  const obsidian = readObsidianSettings(root, 'daily-notes.json');
  const folder =
    vaultFolder(configured) ??
    vaultFolder(obsidian.folder) ??
    conventional(root, CONVENTIONAL_DAILY);
  const template = vaultFolder(obsidian.template);
  return {
    folder,
    format: nonEmpty(obsidian.format) ?? DEFAULT_DATE_FORMAT,
    template: template === null ? null : ensureMarkdownExtension(template),
  };
}

interface ObsidianSettings {
  folder?: unknown;
  dateFormat?: unknown;
  timeFormat?: unknown;
  format?: unknown;
  template?: unknown;
}

function readObsidianSettings(root: string, file: string): ObsidianSettings {
  try {
    const raw: unknown = JSON.parse(readFileSync(join(root, '.obsidian', file), 'utf8'));
    return typeof raw === 'object' && raw !== null ? raw : {};
  } catch {
    return {};
  }
}

/**
 * A setting as a vault path, through the same normalisation every other path in Rhizom goes
 * through: trimmed, NFC, forward slashes, no empty and no `.` segments. A leading slash reads as
 * "from the vault root", which is what somebody who writes one means. A drive letter, a UNC
 * share or a `..` is refused instead: whatever those name, it is not a folder in this vault.
 */
function vaultFolder(value: unknown): string | null {
  if (typeof value !== 'string' || /^([a-z]:|\\\\)/i.test(value.trim())) {
    return null;
  }
  const folder = toVaultPath(value);
  if (folder === '' || folder.split('/').includes('..')) {
    return null;
  }
  return folder;
}

/** A top-level folder of that name, in whatever case the vault spells it. */
function conventional(root: string, name: string): string | null {
  try {
    const entry = readdirSync(root, { withFileTypes: true }).find(
      (candidate) => candidate.isDirectory() && candidate.name.toLowerCase() === name,
    );
    return entry?.name ?? null;
  } catch {
    return null;
  }
}

function nonEmpty(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value : undefined;
}
