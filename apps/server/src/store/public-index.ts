// The index as the table sees it. The player view's routes get this object and nothing else: it
// reads the public columns and the public full-text table, and the rules of who has met what, and
// it has no method that returns a frontmatter value, a body or a link context. Whatever a route of
// the view can reach, it reaches through here — so what is not here cannot leak through it.
import {
  findCampaign,
  inCampaign,
  isPublicNote,
  sessionNumberOf,
  type CampaignInfo,
  type SearchHit,
} from '@rhizom/core';

import type { IndexContext } from './index/context.js';
import { BY_TITLE } from './index/glossary.js';
import { escapeHtml, MARK_END, MARK_START } from './index/search.js';

export interface PublicNote {
  path: string;
  /** The public title: the public text's first heading, else the file name. */
  title: string;
}

interface NoteRow {
  path: string;
  frontmatter: string;
}

const parse = (json: string): Record<string, unknown> => {
  const value: unknown = JSON.parse(json);
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
};

export class PublicIndex {
  readonly #ctx: IndexContext;

  constructor(ctx: IndexContext) {
    this.#ctx = ctx;
  }

  campaign(): CampaignInfo | null {
    const rows = this.#rows(`frontmatter like '%campaign%'`);
    return findCampaign(
      rows.map((row) => ({ path: row.path, frontmatter: parse(row.frontmatter) })),
    ).campaign;
  }

  /** The session notes of the campaign, by number. */
  sessions(campaign: CampaignInfo | null = this.campaign()): { path: string; session: number }[] {
    if (campaign === null) {
      return [];
    }
    return this.#rows(`frontmatter like '%session%'`)
      .flatMap((row) => {
        const session = sessionNumberOf(parse(row.frontmatter));
        return session !== undefined && inCampaign(campaign, row.path)
          ? [{ path: row.path, session }]
          : [];
      })
      .sort((a, b) => a.session - b.session || (a.path < b.path ? -1 : 1));
  }

  /** The newest session, which is what a view without a session shows. */
  latestSession(): number {
    return this.sessions().at(-1)?.session ?? 0;
  }

  /**
   * Every note the table may read at a session: the session notes up to it, the notes a session
   * note up to it links to from a line that is public by then, and the campaign's `public: true`
   * notes — all inside the campaign. Nothing else.
   */
  visible(session: number): Set<string> {
    const campaign = this.campaign();
    if (campaign === null) {
      return new Set();
    }
    const visible = new Set<string>();
    const played = this.sessions(campaign).filter((entry) => entry.session <= session);
    for (const entry of played) {
      visible.add(entry.path);
    }
    for (const row of this.#rows(`frontmatter like '%public%'`)) {
      if (inCampaign(campaign, row.path) && isPublicNote(parse(row.frontmatter))) {
        visible.add(row.path);
      }
    }
    // Where each link stands relative to the gate was decided when the note was indexed.
    const linksOf = this.#ctx.sqlite.prepare(
      `select target from links
       where source = ? and target is not null and (public_from is null or public_from <= ?)`,
    );
    for (const entry of played) {
      for (const link of linksOf.all(entry.path, session) as { target: string }[]) {
        if (inCampaign(campaign, link.target)) {
          visible.add(link.target);
        }
      }
    }
    return visible;
  }

  /** The visible notes with their public titles, alphabetical. */
  list(session: number): PublicNote[] {
    const visible = this.visible(session);
    const rows = this.#ctx.sqlite
      .prepare('select path, public_title as title from notes')
      .all() as PublicNote[];
    return rows
      .filter((row) => visible.has(row.path))
      .sort(
        (a, b) =>
          BY_TITLE.compare(a.title, b.title) || (a.path < b.path ? -1 : a.path > b.path ? 1 : 0),
      );
  }

  /** One visible note's public title, or undefined when the table may not read it. */
  note(session: number, path: string): PublicNote | undefined {
    if (!this.visible(session).has(path)) {
      return undefined;
    }
    return this.#ctx.sqlite
      .prepare('select path, public_title as title from notes where path = ?')
      .get(path) as PublicNote | undefined;
  }

  /** Full-text search over the public text of the visible notes. */
  search(session: number, query: string, limit: number): SearchHit[] {
    const tokens = query.match(/[\p{L}\p{N}_]+/gu) ?? [];
    if (tokens.length === 0) {
      return [];
    }
    const match = tokens.map((token) => `"${token.replaceAll('"', '""')}"*`).join(' ');
    const visible = this.visible(session);
    const rows = this.#ctx.sqlite
      .prepare(
        `select n.path, n.public_title as title,
                snippet(notes_public_fts, 1, ?, ?, '…', 24) as snippet,
                bm25(notes_public_fts, 10.0, 1.0) as score
         from notes_public_fts join notes n on n.id = notes_public_fts.rowid
         where notes_public_fts match ? order by score`,
      )
      .all(MARK_START, MARK_END, match) as {
      path: string;
      title: string;
      snippet: string;
      score: number;
    }[];
    return rows
      .filter((row) => visible.has(row.path))
      .slice(0, limit)
      .map((row) => ({
        path: row.path,
        title: row.title,
        snippet: escapeHtml(row.snippet)
          .replaceAll(MARK_START, '<mark>')
          .replaceAll(MARK_END, '</mark>'),
        score: -row.score,
      }));
  }

  /** Path and frontmatter of the notes whose frontmatter mentions a word, for the rules above. */
  #rows(where: string): NoteRow[] {
    return this.#ctx.sqlite
      .prepare(`select path, frontmatter from notes where ${where}`)
      .all() as NoteRow[];
  }
}
