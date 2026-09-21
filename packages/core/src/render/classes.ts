// The class names this renderer writes onto its output, and the fence language it recognises.
// They sit apart from the renderer because two readers need the same list: the transform that
// puts a class on a node, and the sanitise schema that has to allow exactly these and no more.
// A class added in one place and forgotten in the other is a rule the sanitiser strips in
// silence, which is the failure this file exists to prevent.
import { CALLOUT_KINDS } from '../syntax/callout.js';

/**
 * The info string of a fence that holds a diagram. Folded before comparing, because an info
 * string is the author's spelling of a language name and `Mermaid` names the same one.
 */
export const MERMAID_LANGUAGE = 'mermaid';

/** The class the app looks the diagram containers up by. Exported so it cannot drift apart. */
export const MERMAID_CLASS = 'rz-mermaid';

/**
 * Every class a callout can carry. Derived from `CALLOUT_KINDS` rather than written out again, so
 * that a kind added there cannot become the one whose colour the sanitiser quietly strips.
 */
export const CALLOUT_CLASSES: string[] = [
  'rz-callout',
  'rz-callout-title',
  'rz-callout-body',
  ...CALLOUT_KINDS.map((kind) => `rz-callout-${kind}`),
];
