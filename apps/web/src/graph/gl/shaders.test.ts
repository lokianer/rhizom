import { describe, expect, it } from 'vitest';

import { EDGE_BEND } from '../geometry.js';
import { FOCUS_SINK, GROWTH, SEPIA } from '../look.js';
import { NodeFlag } from '../types.js';
import {
  BUBBLE_FRAGMENT,
  BUBBLE_UNIFORMS,
  BUBBLE_VERTEX,
  CURVE_SEGMENTS,
  DRAW_ON,
  EDGE_FRAGMENT,
  EDGE_LENGTH,
  EDGE_UNIFORMS,
  EDGE_VERTEX,
  GLSL_EDGE_BEND,
  GLSL_NODE_FLAGS,
  GROUND_FRAGMENT,
  GROUND_UNIFORMS,
  NODE_TEXTURE_MAX_WIDTH,
  RESOLVE_FRAGMENT,
  RESOLVE_UNIFORMS,
  SCREEN_VERTEX,
  SHORE_RANGE,
  SOIL_SINK,
  SPARK_FRAGMENT,
  SPARK_UNIFORMS,
  SPARK_VERTEX,
  SPLAT,
  SPLAT_FRAGMENT,
  SPLAT_UNIFORMS,
  SPLAT_VERTEX,
  TERRITORY_TEXELS,
  TEXTURE_UNITS,
  TOOTH,
  arrivalOf,
  curveSegments,
  edgeLengthWeight,
  edgeVertexCount,
  nodeTextureSize,
  territoryViewport,
} from './shaders.js';

const programs = [
  { name: 'ground', vertex: SCREEN_VERTEX, fragment: GROUND_FRAGMENT, uniforms: GROUND_UNIFORMS },
  { name: 'splat', vertex: SPLAT_VERTEX, fragment: SPLAT_FRAGMENT, uniforms: SPLAT_UNIFORMS },
  {
    name: 'resolve',
    vertex: SCREEN_VERTEX,
    fragment: RESOLVE_FRAGMENT,
    uniforms: RESOLVE_UNIFORMS,
  },
  { name: 'edge', vertex: EDGE_VERTEX, fragment: EDGE_FRAGMENT, uniforms: EDGE_UNIFORMS },
  { name: 'spark', vertex: SPARK_VERTEX, fragment: SPARK_FRAGMENT, uniforms: SPARK_UNIFORMS },
  { name: 'bubble', vertex: BUBBLE_VERTEX, fragment: BUBBLE_FRAGMENT, uniforms: BUBBLE_UNIFORMS },
] as const;

/** name → type of every uniform a GLSL source declares. */
function declaredUniforms(source: string): Map<string, string> {
  const declared = new Map<string, string>();
  const pattern = /^\s*uniform\s+(?:(?:highp|mediump|lowp)\s+)?(\w+)\s+(\w+)/gm;
  for (const match of source.matchAll(pattern)) {
    const [, type, name] = match;
    if (type !== undefined && name !== undefined) {
      declared.set(name, type);
    }
  }
  return declared;
}

/** How shaders.ts writes a number into GLSL: always with a decimal point. */
function float(value: number): string {
  const rounded = Number(value.toFixed(6));
  return Number.isInteger(rounded) ? rounded.toFixed(1) : String(rounded);
}

function numberIn(glsl: string, pattern: RegExp): number {
  const match = pattern.exec(glsl);
  if (match?.[1] === undefined) {
    throw new Error(`No match for ${String(pattern)}`);
  }
  return Number(match[1]);
}

