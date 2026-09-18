// Writes the OpenAPI document to apps/server/openapi.json; openapi.test.ts fails when it is stale.
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { generateOpenApi } from '../openapi.js';

const target = fileURLToPath(new URL('../../openapi.json', import.meta.url));
writeFileSync(target, `${JSON.stringify(await generateOpenApi(), null, 2)}\n`);
console.log(`Wrote ${target}`);
