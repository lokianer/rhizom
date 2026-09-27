# The bubble field, redrawn: WebGL2, a milieu layer and motion that comes to rest

Date: 2026-09-27
Status: implemented 2026-09-27

## Why

The maintainer's words: the graph is the core of Rhizom and should become far richer to look
at — and a vault of 2,000 notes was very laggy. Both halves were measured before anything was
designed.

**Where the time goes.** On the maintainer's machine (Chrome 153, which was rasterising in
software on the Windows fallback adapter, 1920 × 937), 2,000 notes and 17,000 links, the camera
zooming and panning:

| renderer                                       | p50 ms / frame | p95 |
| ---------------------------------------------- | -------------- | --- |
| today: cached `Path2D` in graph units          | 100            | 200 |
| Canvas 2D immediate mode in screen space       | 202            | 329 |
| WebGL2 prototype: instanced edges, SDF bubbles | 42             | 67  |

The shipped field was measured afterwards against the old renderer in one harness (Chrome,
1920 × 937, the same vault and camera path): on the software adapter 37 frames a second against
16 (the field's own cost per frame 36 ms at the median, 46 ms at the 95th percentile), on a GPU
60 against 31 — the display's refresh is the limit there, and a frame costs under 2 ms.

In the live app a wheel zoom ran at 13–15 fps with long tasks of up to 650 ms. The JavaScript of
a frame costs almost nothing (the recorded calls add up to under a millisecond); the time is
rasterisation. At mid zoom about 560 labels are drawn per frame with `strokeText`, which alone
triples the frame. A GPU hides most of this, but not all of it — and a machine without one shows
all of it.

**Where the memory goes** (the memory work beyond the renderer is in `DECISIONS.md`, "2026-09-27
— Memory"): the renderer
builds a fresh set of `Path2D` objects on every layout tick, and their native memory stays
around until a main-thread GC — about 100 MB five seconds after the layout settles, peaks of
several hundred MB while it runs. The layout worker stays alive after the layout settled and
holds 65–80 MB of heap.

**What it should look like.** Four directions were built as prototypes on the real example vault
and a synthetic 2,000-note vault, rendered in both themes and judged by three independent
reviews (visual impact and brand, engineering and performance, readability and UX). None won
outright; the design below takes the look of one, the milieu layer of two others and the
interaction layer of the fourth; the next section says which gave what.

## The prototypes

Each was one self-contained page on a single Canvas 2D, fed the same two vaults and shot in the
same states. They live outside the repository.

- **Mycelium** — soil and hyphae: inner-lit spores, curved links, a hover that sinks the rest of
  the field into the soil and runs light along the lit links. The strongest Humus; it gave the
  look and the focus. Its links were tinted by cluster, and its halo breathed while nothing moved.
- **Milieu atlas** — territories with contour lines, the cluster names set into the field, a map
  key whose rows lift their cluster. It gave the territories, the legend and the paper look of
  Kalk; its graticule, neatline and serif display capitals were left behind.
- **Living field** — motion first: the field growing in, a gliding camera, links drawing
  themselves on. It gave the motion, and the milieu names at overview. Its drifting lights ran
  while nobody touched anything.
- **Precision instrument** — dataviz finesse: collision-free labels in sizes, plates, a card for
  the hovered note, a zoom control. It gave the words and the zoom control; the card went under
  the field as a bar, at the maintainer's word. It shaded unimportant notes lighter.

Three things were rejected across all four. Links tinted by cluster, because colour on a link is
kept for the typed relationships of Phase 3. Hue or lightness shifted by importance, because that
is Phase 4's heatmap colouring in disguise; importance is size and label weight. And anything that
moves while nobody touches the field, because it sits beside the editor.

## Decision: WebGL2 for the field, a 2D canvas for the words

The stack names "d3-force with Canvas rendering". The layout stays d3-force in its worker; the
drawing moves from the 2D context to a WebGL2 context on the same kind of canvas element, with a
transparent 2D canvas stacked above it for everything that is text. The maintainer chose this on
the numbers above. No library: WebGL2 is a browser API and the renderer is our own code, so no
dependency is added. Where WebGL2 is unavailable, or the context is lost and
cannot be restored, the field falls back to a Canvas 2D renderer behind the same interface: a
plainer picture — a flat ground, straight links and no territories — but never a blank page.

What WebGL2 buys, besides the frame time:

- **A layout tick touches no edge.** Node positions live in a float texture, uploaded whole from
  the worker's `Float32Array` (2,000 notes = 16 KB). Edges are a static instance buffer of index
  pairs, and the vertex shader fetches both endpoints. Today every tick rebuilds a path of 17,000
  segments on the main thread.
- **Shading is free.** A bubble is a quad whose fragment shader computes the disc, its light, its
  rim and its halo; a glow or a soft territory costs the pixels it covers and nothing per note.
- **No path garbage.** Nothing is allocated per frame or per tick, which removes the renderer's
  share of the memory problem outright.

## Layers

1. **WebGL2 canvas** (`alpha: false`, `antialias: false` — the shaders anti-alias, so there is no
   multisample buffer): ground and territories in one full-screen pass, quiet edges, the open
   note's edges, lit edges, bubbles. Redrawn only when the picture changes.
2. **Overlay 2D canvas**, transparent, same size, no pointer events: labels, the hover and
   selection plates, the selection ring, the milieu names. Label glyphs come from a sprite cache,
   never from `strokeText` per frame.
3. **DOM** (React): the legend and the zoom control over the field, the info bar under it. All
   text ≥ 16 px.

## The look

**Ground.** Humus is soil: the background colour with a faint grain. Kalk is chalk paper with a
paper grain. One ground texture, nothing else — no vignette, no graticule, no neatline: marks that
stand for no data do not belong on the field.

**Bubbles.** Matte spheres lit from the upper left: a two-circle radial body, a soft inner light
so a spore seems to glow from within on Humus, a thin rim with a little bounce light, a specular
of about a quarter strength. Not glass marbles, and no banding — the shader dithers. In Kalk the
same bubble is pigment on paper: a flat wash that pools darker at the rim and a soft sepia contact
shadow. Bubbles are opaque; edges end under them.

**Edges.** Mycelium white on Humus, ink on Kalk, and never tinted by cluster: colour on an edge is
reserved for the typed relationships of Phase 3. Gently curved (a quadratic curve with a bend of
a tenth of its length, the same side for the same pair), one device pixel wide on the quiet
layer — wider strokes on 17,000 edges fall off a cliff in software rasterisation. Alpha follows
the density of what is on screen, and long links are fainter than short ones, so a large vault is
a web and not a felt.

**The milieu layer.** Each cluster with enough notes (three and 3 % of the vault) gets a territory:
a soft wash of its colour over the density of its notes, with one faint shore line. Washes are
kept per palette colour, so past eight clusters two of one colour share a territory. The
densities are splatted into small off-screen textures in graph space and resolved into a wash and
a shore distance per colour whenever the positions, the focus or the palette change, then
composited under the web every frame, so the layer follows the live layout at no per-frame cost.
At overview the cluster names stand in the field — letter-spaced capitals tinted from the cluster
colour, for clusters of five notes and 3 % — and fade out as the reader zooms in, when the note
names take over; the washes recede to a quarter of their strength there. The vault root and the
untagged notes get a wash but no name; clusters of one or two notes get neither.

**Focus.** Hovering a note sinks everything outside its neighbourhood back into the soil (the
ground colour drawn over it, not a grey veil); its links draw themselves outward from it with a
spark at each tip, and each neighbour lights up as its link arrives. Then everything rests. The
open note keeps an ochre ring and its own links stroked in the accent colour under the bubbles, so
it stays traceable when the pointer is elsewhere. Hovering a row of the legend does the same for a
whole cluster.

**Words.** Labels are placed collision-free, most important first (degree), in three sizes; the
placement depends on the zoom, not the pan, so panning never reshuffles them. A label longer than
about 22 characters wraps onto a second line. Large bubbles carry their name inside, in whichever
ink contrasts. The hovered and the open note get a pill plate. The DOM overlays are obstacles for
labels and for fitting the view. Nothing on the canvas is smaller than 13 px.

**Scale.** In a vault of 300 notes or more, bubbles are drawn smaller at overview (from about 0.6
of their size) and grow back to true size by three times the fitted zoom, the way a map scales
its symbols. The layout of a large field adds the collision force, at full strength and in two
passes, from a third of its settling on (at once when it starts from a layout it already has), so
zooming in on 2,000 notes shows notes rather than a ball pit.

## Motion

Everything moves on interaction and then rests; at rest no frame is drawn.

- **Camera.** Wheel zoom eases in log-scale towards its target; a pan carries on with inertia
  when let go; "fit" and flying to a cluster from the legend go along a van Wijk path (zoom out,
  travel, zoom in). A double click on empty ground zooms in by two around the pointer.
- **Entry.** On first show the field grows in from the centre outwards: each bubble a short
  overshoot, staggered by its distance from the centre.
- **Hover.** The fade into the soil, the links drawing on, the neighbours lighting — about
  350 ms, then still.
- **Reduced motion.** `prefers-reduced-motion: reduce` snaps every animation to its end state.
- **Idle.** Nothing breathes, drifts or pulses. The graph sits beside the editor.

## Interaction added

- **Info bar** under the field: the note under the pointer, else the open note — folder, name,
  backlinks, outgoing links and rank. A card beside the bubble was built first and dropped at the
  maintainer's word: over the field it covers exactly the neighbours a hover is meant to show.
- **Legend**: cluster, colour, count; hovering a row focuses the cluster, clicking it flies to it;
  collapsible.
- **Zoom control**: +, −, fit, and the zoom as a percentage of the fitted view.
- **Letting go**: a click on empty ground deselects the open note (the `note` parameter leaves the
  URL, so the field is the whole vault again). It waits the length of a double click, so a double
  click only zooms; a drag from empty ground stays a pan, and a tap that stops a glide keeps the
  note.

Nothing from a later phase: no time-lapse, heatmap, orphan view or pinned bubbles (Phase 4), no
coloured or typed edges and no blocs (Phase 3), no keyboard navigation layer and no meta-bubbles
(Phase 6).

## Performance rules

- Nothing allocated per frame or per tick on the render path.
- Quiet edges ≤ 1 device px; wide or glowing strokes only for the O(degree) lit edges.
- Straight edges while the camera moves, curves at rest.
- Label count bounded by collision and a budget; glyphs from the sprite cache.
- The layout worker is terminated a moment after the layout settles and started again, from the
  current positions, when the layout is needed (a drag, new data).
- Budget: 2,000 notes / 17,000 links smooth while zooming on a GPU; on the software path, at least
  twice today's frame rate.

## Exports

The PNG is the same renderer drawn once into a canvas at twice the size, with the overlay drawn
on top at the same scale. The SVG is written from the same geometry: radial gradients for the
bubbles, the same curve formula for the edges (one function serves the shader's reference, the
SVG and the tests), blurred shapes for the territories, the labels as text.

## Out of scope here

The server and client memory work that is not the renderer's (the graph response, the watcher,
the young generation) is a slice of its own.
