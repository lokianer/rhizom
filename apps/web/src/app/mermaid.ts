// Diagrams in the rendered note. Core turns a ```mermaid fence into a container with the
// diagram's source inside it as an ordinary code block; this is the pass that comes after and
// puts the drawn diagram in.
//
// Mermaid is by far the largest thing this app could pull in, so it is never imported here.
// `./mermaid-draw.js` is the only module that names it, nothing imports that one statically,
// and it is fetched with `import()` the first time a container is actually on screen — a vault
// without a single diagram in it downloads none of it.
//
// What is in this file is the part that can be reasoned about without a browser: which class to
// look for, what a theme made of `--rz-*` tokens says to mermaid, what is left of an error after
// it has been cut down to one line, and the memory of what has already been drawn.

/**
 * Core's `MERMAID_CLASS`, written out the way every other `rz-` class the app selects on is.
 * The container holds the source; the figure and the failure line are appended beside it.
 */
const CONTAINER_CLASS = 'rz-mermaid';
const FIGURE_CLASS = 'rz-mermaid-figure';
const FAILURE_CLASS = 'rz-mermaid-failure';

export const MERMAID_SELECTOR = `.${CONTAINER_CLASS}`;

/** One attempt at one diagram: the SVG, or the reason there is none yet. */
export type Diagram = { state: 'ready'; svg: string } | { state: 'failed'; message: string };

/**
 * The words a failed diagram is shown with. It is one muted line under the source the writer is
 * still typing, never a banner: a half-written diagram is a syntax error on nearly every
 * keystroke, and nothing about that is worth interrupting them for.
 */
export interface DiagramLabels {
  failed: (message: string) => string;
  /** When whatever was thrown said nothing that can be shown. */
  failedPlain: string;
}

/**
 * Every diagram drawn so far, by its source. The preview re-renders on every keystroke and
 * React writes the HTML again each time, so without this the diagrams on the page would be
 * drawn from scratch for every character typed anywhere in the note. A source that has not
 * changed is answered from here instead, and synchronously, so it never flickers.
 *
 * Typing inside a diagram does produce a new entry per keystroke, nearly all of them failures,
 * which is why the map is bounded. Past the limit the lot is dropped rather than the oldest
 * entry found: the cost is redrawing what is on screen once, which is what the memory saves in
 * the first place.
 */
const drawn = new Map<string, Diagram>();
const MAX_REMEMBERED = 64;

export function rememberedDiagram(source: string): Diagram | undefined {
  return drawn.get(source);
}

export function rememberDiagram(source: string, diagram: Diagram): void {
  if (drawn.size >= MAX_REMEMBERED) {
    drawn.clear();
  }
  drawn.set(source, diagram);
}

/** Drops the memory. The theme changed, so every diagram is drawn in the wrong colours. */
export function forgetDiagrams(): void {
  drawn.clear();
}

/** A failure is one line; mermaid's parse errors are a paragraph with the grammar in them. */
const MAX_MESSAGE = 120;

/**
 * The one line to show for whatever mermaid threw. Mermaid answers a syntax error with several
 * lines — the complaint, the offending text, a caret under it, then the list of tokens it would
 * have accepted — and the first of them is the one that names what went wrong and where.
 */
export function diagramMessage(error: unknown): string {
  const raw = error instanceof Error ? error.message : typeof error === 'string' ? error : '';
  const line =
    raw
      .split('\n')
      .find((candidate) => candidate.trim() !== '')
      ?.trim() ?? '';
  // Written by the ellipsis rather than cut off flat, so it is plain that there was more.
  return line.length > MAX_MESSAGE ? `${line.slice(0, MAX_MESSAGE - 1).trimEnd()}…` : line;
}

/** The `--rz-*` tokens a theme is built from, already resolved against the live page. */
export interface ThemeTokens {
  /** One custom property as an `rgb(…)` string. */
  colour: (token: string) => string;
  /** `--rz-font-sans`, on one line. */
  fontSans: string;
  /** `--rz-text-md`, in pixels. */
  fontSize: string;
}

/** What mermaid is handed as `themeVariables`; it takes booleans as well as colours. */
export type DiagramTheme = Record<string, string | boolean>;

/** The cluster palette, `--rz-cluster-1` … `--rz-cluster-8`; the graph draws its bubbles in it. */
const CLUSTER_COUNT = 8;

/**
 * Whether a resolved colour reads as dark.
 *
 * Mermaid's `base` theme derives most of its shades from the few colours it is given, and it
 * lightens or darkens them depending on this flag; told the wrong one it puts dark text on a
 * dark node. The page cannot simply be asked — `color-scheme` is `light dark` under the "follow
 * the system" setting — so the background it actually resolved to is measured instead.
 */
export function isDark(colour: string): boolean {
  const channels = [...colour.matchAll(/\d+(?:\.\d+)?/g)]
    .slice(0, 3)
    .map((match) => Number(match[0]));
  const [red = 0, green = 0, blue = 0] = channels;
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue < 128;
}

/**
 * Rhizom's tokens as a mermaid theme.
 *
 * Mermaid draws in its own palette by default, which in Humus looks like a screenshot from
 * another program dropped into the note. Built on mermaid's `base` theme, which is the one that
 * derives everything from the variables it is given rather than from a palette of its own, so a
 * diagram is set in the same surfaces, borders and text colour as the prose around it.
 */
