// Which field renderer to use where the automatic choice is wrong for a machine, or where a test
// has to exercise one: `localStorage['rhizom.renderer']` set to 'webgl2' or 'canvas2d'.

export type RendererChoice = 'auto' | 'webgl2' | 'canvas2d';

const STORAGE_KEY = 'rhizom.renderer';

export function readRendererChoice(): RendererChoice {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    return stored === 'webgl2' || stored === 'canvas2d' ? stored : 'auto';
  } catch {
    // Storage can be unavailable (privacy mode, disabled storage): choose automatically.
    return 'auto';
  }
}
