// The milieu field: two named directions, a light grid, and one bubble per placed note.
//
// Drawn as SVG rather than on a canvas, which is the opposite of the bubble field's choice and
// for the opposite reason. The bubble field lays out thousands of nodes sixty times a second, so
// it owns a canvas and re-exports it through a Scene the exporter walks a second time. A milieu
// field holds tens of notes that do not move unless somebody drags one: React can own every
// bubble as an element, the browser does the hit-testing and the focus rings for us, and the
// export is the picture itself rather than a second renderer that has to be kept in step with
// the first. `toSvg` serialises the very node on screen, so the two cannot drift apart.
//
// The drawing has its own coordinates (see milieu-model.ts) and is scaled into whatever room it
// gets. A pointer is mapped back through the element's own matrix, so a field at any size, in a
// split pane or on a zoomed page, still drops a note where the pointer was.
import type { AxesPoint, AxesSettings } from '@rhizom/core';
import {
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type DragEvent as ReactDragEvent,
  type JSX,
  type PointerEvent as ReactPointerEvent,
  type Ref,
  type RefObject,
} from 'react';
import { useTranslation } from 'react-i18next';

import { noteHref } from '../app/paths.js';
import { PNG_SCALE } from '../graph/export.js';
import { resolvePalette, watchPalette, type Palette } from '../graph/palette.js';
import {
  fieldPoint,
  fieldXy,
  gridFractions,
  BUBBLE_RADIUS,
  DRAG_THRESHOLD,
  FIELD_HEIGHT,
  FIELD_WIDTH,
  LABEL_GAP,
  PLOT,
  type PlacedNote,
  type UnplacedNote,
} from './milieu-model.js';
import './milieu.css';

/**
 * The flavour a note is dragged out of the tray under. Its own media type rather than plain text
 * so that a path dragged in from a browser tab or a file manager is not mistaken for one of ours;
 * the plain-text flavour is set alongside it, because that is what other applications will read.
 */
const NOTE_FLAVOUR = 'application/x-rhizom-note';

/** Font sizes in the drawing's coordinates, which is 1:1 with pixels at the natural width. */
const AXIS_WORD_PX = 17;
const AXIS_KEY_PX = 15;
const LABEL_PX = 15;

export interface MilieuFieldHandle {
  /** The field as a standalone SVG document — the node on screen, not a second drawing of it. */
  toSvg: () => string;
  /** The same document rasterised at `scale`× its natural size. */
  toPng: (scale?: number) => Promise<Blob>;
}

export interface MilieuFieldProps {
  axes: AxesSettings;
  placed: readonly PlacedNote[];
  unplaced: readonly UnplacedNote[];
  /** Accessible name of the drawing, already translated. */
  label: string;
  onOpenNote: (path: string) => void;
  /** A bubble was let go, or a note was dropped in from the tray. */
  onPlaceNote: (path: string, point: AxesPoint) => void;
  ref?: Ref<MilieuFieldHandle>;
}

/** A bubble under the pointer, in the drawing's coordinates. */
interface Drag {
  path: string;
  pointer: number;
  x: number;
  y: number;
  /** Where the pointer went down, in client pixels, so a click can be told from a drag. */
  fromClientX: number;
  fromClientY: number;
  moved: boolean;
}

