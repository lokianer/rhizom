// Indexes the example vault from the repository and checks the result against
// examples/vault.manifest.json: the acceptance test for "a real Obsidian vault opens and works".
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { LinkKind, NoteLink } from '@rhizom/core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { syncVault } from './store/sync.js';
import { VaultIndex } from './store/vault-index.js';
import { openVault, type Vault } from './vault/files.js';

interface LinkExpectation {
  from: string;
  raw: string;
  resolvesTo: string;
  heading?: string;
}

interface Manifest {
  notes: {
    count: number;
    byFolder: Record<string, number>;
    ignored: string[];
    assets: string[];
    maxTotalBytes: number;
  };
  unresolvedLinks: { targets: string[]; sources: Record<string, string[]> };
  ambiguousBasename: { name: string; candidates: string[]; linkedBareFrom: string[] };
  aliasLinks: { target: string; resolvesTo: string }[];
  spacedWikilink: LinkExpectation;
  folderPathLinks: LinkExpectation[];
  headingLinks: LinkExpectation[];
  markdownLinks: { from: string; href: string; resolvesTo: string }[];
  embeds: (LinkExpectation & { kind: string })[];
  specialFiles: {
    crlf: string;
    bom: string;
    empty: string;
    long: { path: string; minBytes: number };
    invalidFrontmatter: string;
    emptyFrontmatter: string;
    commaSeparatedTags: string;
    folderNote: { path: string; color: string };
  };
  frontmatter: Record<string, Record<string, unknown>>;
  tags: { mustExist: string[]; mustNotExist: string[]; countsPerNote: Record<string, number> };
  titles: Record<string, string>;
}

const examplesDir = fileURLToPath(new URL('../../../examples/', import.meta.url));
const manifest = JSON.parse(
  readFileSync(join(examplesDir, 'vault.manifest.json'), 'utf8'),
) as Manifest;

function totalBytes(dir: string): number {
  let sum = 0;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    sum += entry.isDirectory() ? totalBytes(path) : statSync(path).size;
  }
  return sum;
}

/** The inner text of a wikilink or the href of a Markdown link, as the index stores it. */
function rawTarget(raw: string): string {
  const wiki = /^!?\[\[(.*)\]\]$/.exec(raw);
  if (wiki !== null) {
    return wiki[1] ?? raw;
  }
  const markdown = /\]\((.*)\)$/.exec(raw);
  return markdown?.[1] ?? raw;
}