export function diagramTheme({ colour, fontSans, fontSize }: ThemeTokens): DiagramTheme {
  const background = colour('--rz-bg');
  const text = colour('--rz-text');
  const muted = colour('--rz-text-muted');
  const surface = colour('--rz-surface');
  const raised = colour('--rz-surface-raised');
  const sunken = colour('--rz-surface-sunken');
  const border = colour('--rz-border');
  const borderStrong = colour('--rz-border-strong');

  return {
    darkMode: isDark(background),
    background,
    fontFamily: fontSans,
    fontSize,

    // A node is the raised surface a card is, bordered and lettered like everything else.
    primaryColor: raised,
    primaryBorderColor: borderStrong,
    primaryTextColor: text,
    mainBkg: raised,
    nodeBorder: borderStrong,
    nodeTextColor: text,
    textColor: text,
    titleColor: text,

    secondaryColor: surface,
    secondaryBorderColor: border,
    secondaryTextColor: text,
    tertiaryColor: sunken,
    tertiaryBorderColor: border,
    tertiaryTextColor: muted,

    // Edges, and the labels that sit on top of them.
    lineColor: colour('--rz-text-faint'),
    edgeLabelBackground: background,

    // A subgraph, and the sticky note a sequence diagram puts beside an actor.
    clusterBkg: sunken,
    clusterBorder: border,
    noteBkgColor: surface,
    noteBorderColor: border,
    noteTextColor: text,

    // Anything mermaid colours by series — a pie, a journey, a git graph — takes the vault's own
    // cluster palette, so a chart in a note and a bubble in the graph agree about what green is.
    ...Object.fromEntries(
      Array.from({ length: CLUSTER_COUNT }, (_, slot) => [
        `pie${String(slot + 1)}`,
        colour(`--rz-cluster-${String(slot + 1)}`),
      ]),
    ),
    ...Object.fromEntries(
      Array.from({ length: CLUSTER_COUNT }, (_, slot) => [
        `cScale${String(slot)}`,
        colour(`--rz-cluster-${String(slot + 1)}`),
      ]),
    ),
  };
}

/** The diagram's source: what core left in the container, and what stays there afterwards. */
function sourceOf(container: Element): string {
  return container.querySelector('pre > code')?.textContent ?? '';
}

/** Puts a drawn diagram, or the reason there is none, into its container. */
function apply(container: HTMLElement, diagram: Diagram, labels: DiagramLabels): void {
  for (const old of container.querySelectorAll(`.${FIGURE_CLASS}, .${FAILURE_CLASS}`)) {
    old.remove();
  }
  if (diagram.state === 'ready') {
    const figure = document.createElement('div');
    figure.className = FIGURE_CLASS;
    // Mermaid is configured with `securityLevel: 'strict'`, under which it runs its own output
    // through DOMPurify before handing it over; see `mermaid-draw.ts`. The source it was built
    // from is a note out of somebody else's vault, so that guarantee is the whole reason the
    // setting is not negotiable.
    figure.innerHTML = diagram.svg;
    container.append(figure);
    // The source stays in the page, hidden by the stylesheet: it is what the diagram is drawn
    // from again when the theme changes, and what is left if the SVG is ever not there.
    container.dataset.state = 'ready';
    return;
  }
  const line = document.createElement('p');
  line.className = FAILURE_CLASS;
  line.textContent = diagram.message === '' ? labels.failedPlain : labels.failed(diagram.message);
  container.append(line);
  container.dataset.state = 'failed';
}

/**
 * Draws every diagram in `host`, and returns the call that stops it.
 *
 * Nothing at all happens when the note holds no diagram — that is the point of the check being
 * first, ahead of the import. What is already known is filled in there and then; the rest waits
 * for the library, and for each other, so that a note full of diagrams does not start twenty
 * layout runs at once.
 */
export function drawDiagrams(host: ParentNode, labels: DiagramLabels): () => void {
  const containers = [...host.querySelectorAll<HTMLElement>(MERMAID_SELECTOR)];
  const pending: { container: HTMLElement; source: string }[] = [];
  for (const container of containers) {
    const source = sourceOf(container);
    const already = rememberedDiagram(source);
    if (already === undefined) {
      pending.push({ container, source });
    } else {
      apply(container, already, labels);
    }
  }

  let live = true;
  const stop = (): void => {
    live = false;
  };
  if (pending.length === 0) {
    return stop;
  }

  void (async () => {
    let drawDiagram: (source: string) => Promise<string>;
    try {
      ({ drawDiagram } = await import('./mermaid-draw.js'));
    } catch {
      // A download that did not arrive leaves the source on screen, which is what a code block
      // would have shown anyway — the one failure worth saying nothing about.
      return;
    }
    for (const { container, source } of pending) {
      if (!live) {
        return;
      }
      let diagram: Diagram;
      try {
        diagram = { state: 'ready', svg: await drawDiagram(source) };
      } catch (error) {
        diagram = { state: 'failed', message: diagramMessage(error) };
      }
      rememberDiagram(source, diagram);
      if (!live) {
        return;
      }
      apply(container, diagram, labels);
    }
  })();
  return stop;
}

/**
 * Calls back whenever the colours a diagram is drawn in could have changed: the theme attribute
 * on <html>, or the operating system's preference under the "follow the system" setting. The
 * graph canvas watches the same two things for the same reason.
 */
export function watchTheme(onChange: () => void): () => void {
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  const media = window.matchMedia('(prefers-color-scheme: dark)');
  media.addEventListener('change', onChange);
  return () => {
    observer.disconnect();
    media.removeEventListener('change', onChange);
  };
}