export function MilieuField({
  axes,
  placed,
  unplaced,
  label,
  onOpenNote,
  onPlaceNote,
  ref,
}: MilieuFieldProps): JSX.Element {
  const { t } = useTranslation();
  const svgRef = useRef<SVGSVGElement>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const [over, setOver] = useState(false);
  const palette = usePalette();

  useFieldExport(ref, svgRef);

  const at = (note: PlacedNote): { x: number; y: number } =>
    drag?.path === note.path ? { x: drag.x, y: drag.y } : fieldXy(note.point);

  const beginDrag = (note: PlacedNote, event: ReactPointerEvent<SVGGElement>): void => {
    if (event.button !== 0) {
      return;
    }
    const here = fieldXy(note.point);
    event.currentTarget.setPointerCapture(event.pointerId);
    setDrag({
      path: note.path,
      pointer: event.pointerId,
      x: here.x,
      y: here.y,
      fromClientX: event.clientX,
      fromClientY: event.clientY,
      moved: false,
    });
  };

  const continueDrag = (event: ReactPointerEvent<SVGGElement>): void => {
    if (drag?.pointer !== event.pointerId) {
      return;
    }
    const inside = inDrawing(svgRef.current, event.clientX, event.clientY);
    if (inside === null) {
      return;
    }
    const travelled =
      Math.abs(event.clientX - drag.fromClientX) + Math.abs(event.clientY - drag.fromClientY);
    setDrag({ ...drag, ...inside, moved: drag.moved || travelled > DRAG_THRESHOLD });
  };

  const endDrag = (event: ReactPointerEvent<SVGGElement>): void => {
    if (drag?.pointer !== event.pointerId) {
      return;
    }
    setDrag(null);
    // A bubble that did not travel was clicked, and a click on a note opens it. The two gestures
    // share a button on purpose: a bubble is the note, and there is nowhere else to click it.
    if (drag.moved) {
      onPlaceNote(drag.path, fieldPoint(drag.x, drag.y));
    } else {
      onOpenNote(drag.path);
    }
  };

  const dropped = (event: ReactDragEvent<SVGSVGElement>): void => {
    event.preventDefault();
    setOver(false);
    const path = event.dataTransfer.getData(NOTE_FLAVOUR);
    const where = inDrawing(svgRef.current, event.clientX, event.clientY);
    if (path !== '' && where !== null) {
      onPlaceNote(path, fieldPoint(where.x, where.y));
    }
  };

  return (
    <div className="rz-milieu">
      <svg
        ref={svgRef}
        className={`rz-milieu-field${over ? ' rz-milieu-field-over' : ''}`}
        width={FIELD_WIDTH}
        height={FIELD_HEIGHT}
        viewBox={`0 0 ${String(FIELD_WIDTH)} ${String(FIELD_HEIGHT)}`}
        preserveAspectRatio="xMidYMid meet"
        // Presentation as attributes rather than as a class: what is serialised out of here has
        // to stand on its own, with no stylesheet to inherit from.
        fontFamily={palette.fontSans}
        // A group rather than an image: the bubbles inside it are buttons, and `role="img"`
        // would hide every one of them from a screen reader.
        role="group"
        aria-label={label}
        onDragOver={(event) => {
          if (event.dataTransfer.types.includes(NOTE_FLAVOUR)) {
            event.preventDefault();
            event.dataTransfer.dropEffect = 'move';
            setOver(true);
          }
        }}
        onDragLeave={() => {
          setOver(false);
        }}
        onDrop={dropped}
      >
        <rect width={FIELD_WIDTH} height={FIELD_HEIGHT} fill={palette.bg} />

        <g stroke={palette.edge} strokeWidth={1} fill="none">
          {gridFractions().map((fraction) => (
            <line
              key={`v${String(fraction)}`}
              x1={PLOT.x + fraction * PLOT.width}
              y1={PLOT.y}
              x2={PLOT.x + fraction * PLOT.width}
              y2={PLOT.y + PLOT.height}
            />
          ))}
          {gridFractions().map((fraction) => (
            <line
              key={`h${String(fraction)}`}
              x1={PLOT.x}
              y1={PLOT.y + fraction * PLOT.height}
              x2={PLOT.x + PLOT.width}
              y2={PLOT.y + fraction * PLOT.height}
            />
          ))}
        </g>
        <rect
          x={PLOT.x}
          y={PLOT.y}
          width={PLOT.width}
          height={PLOT.height}
          fill="none"
          stroke={palette.edgeActive}
          strokeWidth={1.5}
        />

        <AxisWords axes={axes} palette={palette} />

        {placed.map((note) => {
          const { x, y } = at(note);
          const dragging = drag?.path === note.path && drag.moved;
          return (
            <g
              key={note.path}
              className="rz-milieu-bubble"
              role="button"
              tabIndex={0}
              aria-label={note.title}
              onPointerDown={(event) => {
                beginDrag(note, event);
              }}
              onPointerMove={continueDrag}
              onPointerUp={endDrag}
              onPointerCancel={() => {
                setDrag(null);
              }}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault();
                  onOpenNote(note.path);
                }
              }}
            >
              <circle
                cx={x}
                cy={y}
                r={BUBBLE_RADIUS}
                fill={palette.clusters[note.slot] ?? palette.label}
                stroke={dragging ? palette.accent : 'none'}
                strokeWidth={dragging ? 3 : 0}
              />
              <text
                x={x}
                y={y + BUBBLE_RADIUS + LABEL_GAP}
                fontSize={LABEL_PX}
                textAnchor="middle"
                fill={palette.label}
                stroke={palette.labelHalo}
                strokeWidth={3}
                strokeLinejoin="round"
                // The halo belongs under the glyphs, the same look the canvas gets from
                // strokeText before fillText.
                style={{ paintOrder: 'stroke fill' }}
              >
                {note.title}
              </text>
            </g>
          );
        })}
      </svg>

      <Tray notes={unplaced} axes={axes} onOpenNote={onOpenNote} />

      <p className="rz-milieu-hint">{t('axes.hint')}</p>
    </div>
  );
}

