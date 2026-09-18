import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { expect, it } from 'vitest';

import { generateOpenApi } from './openapi.js';

it('keeps the committed openapi.json in step with the routes (run `pnpm openapi` to update)', async () => {
  const committed = JSON.parse(
    readFileSync(fileURLToPath(new URL('../openapi.json', import.meta.url)), 'utf8'),
  ) as unknown;
  expect(await generateOpenApi()).toEqual(committed);
});
