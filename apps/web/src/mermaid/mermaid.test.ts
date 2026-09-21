import { beforeEach, describe, expect, it } from 'vitest';

import {
  diagramMessage,
  diagramTheme,
  forgetDiagrams,
  isDark,
  rememberDiagram,
  rememberedDiagram,
  type ThemeTokens,
} from './mermaid.js';

// The web unit tests run without a DOM, so what is drawn is left to the Playwright spec and
// what is decided is asserted here: the colours a theme is made of, the one line a failure is
// cut down to, and the memory that keeps a keystroke from redrawing the page.

const HUMUS: Record<string, string> = {
  '--rz-bg': 'rgb(20, 17, 15)',
  '--rz-text': 'rgb(232, 225, 214)',
  '--rz-surface-raised': 'rgb(38, 33, 29)',
};

function tokens(colours: Record<string, string> = HUMUS): ThemeTokens {
  return {
    colour: (token) => colours[token] ?? 'rgb(1, 2, 3)',
    fontSans: 'ui-sans-serif, system-ui, sans-serif',
    fontSize: '16px',
  };
}

describe('isDark', () => {
  it('reads Humus as dark and Kalk as light', () => {
    expect(isDark('rgb(20, 17, 15)')).toBe(true);
    expect(isDark('rgb(244, 241, 234)')).toBe(false);
  });

  it('weights the channels rather than averaging them', () => {
    // Full green is bright enough to read as light; full blue is not, at the same average.
    expect(isDark('rgb(0, 255, 0)')).toBe(false);
    expect(isDark('rgb(0, 0, 255)')).toBe(true);
  });

  it('ignores the alpha channel and survives a colour it cannot read', () => {
    expect(isDark('rgba(20, 17, 15, 0.5)')).toBe(true);
    expect(isDark('transparent')).toBe(true);
  });
});

describe('diagramTheme', () => {
  it('spends the vault tokens on the colours mermaid derives the rest from', () => {
    const theme = diagramTheme(tokens());
    expect(theme.background).toBe('rgb(20, 17, 15)');
    expect(theme.primaryColor).toBe('rgb(38, 33, 29)');
    expect(theme.primaryTextColor).toBe('rgb(232, 225, 214)');
    expect(theme.fontFamily).toBe('ui-sans-serif, system-ui, sans-serif');
    expect(theme.fontSize).toBe('16px');
  });

  it('tells mermaid which way to derive its shades, from the background it resolved', () => {
    expect(diagramTheme(tokens()).darkMode).toBe(true);
    expect(diagramTheme(tokens({ '--rz-bg': 'rgb(244, 241, 234)' })).darkMode).toBe(false);
  });

  it('gives every series colour the cluster the graph would draw it in', () => {
    const clusters = Object.fromEntries(
      Array.from({ length: 8 }, (_, slot) => [
        `--rz-cluster-${String(slot + 1)}`,
        `rgb(${String(slot)}, 0, 0)`,
      ]),
    );
    const theme = diagramTheme(tokens(clusters));
    expect(theme.pie1).toBe('rgb(0, 0, 0)');
    expect(theme.pie8).toBe('rgb(7, 0, 0)');
    expect(theme.cScale0).toBe('rgb(0, 0, 0)');
    expect(theme.cScale7).toBe('rgb(7, 0, 0)');
  });

  it('never leaves a light-dark() literal in, which is what an unresolved token looks like', () => {
    const theme = diagramTheme(tokens());
    for (const value of Object.values(theme)) {
      expect(String(value)).not.toContain('light-dark');
    }
  });
});

describe('diagramMessage', () => {
  it('keeps the first line of what mermaid threw and drops the grammar under it', () => {
    const error = new Error(
      'Parse error on line 2:\ngraph TD\n  A --\n------^\nExpecting NODE_STRING, got EOF',
    );
    expect(diagramMessage(error)).toBe('Parse error on line 2:');
  });

  it('reads a string and anything else that was thrown', () => {
    expect(diagramMessage('No diagram type detected')).toBe('No diagram type detected');
    expect(diagramMessage(undefined)).toBe('');
    expect(diagramMessage(new Error(''))).toBe('');
  });

  it('cuts a line nobody would read to the end of', () => {
    const message = diagramMessage(new Error('x'.repeat(400)));
    expect(message).toHaveLength(120);
    expect(message.endsWith('…')).toBe(true);
  });
});

describe('the diagram memory', () => {
  beforeEach(() => {
    forgetDiagrams();
  });

  it('hands the same source back without asking mermaid again', () => {
    rememberDiagram('graph TD', { state: 'ready', svg: '<svg></svg>' });
    expect(rememberedDiagram('graph TD')).toEqual({ state: 'ready', svg: '<svg></svg>' });
    expect(rememberedDiagram('graph LR')).toBeUndefined();
  });

  it('remembers a failure too: a half-typed diagram must not be retried per render', () => {
    rememberDiagram('graph', { state: 'failed', message: 'Parse error' });
    expect(rememberedDiagram('graph')).toEqual({ state: 'failed', message: 'Parse error' });
  });

  it('stays bounded while a diagram is being typed', () => {
    for (let keystroke = 0; keystroke < 200; keystroke += 1) {
      rememberDiagram(`graph TD\n  A --> ${String(keystroke)}`, {
        state: 'failed',
        message: 'Parse error',
      });
    }
    // The last one written is still there; the hundred before it are not all kept.
    expect(rememberedDiagram('graph TD\n  A --> 199')).toBeDefined();
    expect(rememberedDiagram('graph TD\n  A --> 0')).toBeUndefined();
  });

  it('is dropped whole when the theme changes', () => {
    rememberDiagram('graph TD', { state: 'ready', svg: '<svg></svg>' });
    forgetDiagrams();
    expect(rememberedDiagram('graph TD')).toBeUndefined();
  });
});
