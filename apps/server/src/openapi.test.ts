import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { expect, it } from 'vitest';

import { generateOpenApi } from './openapi.js';

function committedDocument(): Record<string, unknown> {
  return JSON.parse(
    readFileSync(fileURLToPath(new URL('../openapi.json', import.meta.url)), 'utf8'),
  ) as Record<string, unknown>;
}

/** Every `$ref` in the document, wherever it sits. */
function references(node: unknown, found: string[] = []): string[] {
  if (Array.isArray(node)) {
    for (const item of node) {
      references(item, found);
    }
  } else if (node !== null && typeof node === 'object') {
    for (const [key, value] of Object.entries(node)) {
      if (key === '$ref' && typeof value === 'string') {
        found.push(value);
      } else {
        references(value, found);
      }
    }
  }
  return found;
}

it('keeps the committed openapi.json in step with the routes (run `pnpm openapi` to update)', async () => {
  expect(await generateOpenApi()).toEqual(committedDocument());
});

it('publishes a document whose references lead somewhere', () => {
  // A dangling `$ref` is a document no validator accepts and no generator can read — and it is
  // invisible until somebody tries, because nothing in the server itself follows it.
  const document = committedDocument();
  const components = (document.components as { schemas?: Record<string, unknown> } | undefined)
    ?.schemas;
  const defined = new Set(Object.keys(components ?? {}));
  const refs = [...new Set(references(document))];

  expect(refs.length).toBeGreaterThan(0);
  for (const ref of refs) {
    expect(ref, 'references point into components.schemas').toMatch(/^#\/components\/schemas\//);
    expect(defined, `${ref} is defined`).toContain(ref.slice('#/components/schemas/'.length));
  }
});