describe('the shader sources', () => {
  it('bend links exactly as geometry.ts does', () => {
    expect(numberIn(GLSL_EDGE_BEND, /EDGE_BEND\s*=\s*([\d.]+)/)).toBe(EDGE_BEND);
    for (const source of [EDGE_VERTEX, SPARK_VERTEX]) {
      expect(source).toContain(GLSL_EDGE_BEND);
      // edgeControl: flip for a > b, left normal (-dy, dx), bend scaled by the length.
      expect(source).toContain('float flip = a > b ? -1.0 : 1.0;');
      expect(source).toContain('vec2(-d.y, d.x) * (EDGE_BEND * flip)');
    }
  });

  it('read the node flags with the bits types.ts defines', () => {
    const bit = (name: string): number =>
      numberIn(GLSL_NODE_FLAGS, new RegExp(`FLAG_${name}\\s*=\\s*(\\d+)u`));
    expect(bit('FOCUS')).toBe(NodeFlag.focus);
    expect(bit('HOVERED')).toBe(NodeFlag.hovered);
    expect(bit('SELECTED')).toBe(NodeFlag.selected);
    expect(bit('SELECTED_NEIGHBOUR')).toBe(NodeFlag.selectedNeighbour);
  });

  it.each(programs)('$name: every stage starts with the version line', ({ vertex, fragment }) => {
    // A single character before #version, even a newline, and the stage does not compile.
    expect(vertex.startsWith('#version 300 es\n')).toBe(true);
    expect(fragment.startsWith('#version 300 es\n')).toBe(true);
  });

  it.each(programs)('$name: interpolation left nothing behind', ({ vertex, fragment }) => {
    for (const source of [vertex, fragment]) {
      expect(source).not.toMatch(/undefined|NaN|\$\{/);
      const opened = source.split('{').length;
      expect(source.split('}').length).toBe(opened);
      expect(source.split('(').length).toBe(source.split(')').length);
    }
  });

  it.each(programs)(
    '$name: caches exactly the uniforms it declares',
    ({ vertex, fragment, uniforms }) => {
      const declared = new Set([
        ...declaredUniforms(vertex).keys(),
        ...declaredUniforms(fragment).keys(),
      ]);
      expect([...declared].sort()).toEqual([...new Set<string>(uniforms)].sort());
    },
  );

  it.each(programs)('$name: a uniform in both stages has one type', ({ vertex, fragment }) => {
    const inVertex = declaredUniforms(vertex);
    for (const [name, type] of declaredUniforms(fragment)) {
      if (inVertex.has(name)) {
        expect(inVertex.get(name), name).toBe(type);
      }
    }
  });

  it.each(programs)('$name: every sampler has a fixed texture unit', ({ vertex, fragment }) => {
    // An unassigned sampler reads unit 0, the positions, and fails silently.
    const units: Readonly<Record<string, number>> = TEXTURE_UNITS;
    for (const source of [vertex, fragment]) {
      for (const [name, type] of declaredUniforms(source)) {
        if (type.endsWith('sampler2D')) {
          expect(units[name], name).toBeTypeOf('number');
        }
      }
    }
  });

  it('gives every texture a unit of its own', () => {
    const units = Object.values(TEXTURE_UNITS);
    expect(new Set(units).size).toBe(units.length);
  });

  it('time the neighbour lights and the link tips alike, as arrivalOf does', () => {
    const d = DRAW_ON;
    const formula = `mix(${float(d.earliest)}, 1.0, smoothstep(${float(d.shortLength)}, ${float(d.longLength)}, len))`;
    for (const source of [EDGE_VERTEX, SPARK_VERTEX, BUBBLE_VERTEX]) {
      expect(source).toContain(`float arrivalOf(float len) {\n  return ${formula};`);
    }
  });

  it('weigh quiet links by length as edgeLengthWeight does', () => {
    const e = EDGE_LENGTH;
    expect(EDGE_VERTEX).toContain(
      `mix(${float(e.shortWeight)}, 1.0, smoothstep(${float(e.shortFrom)}, ${float(e.shortTo)}, lenGraph))`,
    );
    expect(EDGE_VERTEX).toContain(
      `mix(1.0, ${float(e.longWeight)}, smoothstep(${float(e.longFrom)}, ${float(e.longTo)}, lenGraph))`,
    );
  });

  it('grow the bubbles and their links as look.ts growthAt does', () => {
    for (const source of [EDGE_VERTEX, SPARK_VERTEX, BUBBLE_VERTEX]) {
      expect(source).toContain(`float delay = ${float(GROWTH.stagger)} * clamp(`);
      expect(source).toContain(`/ ${float(1 - GROWTH.stagger)}, 0.0, 1.0);`);
      expect(source).toContain(
        `return 1.0 + ${float(GROWTH.c3)} * u * u * u + ${float(GROWTH.c1)} * u * u;`,
      );
    }
  });

  it('shade the contact shadow on paper in the sepia of look.ts', () => {
    expect(BUBBLE_FRAGMENT).toContain(
      `vec3(${SEPIA.map((channel) => float(channel)).join(', ')}) * a`,
    );
  });

  it('write every interpolated number as a float literal', () => {
    // An int where GLSL expects a float does not compile: SPLAT.base = 16 has to arrive as 16.0.
    expect([SPLAT.base, SPLAT.reach]).toEqual([16, 3]);
    expect(SPLAT_VERTEX).toContain('float sigma = attributes.x * 1.1 + 16.0;');
    expect(SPLAT_VERTEX).toContain('vLocal = corner * 3.0;');
  });

  it('start a lit link at the rim of its origin, never at its centre', () => {
    // A small spore on soil is translucent, and the origin may have sunk into the ground.
    expect(EDGE_VERTEX).toContain('span = vec2(rims.x, mix(rims.x, rims.y, drawnOf(lenGraph)));');
  });

  it('give every milieu a wash and a shore of its own, from its own density', () => {
    // One density per palette slot, in two textures of four channels.
    expect(SPLAT_FRAGMENT).toContain('layout(location = 1) out vec4 highSlots;');
    expect(RESOLVE_FRAGMENT).toContain(
      `smoothstep(vec4(${float(SPLAT.washFrom)}), vec4(${float(SPLAT.washTo)}), density)`,
    );
    expect(RESOLVE_FRAGMENT).toContain(`(density - ${float(SPLAT.shore)})`);
    // Distances are stored per slot and decoded with the same range.
    expect(RESOLVE_FRAGMENT).toContain(`lowDistance / ${float(SHORE_RANGE)} + 0.5`);
    expect(GROUND_FRAGMENT).toContain('abs(encoded - 0.5) * uShoreScale');
  });

  it('read the territories of slots 4–7 only when a territory uses them', () => {
    expect(RESOLVE_FRAGMENT).toContain(
      '  if (uHighSlots) {\n    high = splatAt(uSplatHigh, texel);',
    );
    expect(GROUND_FRAGMENT).toContain(
      '  if (uHighSlots) {\n    highLines = linesOf(texture(high, uv));',
    );
    expect(GROUND_FRAGMENT.split('texture(high, uv)')).toHaveLength(2);
  });

  it('read the tooth with one lattice point per texel', () => {
    expect(GROUND_FRAGMENT).toContain(`css / ${float(TOOTH.cell * TOOTH.texels)}`);
  });

  it('sink the field deeper than the fallback does, and paper less than soil', () => {
    // look.ts FOCUS_SINK is what the Canvas 2D fallback and the SVG draw with.
    expect(SOIL_SINK.humus).toBeGreaterThan(FOCUS_SINK.humus);
    expect(SOIL_SINK.kalk).toBeGreaterThan(FOCUS_SINK.kalk);
    expect(SOIL_SINK.kalk).toBeLessThan(SOIL_SINK.humus);
  });
});

describe('nodeTextureSize', () => {
  it('holds every node, in rows no wider than the limit', () => {
    for (const count of [0, 1, 41, 2000, 2048, 2049, 5000, 10_000]) {
      const { width, height } = nodeTextureSize(count);
      expect(width).toBeLessThanOrEqual(NODE_TEXTURE_MAX_WIDTH);
      expect(width * height).toBeGreaterThanOrEqual(count);
      expect(width * (height - 1)).toBeLessThan(Math.max(count, 1));
    }
  });

  it('is never empty, so a texture of no notes is still complete', () => {
    expect(nodeTextureSize(0)).toEqual({ width: 1, height: 1 });
  });

  it('keeps a small vault in one row', () => {
    expect(nodeTextureSize(2000)).toEqual({ width: 2000, height: 1 });
    expect(nodeTextureSize(2049)).toEqual({ width: 2048, height: 2 });
  });
});

describe('edgeVertexCount', () => {
  it('counts two vertices per segment boundary', () => {
    expect(edgeVertexCount(1)).toBe(4);
    expect(edgeVertexCount(8)).toBe(18);
  });
});

describe('curveSegments', () => {
  it('draws a vault seen whole with the fewest segments', () => {
    for (const layer of ['lit', 'quiet'] as const) {
      expect(curveSegments(100, layer)).toBe(CURVE_SEGMENTS.min);
      expect(curveSegments(0, layer)).toBe(CURVE_SEGMENTS.min);
      expect(curveSegments(Number.NaN, layer)).toBe(CURVE_SEGMENTS.min);
    }
  });

  it('adds segments with the square root of the on-screen length, up to the limit', () => {
    expect(curveSegments(1600, 'lit')).toBe(2 * curveSegments(400, 'lit'));
    expect(curveSegments(1e6, 'lit')).toBe(CURVE_SEGMENTS.max);
    expect(curveSegments(1e6, 'quiet')).toBe(CURVE_SEGMENTS.max);
  });

  it('keeps a long link within its tolerance of the true curve', () => {
    for (const layer of ['lit', 'quiet'] as const) {
      for (const scale of [300, 800, 1500, 3000]) {
        const n = curveSegments(scale, layer);
        const long = CURVE_SEGMENTS.longShare * scale;
        if (n < CURVE_SEGMENTS.max) {
          // A quadratic curve bent by EDGE_BEND strays EDGE_BEND · L / (2n²) from its polygon.
          expect((EDGE_BEND * long) / (2 * n * n)).toBeLessThanOrEqual(
            CURVE_SEGMENTS.tolerance[layer] * 1.25,
          );
        }
      }
    }
  });

  it('gives the few bright lit links more segments than the faint quiet web', () => {
    for (const scale of [500, 1000, 2000]) {
      expect(curveSegments(scale, 'lit')).toBeGreaterThan(curveSegments(scale, 'quiet'));
    }
  });
});

describe('edgeLengthWeight', () => {
  it('strengthens pressed links, leaves typical ones, fades stretched ones', () => {
    expect(edgeLengthWeight(10)).toBeCloseTo(1.6);
    expect(edgeLengthWeight(50)).toBe(1);
    expect(edgeLengthWeight(80)).toBe(1);
    expect(edgeLengthWeight(400)).toBeCloseTo(0.5);
  });

  it('never gets stronger with length', () => {
    let previous = Infinity;
    for (let length = 0; length <= 500; length += 5) {
      const weight = edgeLengthWeight(length);
      expect(weight).toBeLessThanOrEqual(previous);
      previous = weight;
    }
  });
});

describe('arrivalOf', () => {
  it('lets short links arrive early and the longest last', () => {
    expect(arrivalOf(0)).toBe(DRAW_ON.earliest);
    expect(arrivalOf(DRAW_ON.longLength * 2)).toBe(1);
    expect(arrivalOf(100)).toBeLessThan(arrivalOf(300));
  });
});

describe('territoryViewport', () => {
  it('keeps the field aspect with the long side at full resolution', () => {
    const out = { width: 0, height: 0 };
    expect(territoryViewport(400, 400, out)).toEqual({ width: 256, height: 256 });
    expect(territoryViewport(800, 400, out)).toEqual({ width: 256, height: 128 });
    expect(territoryViewport(300, 600, out)).toEqual({ width: 128, height: 256 });
  });

  it('writes into the object it is given', () => {
    const out = { width: 0, height: 0 };
    expect(territoryViewport(800, 400, out)).toBe(out);
  });

  it('never collapses a thin field to a sliver, nor trusts a degenerate one', () => {
    const out = { width: 0, height: 0 };
    expect(territoryViewport(10_000, 1, out).height).toBe(TERRITORY_TEXELS / 16);
    expect(territoryViewport(0, 0, out)).toEqual({
      width: TERRITORY_TEXELS,
      height: TERRITORY_TEXELS,
    });
    expect(territoryViewport(Number.NaN, 5, out).width).toBe(TERRITORY_TEXELS);
  });
});
