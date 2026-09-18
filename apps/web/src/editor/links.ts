// Opening a wikilink. The live-preview layer puts the raw target on the rendered link, so the
// click only has to find the element it landed in.
import { EditorView } from '@codemirror/view';

import { editorContext } from './context.js';
import { isActiveLine } from './livePreview.js';

export const wikilinkClicks = EditorView.domEventHandlers({
  mousedown(event, view) {
    if (event.button !== 0 || !(event.target instanceof HTMLElement)) {
      return false;
    }
    const link = event.target.closest('[data-rz-wikilink]');
    const target = link?.getAttribute('data-rz-wikilink');
    if (target === null || target === undefined) {
      return false;
    }
    // While the line shows its source the click belongs to editing; a rendered link, a
    // read-only view and Ctrl/Cmd+click navigate.
    const pos = view.posAtCoords({ x: event.clientX, y: event.clientY });
    const forced = event.metaKey || event.ctrlKey;
    if (!forced && pos !== null && isActiveLine(view.state, pos)) {
      return false;
    }
    event.preventDefault();
    view.state.facet(editorContext)?.handlers.current.onOpenLink(target);
    return true;
  },
});
