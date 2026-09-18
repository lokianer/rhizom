// Dropping or pasting a file uploads it and writes an embed where it landed. Intercepting the
// events is not optional: CodeMirror's own drop handler reads dropped files with
// FileReader.readAsText and inserts their bytes as text.
import { StateEffect, StateField, type Range } from '@codemirror/state';
import { Decoration, EditorView, WidgetType, type DecorationSet } from '@codemirror/view';

import { isImagePath } from './assets.js';
import { editorContext } from './context.js';

interface PendingUpload {
  readonly id: number;
  /** Where the file was dropped, mapped through every edit made while it uploads. */
  readonly pos: number;
}

const startUpload = StateEffect.define<PendingUpload>();
const endUpload = StateEffect.define<number>();

class UploadMarker extends WidgetType {
  override eq(): boolean {
    return true;
  }

  override toDOM(): HTMLElement {
    const marker = document.createElement('span');
    marker.className = 'cm-rz-upload';
    return marker;
  }
}

const uploadMarker = new UploadMarker();

function markerDecorations(uploads: readonly PendingUpload[]): DecorationSet {
  const ranges: Range<Decoration>[] = uploads.map((upload) =>
    Decoration.widget({ widget: uploadMarker, side: 1 }).range(upload.pos),
  );
  return Decoration.set(ranges, true);
}

const pendingUploads = StateField.define<readonly PendingUpload[]>({
  create: () => [],
  update(value, transaction) {
    let uploads = transaction.docChanged
      ? value.map((upload) => ({ id: upload.id, pos: transaction.changes.mapPos(upload.pos, 1) }))
      : value;
    for (const effect of transaction.effects) {
      if (effect.is(startUpload)) {
        uploads = [...uploads, effect.value];
      } else if (effect.is(endUpload)) {
        uploads = uploads.filter((upload) => upload.id !== effect.value);
      }
    }
    return uploads;
  },
  provide: (field) => EditorView.decorations.from(field, markerDecorations),
});

let nextUploadId = 0;

function embedFor(vaultPath: string): string {
  return isImagePath(vaultPath) ? `![[${vaultPath}]]` : `[[${vaultPath}]]`;
}

function uploadFiles(view: EditorView, files: readonly File[], pos: number): void {
  const handlers = view.state.facet(editorContext)?.handlers.current;
  if (handlers === undefined) {
    return;
  }
  for (const file of files) {
    const id = nextUploadId;
    nextUploadId += 1;
    view.dispatch({ effects: startUpload.of({ id, pos }) });
    void handlers.onUpload(file).then(
      (vaultPath) => {
        const pending = view.state.field(pendingUploads).find((upload) => upload.id === id);
        if (pending === undefined || view.state.readOnly) {
          view.dispatch({ effects: endUpload.of(id) });
          return;
        }
        view.dispatch({
          changes: { from: pending.pos, insert: embedFor(vaultPath) },
          effects: endUpload.of(id),
        });
      },
      () => {
        view.dispatch({ effects: endUpload.of(id) });
      },
    );
  }
}

function filesOf(transfer: DataTransfer | null | undefined): File[] {
  return transfer === null || transfer === undefined ? [] : [...transfer.files];
}

const fileHandlers = EditorView.domEventHandlers({
  dragover(event) {
    // Allow the drop without claiming the event, so dropCursor() keeps showing where it lands.
    event.preventDefault();
  },
  drop(event, view) {
    const files = filesOf(event.dataTransfer);
    if (files.length === 0) {
      return false; // a text drop: CodeMirror handles it
    }
    event.preventDefault();
    if (!view.state.readOnly) {
      const pos = view.posAtCoords({ x: event.clientX, y: event.clientY });
      uploadFiles(view, files, pos ?? view.state.selection.main.head);
    }
    return true;
  },
  paste(event, view) {
    const files = filesOf(event.clipboardData);
    if (files.length === 0) {
      return false;
    }
    event.preventDefault();
    if (!view.state.readOnly) {
      uploadFiles(view, files, view.state.selection.main.head);
    }
    return true;
  },
});

export const fileUpload = [pendingUploads, fileHandlers];