interface AxisWordsProps {
  axes: AxesSettings;
  palette: Palette;
}

/**
 * The words at the four edges, and the key each axis is spelled with.
 *
 * An axis that named no end words is drawn without them: the note has begun a field and has not
 * found its words yet, and an empty label would be a promise the file does not make. The key is
 * always there, because a field with no key is not a field at all.
 */
function AxisWords({ axes, palette }: AxisWordsProps): JSX.Element {
  const bottom = PLOT.y + PLOT.height;
  const right = PLOT.x + PLOT.width;
  return (
    <g fill={palette.label}>
      <g fontSize={AXIS_WORD_PX}>
        {axes.x.from === '' ? null : (
          <text x={PLOT.x} y={bottom + 26} textAnchor="start">
            {axes.x.from}
          </text>
        )}
        {axes.x.to === '' ? null : (
          <text x={right} y={bottom + 26} textAnchor="end">
            {axes.x.to}
          </text>
        )}
        {axes.y.to === '' ? null : (
          <text x={PLOT.x - 14} y={PLOT.y + 6} textAnchor="end">
            {axes.y.to}
          </text>
        )}
        {axes.y.from === '' ? null : (
          <text x={PLOT.x - 14} y={bottom} textAnchor="end">
            {axes.y.from}
          </text>
        )}
      </g>
      <g fontSize={AXIS_KEY_PX} opacity={0.75}>
        <text x={PLOT.x + PLOT.width / 2} y={bottom + 56} textAnchor="middle">
          {axes.x.key}
        </text>
        <text
          x={28}
          y={PLOT.y + PLOT.height / 2}
          textAnchor="middle"
          transform={`rotate(-90 28 ${String(PLOT.y + PLOT.height / 2)})`}
        >
          {axes.y.key}
        </text>
      </g>
    </g>
  );
}

interface TrayProps {
  notes: readonly UnplacedNote[];
  axes: AxesSettings;
  onOpenNote: (path: string) => void;
}

/**
 * The notes the field cannot draw, with the value each is still missing.
 *
 * Dragging one into the rectangle places it. Opening it does the same thing the long way round —
 * the two keys are ordinary frontmatter, so the form above the editor can fill them in — which is
 * also the only way to do it without a pointer.
 */
