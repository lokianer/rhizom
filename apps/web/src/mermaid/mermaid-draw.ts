// The one module that names `mermaid`. Nothing imports it statically: `drawDiagrams` in
// `./mermaid.ts` reaches it with `import()` the first time a note on screen actually holds a
// diagram, so Vite gives the library a chunk of its own and a vault without diagrams in it never
// asks for a byte. Everything mermaid needs to fit into Rhizom is therefore paid for here too.
import mermaid from 'mermaid';

import { diagramTheme, type DiagramTheme } from './mermaid.js';

/**
 * Rhizom's tokens, resolved against the live page.
 *
 * `getComputedStyle(root).getPropertyValue('--rz-text')` is not usable: the computed value of a
 * custom property is the specified value with `var()` substituted and nothing else, so it stays
 * the literal `light-dark(#23201c, #e8e1d6)`, which mermaid would pass straight into the SVG.
 * Assigning the token to a real `color` on a probe inside the themed page makes the browser
 * evaluate `light-dark()` against the inherited `color-scheme` and serialise the result as
 * `rgb(r, g, b)`. The graph canvas resolves its palette the same way, for the same reason.
 */
function readTheme(): DiagramTheme {
  const probe = document.createElement('span');
  probe.style.cssText = 'position:absolute;visibility:hidden;pointer-events:none';
  document.body.append(probe);
  try {
    probe.style.fontSize = 'var(--rz-text-md)';
    return diagramTheme({
      colour: (token) => {
        probe.style.color = `var(${token})`;
        return getComputedStyle(probe).color;
      },
      // The token is written over several lines; an SVG attribute wants one.
      fontSans: getComputedStyle(document.body)
        .getPropertyValue('--rz-font-sans')
        .replace(/\s+/g, ' ')
        .trim(),
      fontSize: getComputedStyle(probe).fontSize,
    });
  } finally {
    probe.remove();
  }
}

/** The theme mermaid was last configured with, so switching Humus for Kalk is noticed. */
let configured: string | null = null;

function configure(): void {
  const theme = readTheme();
  const key = JSON.stringify(theme);
  if (key === configured) {
    return;
  }
  mermaid.initialize({
    // A vault can come from anywhere — an Obsidian folder, a colleague's zip, a repository
    // somebody cloned — so the text between the fences is untrusted input, and mermaid is a
    // library that turns text into markup. `securityLevel: 'strict'` is what makes that safe:
    // HTML written into a label is encoded rather than rendered, `click` directives that would
    // run a script or open a URL are refused, and mermaid runs its own SVG through DOMPurify
    // before handing it back — which is the guarantee the caller relies on when it puts that
    // SVG into the page. `startOnLoad: false` keeps mermaid from ever going looking through the
    // document for diagrams by itself: the only source it sees is one this app handed it.
    // Neither setting is negotiable.
    startOnLoad: false,
    securityLevel: 'strict',
    // `base` is the one built-in theme that derives everything from the variables it is given
    // rather than from a palette of its own; see `diagramTheme`.
    theme: 'base',
    themeVariables: theme,
  });
  configured = key;
}

/** Unique per call: mermaid names the element it draws in, and a repeated id collides. */
let drawn = 0;

/**
 * The SVG for one diagram. Rejects when mermaid will not have the source — which, while a
 * diagram is being typed, is nearly every keystroke; the caller shows the reason as one line
 * and leaves the source standing.
 */
export async function drawDiagram(source: string): Promise<string> {
  configure();
  drawn += 1;
  const id = `rz-mermaid-${String(drawn)}`;
  try {
    // Parsed before it is drawn: a syntax error is the common case here, and `parse` reports it
    // without putting anything into the document, so the page is untouched by a half-written
    // diagram. `render` then only ever sees a source that was read.
    await mermaid.parse(source);
    const { svg } = await mermaid.render(id, source);
    return svg;
  } finally {
    // Mermaid measures in a throwaway element and clears it up itself; this is the insurance
    // against a version that stops doing so, which would otherwise litter the body invisibly.
    document.getElementById(id)?.remove();
    document.getElementById(`d${id}`)?.remove();
  }
}
