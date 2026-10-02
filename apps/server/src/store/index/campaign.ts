// The vault's campaign: the note whose `type` is `campaign`, and the folder it scopes. The rows
// are narrowed in SQL to the few whose frontmatter mentions the word at all, and the core decides
// which of those really is one, so the rule lives in one place for the server and the tests.
import { findCampaign, type CampaignInfo } from '@rhizom/core';

import type { IndexContext } from './context.js';

export function campaign(ctx: IndexContext): CampaignInfo | null {
  const rows = ctx.sqlite
    .prepare(`select path, frontmatter from notes where frontmatter like '%campaign%'`)
    .all() as { path: string; frontmatter: string }[];
  return findCampaign(
    rows.map((row) => ({
      path: row.path,
      frontmatter: JSON.parse(row.frontmatter) as Record<string, unknown>,
    })),
  ).campaign;
}
