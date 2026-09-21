import { describe, expect, it } from 'vitest';

import { buildGraph, clusterColorIndex, localGraph, type GraphLink } from './graph.js';

const notes = [
  { path: 'Home.md', tags: ['index'] },
  { path: 'Campaign/Places/Silverstadt.md', tags: ['campaign', 'places'] },
  { path: 'Campaign/NPCs/Mira.md', tags: ['campaign', 'npcs'] },
  { path: 'Research/Rhizome.md', tags: ['research'] },
  { path: 'Research/Mycelium.md', tags: [] },
];

const links: GraphLink[] = [
  { source: 'Home.md', target: 'Campaign/Places/Silverstadt.md', kind: 'wikilink' },
  { source: 'Home.md', target: 'Research/Rhizome.md', kind: 'wikilink' },
  { source: 'Campaign/Places/Silverstadt.md', target: 'Campaign/NPCs/Mira.md', kind: 'wikilink' },
  { source: 'Campaign/NPCs/Mira.md', target: 'Campaign/Places/Silverstadt.md', kind: 'wikilink' },
  { source: 'Campaign/NPCs/Mira.md', target: 'Campaign/Places/Silverstadt.md', kind: 'markdown' },
  { source: 'Research/Rhizome.md', target: 'Research/Mycelium.md', kind: 'wikilink' },
  { source: 'Research/Rhizome.md', target: 'Research/Rhizome.md', kind: 'wikilink' },
  { source: 'Research/Rhizome.md', target: null, kind: 'wikilink' },
];

describe('buildGraph', () => {
  const graph = buildGraph(notes, links, { clusterBy: 'folder' });

  it('creates one node per note with in, out and total degree', () => {
    expect(graph.nodes).toHaveLength(5);
    const silverstadt = graph.nodes.find((n) => n.path === 'Campaign/Places/Silverstadt.md');
    expect(silverstadt).toMatchObject({
      name: 'Silverstadt',
      folder: 'Campaign/Places',
      inDegree: 2,
      outDegree: 1,
      degree: 3,
    });
  });

  it('merges repeated links between the same pair into one edge with a count', () => {
    const edge = graph.edges.find(
      (e) => e.source === 'Campaign/NPCs/Mira.md' && e.target === 'Campaign/Places/Silverstadt.md',
    );
    expect(edge).toEqual({
      source: 'Campaign/NPCs/Mira.md',
      target: 'Campaign/Places/Silverstadt.md',
      count: 2,
    });
    expect(graph.edges).toHaveLength(5);
  });

  it('counts a resolved embed as an edge and says how many of the links transclude', () => {
    const embedded = buildGraph(
      notes,
      [
        { source: 'Home.md', target: 'Research/Mycelium.md', kind: 'embed' },
        { source: 'Home.md', target: 'Research/Rhizome.md', kind: 'embed' },
        { source: 'Home.md', target: 'Research/Rhizome.md', kind: 'wikilink' },
      ],
      { clusterBy: 'folder' },
    );
    expect(embedded.edges).toEqual([
      { source: 'Home.md', target: 'Research/Mycelium.md', count: 1, embeds: 1 },
      { source: 'Home.md', target: 'Research/Rhizome.md', count: 2, embeds: 1 },
    ]);
    expect(embedded.nodes.find((n) => n.path === 'Research/Mycelium.md')?.degree).toBe(1);
  });

  it('leaves an edge with no transclusion unmarked, so the response does not grow', () => {
    expect(graph.edges.every((edge) => !('embeds' in edge))).toBe(true);
  });

  it('ignores self links and unresolved links', () => {
    expect(graph.edges.some((e) => e.source === e.target)).toBe(false);
    const rhizome = graph.nodes.find((n) => n.path === 'Research/Rhizome.md');
    expect(rhizome?.outDegree).toBe(1);
  });

  it('clusters by top-level folder, with the vault root as its own cluster', () => {
    expect(graph.nodes.find((n) => n.path === 'Home.md')?.cluster).toBe('');
    expect(graph.nodes.find((n) => n.path === 'Campaign/NPCs/Mira.md')?.cluster).toBe('Campaign');
    expect(graph.clusters).toEqual(['', 'Campaign', 'Research']);
  });

  it('clusters by first tag when asked, with untagged notes in an empty cluster', () => {
    const byTag = buildGraph(notes, links, { clusterBy: 'tag' });
    expect(byTag.nodes.find((n) => n.path === 'Campaign/NPCs/Mira.md')?.cluster).toBe('campaign');
    expect(byTag.nodes.find((n) => n.path === 'Research/Mycelium.md')?.cluster).toBe('');
    expect(byTag.clusters).toEqual(['', 'campaign', 'index', 'research']);
  });
});

describe('localGraph', () => {
  const graph = buildGraph(notes, links, { clusterBy: 'folder' });

  it('returns the centre and its direct neighbours at depth 1, in either link direction', () => {
    const local = localGraph(graph, 'Campaign/Places/Silverstadt.md', 1);
    expect(local.nodes.map((n) => n.path).sort()).toEqual([
      'Campaign/NPCs/Mira.md',
      'Campaign/Places/Silverstadt.md',
      'Home.md',
    ]);
    expect(local.edges).toHaveLength(3);
  });

  it('expands by one hop per depth level and keeps only edges between included nodes', () => {
    const local = localGraph(graph, 'Campaign/NPCs/Mira.md', 2);
    expect(local.nodes.map((n) => n.path).sort()).toEqual([
      'Campaign/NPCs/Mira.md',
      'Campaign/Places/Silverstadt.md',
      'Home.md',
    ]);
    const deeper = localGraph(graph, 'Campaign/NPCs/Mira.md', 3);
    expect(deeper.nodes.map((n) => n.path)).toContain('Research/Rhizome.md');
    expect(deeper.nodes.map((n) => n.path)).not.toContain('Research/Mycelium.md');
  });

  it('returns an empty graph for an unknown centre', () => {
    expect(localGraph(graph, 'Nope.md', 2)).toEqual({ nodes: [], edges: [], clusters: [] });
  });
});

describe('clusterColorIndex', () => {
  it('is deterministic and stays within the palette size', () => {
    const first = clusterColorIndex('Campaign', 8);
    expect(clusterColorIndex('Campaign', 8)).toBe(first);
    expect(first).toBeGreaterThanOrEqual(0);
    expect(first).toBeLessThan(8);
  });

  it('spreads different clusters over the palette', () => {
    const indices = new Set(
      ['Campaign', 'Research', 'Daily', 'Projects', 'Reading'].map((c) => clusterColorIndex(c, 8)),
    );
    expect(indices.size).toBeGreaterThan(2);
  });
});
