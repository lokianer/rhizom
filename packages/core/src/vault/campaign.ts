// The campaign module is switched on by a note. A note whose `type` is `campaign` names the game
// system and scopes its own folder and everything below it; inside that scope the module's types
// are read through `campaignTypeOf`, outside it a `type: npc` is a note like any other. The
// globally reserved types stay the four of Phase 2 (see frontmatter.ts): the module's vocabulary
// belongs to the module. Its readers — the GM gate, the session spine — come with later steps.

/** The kinds of note the module knows, in the order an interface lists them. */
export const CAMPAIGN_TYPES = ['npc', 'place', 'faction', 'item', 'quest', 'session'] as const;

export type CampaignType = (typeof CAMPAIGN_TYPES)[number];

const MODULE_TYPES: ReadonlySet<string> = new Set(CAMPAIGN_TYPES);

/** The campaign of a vault, as `GET /api/v/{vault}/vault` reports it. */
export interface CampaignInfo {
  /** Vault path of the campaign note. */
  path: string;
  /** The folder it scopes; empty for the vault root, which scopes everything. */
  folder: string;
  /** The game system as the note names it, or null when it names none. */
  system: string | null;
}

function typeOf(frontmatter: Record<string, unknown>): string | undefined {
  const value = frontmatter.type;
  return typeof value === 'string' ? value.trim().toLowerCase() : undefined;
}

/**
 * The vault's campaign. One per vault for now: of several campaign notes the one with the
 * smallest path wins — an order that does not depend on how the index happened to scan — and the
 * others are handed back so something can say they were passed over.
 */
export function findCampaign(
  notes: readonly { path: string; frontmatter: Record<string, unknown> }[],
): { campaign: CampaignInfo | null; ignored: string[] } {
  const candidates = notes
    .filter((note) => typeOf(note.frontmatter) === 'campaign')
    .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  const [first, ...rest] = candidates;
  if (first === undefined) {
    return { campaign: null, ignored: [] };
  }
  const slash = first.path.lastIndexOf('/');
  const system = first.frontmatter.system;
  return {
    campaign: {
      path: first.path,
      folder: slash === -1 ? '' : first.path.slice(0, slash),
      system: typeof system === 'string' && system.trim() !== '' ? system.trim() : null,
    },
    ignored: rest.map((note) => note.path),
  };
}

/** Whether a vault path lies inside the campaign's scope. */
export function inCampaign(campaign: CampaignInfo | null, path: string): boolean {
  if (campaign === null) {
    return false;
  }
  // With the separator, so that `Campaign/` does not also claim `Campaigner/`.
  return campaign.folder === '' || path.startsWith(`${campaign.folder}/`);
}

/** The module type of a note, while the module is on and the note lies inside its scope. */
export function campaignTypeOf(
  frontmatter: Record<string, unknown>,
  path: string,
  campaign: CampaignInfo | null,
): CampaignType | undefined {
  const type = typeOf(frontmatter);
  if (type === undefined || !MODULE_TYPES.has(type) || !inCampaign(campaign, path)) {
    return undefined;
  }
  return type as CampaignType;
}