function Tray({ notes, axes, onOpenNote }: TrayProps): JSX.Element {
  const { t } = useTranslation();
  return (
    <aside className="rz-milieu-tray" aria-label={t('axes.tray')}>
      <h3 className="rz-milieu-tray-title">{t('axes.trayTitle', { count: notes.length })}</h3>
      {notes.length === 0 ? (
        <p className="rz-milieu-tray-empty">{t('axes.trayEmpty')}</p>
      ) : (
        <ul className="rz-milieu-tray-list">
          {notes.map((note) => (
            <li key={note.path}>
              <a
                className="rz-milieu-tray-note"
                href={noteHref(note.path)}
                draggable
                title={note.path}
                onDragStart={(event) => {
                  event.dataTransfer.setData(NOTE_FLAVOUR, note.path);
                  event.dataTransfer.setData('text/plain', note.title);
                  event.dataTransfer.effectAllowed = 'move';
                }}
                onClick={(event) => {
                  if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
                    return;
                  }
                  event.preventDefault();
                  onOpenNote(note.path);
                }}
              >
                <span className="rz-milieu-tray-name">{note.title}</span>
                <span className="rz-milieu-tray-missing">
                  {note.missing === 'both'
                    ? t('axes.missingBoth', { x: axes.x.key, y: axes.y.key })
                    : t('axes.missingOne', {
                        key: note.missing === 'x' ? axes.x.key : axes.y.key,
                      })}
                </span>
              </a>
            </li>
          ))}
        </ul>
      )}
    </aside>
  );
}

/**
 * The graph tokens as colour strings the SVG can carry out of the page with it.
 *
 * Resolved while the first render runs rather than in an effect afterwards: the probe
 * `resolvePalette` uses cleans up after itself, and a field that paints itself black for one
 * frame and then redraws is worse than a lookup in the wrong place. It is resolved again whenever
 * the theme changes, which is the only thing that can change the answer.
 */
function usePalette(): Palette {
  const [palette, setPalette] = useState<Palette>(() => resolvePalette());
  useEffect(
    () =>
      watchPalette(() => {
        setPalette(resolvePalette());
      }),
    [],
  );
  return palette;
}

/** Where a client point sits in the drawing's own coordinates, or null when it cannot be mapped. */
function inDrawing(
  svg: SVGSVGElement | null,
  clientX: number,
  clientY: number,
): { x: number; y: number } | null {
  const matrix = svg?.getScreenCTM();
  if (!matrix) {
    return null;
  }
  const point = new DOMPoint(clientX, clientY).matrixTransform(matrix.inverse());
  return { x: point.x, y: point.y };
}

/** Hands the caller the two export formats, both built from the node that is on screen. */
function useFieldExport(
  ref: Ref<MilieuFieldHandle> | undefined,
  svgRef: RefObject<SVGSVGElement | null>,
): void {
  useImperativeHandle(ref, () => {
    const serialise = (): string => serialiseField(svgRef.current);
    return { toSvg: serialise, toPng: (scale = PNG_SCALE) => rasterise(serialise(), scale) };
  }, [svgRef]);
}

/** The node on screen as a standalone document, with what only a browser needs taken off it. */
function serialiseField(svg: SVGSVGElement | null): string {
  if (!svg) {
    throw new Error('The milieu field is not mounted');
  }
  const copy = svg.cloneNode(true) as SVGSVGElement;
  // The class carries the on-screen sizing and the cursor; the roles and tab stops are for a
  // reader, not for a file. Everything that paints is already an attribute.
  for (const element of [copy, ...copy.querySelectorAll('*')]) {
    element.removeAttribute('tabindex');
    element.removeAttribute('role');
    element.removeAttribute('class');
  }
  // XMLSerializer writes the SVG namespace out for us, because the node is in it.
  return new XMLSerializer().serializeToString(copy);
}

/**
 * A PNG of an SVG document: the browser draws it, so what lands in the file is what it puts on
 * screen. The blob URL keeps the document same-origin, which is what leaves the canvas readable.
 */
async function rasterise(svg: string, scale: number): Promise<Blob> {
  const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml;charset=utf-8' }));
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(FIELD_WIDTH * scale));
    canvas.height = Math.max(1, Math.round(FIELD_HEIGHT * scale));
    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) {
      throw new Error('The browser gave no 2D canvas context');
    }
    ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
    return await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((blob) => {
        if (blob) {
          resolve(blob);
        } else {
          reject(new Error('The browser produced no PNG'));
        }
      }, 'image/png');
    });
  } finally {
    URL.revokeObjectURL(url);
  }
}