describe('the example vault', () => {
  let vault: Vault;
  let index: VaultIndex;
  const linksFrom = new Map<string, NoteLink[]>();

  const findLink = (from: string, raw: string, kind?: LinkKind): NoteLink => {
    const wanted = rawTarget(raw);
    const link = linksFrom
      .get(from)
      ?.find((l) => (l.raw === wanted || l.raw === raw) && (kind === undefined || l.kind === kind));
    if (link === undefined) {
      throw new Error(`No link ${raw} in ${from}`);
    }
    return link;
  };

  beforeAll(async () => {
    vault = openVault(join(examplesDir, 'vault'));
    index = VaultIndex.open(':memory:');
    await syncVault(vault, index);
    for (const note of index.listNotes()) {
      linksFrom.set(note.path, index.linksFrom(note.path));
    }
  });

  afterAll(() => {
    index.close();
  });

  it('stays small', () => {
    expect(totalBytes(vault.root)).toBeLessThanOrEqual(manifest.notes.maxTotalBytes);
  });

  it('indexes every note and nothing from hidden folders', () => {
    const notes = index.listNotes();
    expect(notes).toHaveLength(manifest.notes.count);

    const byFolder: Record<string, number> = {};
    for (const note of notes) {
      byFolder[note.folder] = (byFolder[note.folder] ?? 0) + 1;
    }
    expect(byFolder).toEqual(manifest.notes.byFolder);

    for (const ignored of manifest.notes.ignored) {
      expect(index.getNote(ignored)).toBeUndefined();
    }
    expect(notes.some((note) => note.path.startsWith('.'))).toBe(false);
  });

  it('lists the attachments as assets', async () => {
    const assets = (await vault.listAssets()).map((asset) => asset.path).sort();
    expect(assets).toEqual([...manifest.notes.assets].sort());
  });

  it('reports exactly the unresolved links of the manifest', () => {
    const targets = index.unresolved().map((entry) => entry.target);
    expect(targets.sort()).toEqual([...manifest.unresolvedLinks.targets].sort());

    for (const [target, sources] of Object.entries(manifest.unresolvedLinks.sources)) {
      for (const source of sources) {
        const link = linksFrom.get(source)?.find((l) => l.raw === target);
        expect(link, `${source} links to ${target}`).toBeDefined();
        expect(link?.target).toBeNull();
      }
    }
  });

  it('resolves the ambiguous name to one of its candidates', () => {
    const { name, candidates, linkedBareFrom } = manifest.ambiguousBasename;
    for (const source of linkedBareFrom) {
      const link = findLink(source, `[[${name}]]`);
      expect(candidates, `${source} -> ${String(link.target)}`).toContain(link.target);
    }
  });

  it('resolves aliases, spaces, folder paths, headings and Markdown links', () => {
    const allLinks = [...linksFrom.values()].flat();
    for (const { target, resolvesTo } of manifest.aliasLinks) {
      const uses = allLinks.filter((link) => link.raw === target);
      expect(uses.length, `uses of [[${target}]]`).toBeGreaterThan(0);
      for (const use of uses) {
        expect(use.target).toBe(resolvesTo);
      }
    }

    const spaced = manifest.spacedWikilink;
    expect(findLink(spaced.from, spaced.raw).target).toBe(spaced.resolvesTo);

    for (const expectation of manifest.folderPathLinks) {
      expect(findLink(expectation.from, expectation.raw).target).toBe(expectation.resolvesTo);
    }
    for (const expectation of manifest.headingLinks) {
      const link = findLink(expectation.from, expectation.raw);
      expect(link.target).toBe(expectation.resolvesTo);
      expect(link.heading).toBe(expectation.heading);
    }
    for (const expectation of manifest.markdownLinks) {
      const link = linksFrom.get(expectation.from)?.find((l) => l.kind === 'markdown');
      expect(link?.target).toBe(expectation.resolvesTo);
    }
  });

  it('keeps embeds apart from links', () => {
    for (const embed of manifest.embeds) {
      const link = findLink(embed.from, embed.raw, 'embed');
      if (embed.kind === 'note' || embed.kind === 'heading') {
        expect(link.target).toBe(embed.resolvesTo);
      }
    }
    // Attachments are not notes, so an embed of one must never count as a broken link.
    const unresolved = index.unresolved().map((entry) => entry.target);
    for (const embed of manifest.embeds) {
      expect(unresolved).not.toContain(rawTarget(embed.raw));
    }
  });

  it('survives the special files', async () => {
    const { specialFiles } = manifest;

    const crlf = await vault.readNote(specialFiles.crlf);
    expect(crlf.eol).toBe('\r\n');
    expect(crlf.content).not.toContain('\r');
    expect(index.getNote(specialFiles.crlf)?.title).toBe('Zettelkasten');

    const bom = await vault.readNote(specialFiles.bom);
    expect(bom.bom).toBe(true);
    expect(bom.content.startsWith('---')).toBe(true);

    expect(index.getNote(specialFiles.empty)?.title).toBe(manifest.titles[specialFiles.empty]);
    expect(index.getNote(specialFiles.long.path)?.size).toBeGreaterThanOrEqual(
      specialFiles.long.minBytes,
    );

    const broken = index.getNote(specialFiles.invalidFrontmatter);
    expect(broken?.title).toBe(manifest.titles[specialFiles.invalidFrontmatter]);
    expect(broken?.tags).toEqual([]);

    expect(index.getNote(specialFiles.emptyFrontmatter)?.frontmatter).toEqual({});

    const folderNote = index.getNote(specialFiles.folderNote.path);
    expect(folderNote?.frontmatter.color).toBe(specialFiles.folderNote.color);
  });

  it('reads the frontmatter the manifest describes', () => {
    for (const [path, expected] of Object.entries(manifest.frontmatter)) {
      const record = index.getNote(path);
      expect(record, path).toBeDefined();
      if ('error' in expected) {
        continue;
      }
      const { tagsParsedAs, ...fields } = expected;
      expect(record?.frontmatter, path).toMatchObject(fields);
      if (Array.isArray(tagsParsedAs)) {
        expect([...(record?.tags ?? [])].sort()).toEqual([...(tagsParsedAs as string[])].sort());
      }
    }
  });

  it('collects the tags with their note counts', () => {
    const counts = Object.fromEntries(index.tags().map((entry) => [entry.tag, entry.count]));
    for (const tag of manifest.tags.mustExist) {
      expect(counts[tag], tag).toBeGreaterThan(0);
    }
    for (const tag of manifest.tags.mustNotExist) {
      expect(counts[tag], tag).toBeUndefined();
    }
    expect(counts).toEqual(manifest.tags.countsPerNote);
  });

  it('derives titles from frontmatter, the first heading or the file name', () => {
    for (const [path, title] of Object.entries(manifest.titles)) {
      expect(index.getNote(path)?.title, path).toBe(title);
    }
  });
});
