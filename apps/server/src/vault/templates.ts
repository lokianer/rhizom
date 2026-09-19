// Where a vault keeps its templates, and what its placeholders mean by "the date".
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

import { toVaultPath } from '@rhizom/core';

/** What `GET /api/vault` reports about templates. */
export interface TemplateSettings {
  /** Vault path of the folder holding them, or null when this vault has none. */
  folder: string | null;
  /** What `{{date}}` means without a format of its own. */
  dateFormat: string;
  /** What `{{time}}` means without a format of its own. */
  timeFormat: string;
}

const DEFAULT_DATE = 'YYYY-MM-DD';
const DEFAULT_TIME = 'HH:mm';
/** The folder name to look for when nothing has been configured, compared case-folded. */
const CONVENTIONAL = 'templates';

/**
 * Reads the template settings of the vault rooted at `root`. Nothing here throws: a vault with
 * no settings, an unreadable `.obsidian` or a file holding something other than JSON all mean
 * "this vault has not said", not "this vault cannot be opened".
 */
export function readTemplateSettings(root: string, configured?: string): TemplateSettings {
  const obsidian = readObsidianSettings(root);
  const folder = vaultFolder(configured) ?? vaultFolder(obsidian.folder) ?? conventional(root);
  return {
    folder,
    dateFormat: nonEmpty(obsidian.dateFormat) ?? DEFAULT_DATE,
    timeFormat: nonEmpty(obsidian.timeFormat) ?? DEFAULT_TIME,
  };
}

interface ObsidianTemplates {
  folder?: unknown;
  dateFormat?: unknown;
  timeFormat?: unknown;
}

function readObsidianSettings(root: string): ObsidianTemplates {
  try {
    const raw: unknown = JSON.parse(
      readFileSync(join(root, '.obsidian', 'templates.json'), 'utf8'),
    );
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

/** A top-level folder named Templates, in whatever case the vault spells it. */
function conventional(root: string): string | null {
  try {
    const entry = readdirSync(root, { withFileTypes: true }).find(
      (candidate) => candidate.isDirectory() && candidate.name.toLowerCase() === CONVENTIONAL,
    );
    return entry?.name ?? null;
  } catch {
    return null;
  }
}

function nonEmpty(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value : undefined;
}
