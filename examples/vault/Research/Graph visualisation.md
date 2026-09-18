---
type: research
status: growing
sources:
  - Eades, Peter. "A heuristic for graph drawing." Congressus Numerantium 42, 1984.
  - 'Fruchterman, Thomas M. J. and Edward M. Reingold. "Graph drawing by force-directed placement." Software: Practice and Experience 21, 1991.'
  - 'Holten, Danny. "Hierarchical edge bundles: visualization of adjacency relations in hierarchical data." IEEE TVCG 12, 2006.'
  - Munzner, Tamara. Visualization Analysis and Design. CRC Press, 2014.
tags:
  - research
  - research/visualisation
---

# Graph visualisation

A vault is a graph whether anyone draws it or not: notes are nodes, links are edges. Drawing it is optional and, past a certain size, mostly decorative. This note is about when it is not.

## Node-link diagrams

The default picture. Dots for notes, lines for links, positions chosen by an algorithm because nobody wants to place three hundred dots by hand. Almost every tool uses a **force-directed layout**: edges pull connected nodes together like springs, all nodes push each other apart like charges, and the simulation runs until it settles. Eades described the spring version in 1984; Fruchterman and Reingold gave the form everyone implements in 1991. The pleasant properties fall out of the physics: clusters of densely linked notes end up close together, bridges between clusters get stretched, isolated notes drift to the edge.

The cost is quadratic in the number of nodes unless you approximate the repulsion, which everyone does (Barnes-Hut, a quadtree, close enough), and the result is not stable: run it twice and the picture is mirrored or rotated, which people find unsettling in a tool that is supposed to be a map.

## The hairball

Above a few hundred nodes, a force-directed drawing of a real vault is a ball of hair. Everything is connected to something, the springs pull it all into one lump, and the labels overlap into grey. This is not a bug in the layout; it is what the data looks like when you insist on showing every edge. The literature has three answers:

| Approach | What it does | Cost |
| --- | --- | --- |
| Filter | Show a neighbourhood, a folder, a tag, a time window | You have to know what to ask for |
| Aggregate | Collapse clusters into single nodes; expand on demand | Clusters have to be computed and named |
| Bundle | Route edges along shared paths so they read as ribbons (Holten 2006) | Needs a hierarchy to route along; folders will do |

Obsidian's own graph view does the first: filters, colour groups by search query, node size by number of links, and a local graph that shows one note and its neighbours to a chosen depth. It is honest about being a toy at scale; the options are listed on the [help page for the graph view](https://help.obsidian.md/plugins/graph).

## Sketch of the bubble field

What I want to try in the tool, and why this note exists. Instead of drawing folders as a tree in a sidebar and the graph as an undifferentiated lump, draw the graph and then draw each folder as a soft, translucent region round the nodes that belong to it, the way the milieu chart draws its blobs (see [[Sinus-Milieus#What the chart shows]] for why the softness matters). Regions may overlap where a note links heavily into another folder. Labels on the regions, not on the nodes, until you zoom in.

The tick of the simulation is nothing special; the region drawing is where the work is.

```ts
// one step of the layout; alpha decays towards zero as the drawing settles
function tick(nodes: LayoutNode[], edges: Edge[], alpha: number): void {
  for (const e of edges) {
    const dx = e.target.x - e.source.x;
    const dy = e.target.y - e.source.y;
    const d = Math.hypot(dx, dy) || 1e-6;
    const k = ((d - e.length) / d) * e.strength * alpha;
    e.source.vx += dx * k;
    e.source.vy += dy * k;
    e.target.vx -= dx * k;
    e.target.vy -= dy * k;
  }
  // repulsion goes here, approximated with a quadtree for anything past a few hundred nodes
  for (const n of nodes) {
    n.x += n.vx *= 0.6;
    n.y += n.vy *= 0.6;
  }
}
```

Open questions for the sketch:

- [ ] Convex hull per folder is too spiky; a blurred density field per folder, thresholded, gives the potato shape
- [ ] What happens to a note in the root, like [[Home]], that belongs to no folder
- [ ] Whether the [[Campaign/Campaign|Campaign]] folder note should be drawn as the region's label rather than as a node
- [ ] The maths for the initial placement, so the drawing is the same shape each time, goes in [[Research/Graph Layout Algorithms]] when I get to it

## What the picture is a picture of

It is a picture of brackets. Two notes are close because I typed a link, not because the ideas are close, and the tool cannot tell the difference between a link I made after an hour's thought and one I made because the name autocompleted. [[Mycorrhizal networks]] has the longer version of this caution; the short version is that the graph is a good index and a poor argument.

Related: [[Rhizomes]] for what a rhizome looks like when drawn (the answer is the hairball), [[Personal knowledge management#Retrieval]] for what I actually use instead of the graph most days.
