// Exporting exactly what is on screen: both formats are built from the same Scene.
import {
  drawScene,
  isActiveEdge,
  sceneLabels,
  sceneRings,
  EDGE_ACTIVE_PX,
  EDGE_PX,
  LABEL_FONT_PX,
  LABEL_HALO_PX,
  type Scene,
} from './renderer.js';

function round(value: number): string {
  return String(Math.round(value * 100) / 100);
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function edgePath(scene: Scene, active: boolean): string {
  let d = '';
  for (const edge of scene.links) {
    if (isActiveEdge(scene, edge) !== active) {
      continue;
    }
    d +=
      `M${round(edge.source.x ?? 0)} ${round(edge.source.y ?? 0)}` +
      `L${round(edge.target.x ?? 0)} ${round(edge.target.y ?? 0)}`;
  }
  return d;
}

/**
 * The view as a standalone SVG document: same nodes, same transform, same resolved colours, so
 * the file carries the current theme with it. Pure — no DOM, hence unit-testable in Node.
 */
export function sceneToSvg(scene: Scene): string {
  const { k, x, y } = scene.transform;
  const palette = scene.palette;
  const width = round(scene.width);
  const height = round(scene.height);

  const quiet = edgePath(scene, false);
  const active = edgePath(scene, true);

  const bySlot = new Map<number, string>();
  for (const node of scene.nodes) {
    const circle = `<circle cx="${round(node.x ?? 0)}" cy="${round(node.y ?? 0)}" r="${round(node.r)}"/>`;
    bySlot.set(node.colorIndex, (bySlot.get(node.colorIndex) ?? '') + circle);
  }
  const bubbles = [...bySlot]
    .map(([slot, circles]) => `<g fill="${palette.clusters[slot] ?? palette.label}">${circles}</g>`)
    .join('');

  const rings = sceneRings(scene)
    .map(
      (ring) =>
        `<circle cx="${round(ring.x)}" cy="${round(ring.y)}" r="${round(ring.r)}" fill="none" ` +
        `stroke="${ring.color}" stroke-width="${round(ring.width)}"/>`,
    )
    .join('');

  const labels = sceneLabels(scene)
    .map(
      (label) =>
        `<text x="${round(label.x)}" y="${round(label.y)}">${escapeXml(label.text)}</text>`,
    )
    .join('');

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" ` +
    `viewBox="0 0 ${width} ${height}">` +
    `<rect width="100%" height="100%" fill="${palette.bg}"/>` +
    `<g transform="translate(${round(x)},${round(y)}) scale(${round(k)})">` +
    `<path d="${quiet}" fill="none" stroke="${palette.edge}" stroke-width="${round(EDGE_PX / k)}"/>` +
    (active === ''
      ? ''
      : `<path d="${active}" fill="none" stroke="${palette.edgeActive}" ` +
        `stroke-width="${round(EDGE_ACTIVE_PX / k)}"/>`) +
    bubbles +
    rings +
    // paint-order puts the halo underneath the glyphs, the same look as strokeText + fillText.
    `<g font-family="${escapeXml(palette.fontSans)}" font-size="${round(LABEL_FONT_PX / k)}" ` +
    `text-anchor="middle" dominant-baseline="hanging" fill="${palette.label}" ` +
    `stroke="${palette.labelHalo}" stroke-width="${round(LABEL_HALO_PX / k)}" stroke-linejoin="round" ` +
    `style="paint-order: stroke fill">${labels}</g>` +
    `</g></svg>`
  );
}

/** The view as a PNG at `scale`× the on-screen size, painted by the very same drawScene. */
export function sceneToPng(scene: Scene, scale = 2): Promise<Blob> {
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(scene.width * scale));
  canvas.height = Math.max(1, Math.round(scene.height * scale));
  const ctx = canvas.getContext('2d', { alpha: false });
  if (!ctx) {
    return Promise.reject(new Error('The browser gave no 2D canvas context'));
  }
  drawScene(ctx, { ...scene, pixelRatio: scale });
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) {
        resolve(blob);
      } else {
        reject(new Error('The browser produced no PNG'));
      }
    }, 'image/png');
  });
}

/** Hands a blob to the browser's downloader; the caller picks the file name. */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}
