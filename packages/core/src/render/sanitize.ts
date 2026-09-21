// What survives sanitising. A vault is somebody else's file, so the HTML a note turns into is
// filtered against an allow-list before it reaches the page: GitHub's schema, widened by
// exactly the classes and attributes this renderer emits and by nothing else.
import { defaultSchema, type Options as SanitizeSchema } from 'rehype-sanitize';

import { CALLOUT_CLASSES, MERMAID_CLASS } from './classes.js';

type SanitizeAttributes = NonNullable<SanitizeSchema['attributes']>;
type PropertyDefinition = SanitizeAttributes[string][number];

/**
 * Builds a tag's attribute rules from the default schema plus the class names and attributes
 * this renderer emits. hast-util-sanitize takes the first rule that matches a property name, so
 * an extra `className` rule would never be reached: the default one has to be merged instead.
 */
function allowFor(tag: string, classes: string[], ...attributes: string[]): PropertyDefinition[] {
  const inherited = defaultSchema.attributes?.[tag] ?? [];
  const isClassRule = (rule: PropertyDefinition): boolean =>
    Array.isArray(rule) && rule[0] === 'className';
  const inheritedClasses = inherited.flatMap((rule) => (isClassRule(rule) ? rule.slice(1) : []));
  return [
    ...inherited.filter((rule) => !isClassRule(rule)),
    ['className', ...inheritedClasses, ...classes],
    ...attributes,
  ];
}

/**
 * GitHub's schema plus exactly what this renderer emits. Clobbering is switched off on purpose:
 * remark-rehype already namespaces its footnote ids and writes matching hrefs, so a second
 * `user-content-` prefix from the sanitiser would break every footnote link, and heading ids
 * have to stay equal to the slugs returned in `headings` and used in `#fragment` hrefs. Nothing
 * untrusted reaches the sanitiser as an id: raw HTML in the source never becomes markup.
 */
export const sanitizeSchema: SanitizeSchema = {
  ...defaultSchema,
  attributes: {
    ...defaultSchema.attributes,
    a: allowFor('a', ['rz-wikilink', 'rz-wikilink-missing', 'rz-embed-file'], 'dataTarget'),
    div: allowFor(
      'div',
      ['rz-embed', 'rz-query', MERMAID_CLASS, ...CALLOUT_CLASSES],
      'dataPath',
      'dataEmbed',
      'dataState',
    ),
    // A foldable callout and its title. `open` is allowed on every element by the default schema.
    details: allowFor('details', CALLOUT_CLASSES),
    summary: allowFor('summary', ['rz-callout-title']),
    // Task lists: the class the stylesheet drops the bullets by, and the one that says "ticked".
    ul: allowFor('ul', ['rz-tasks']),
    ol: allowFor('ol', ['rz-tasks']),
    li: allowFor('li', ['rz-task', 'rz-task-done'], 'dataTaskLine'),
    // `span` is an allowed tag in the default schema but has no attribute rules of its own, so
    // without this the element would survive and its class would be filtered away in silence.
    span: allowFor('span', ['rz-term'], 'dataTerm'),
  },
  clobberPrefix: '',
};
