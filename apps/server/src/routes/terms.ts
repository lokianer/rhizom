// The vocabulary a vault defines: one entry per note that declares itself a definition. The
// `terms` table is what finds those notes without parsing the frontmatter of every note in the
// vault; the browser expands an entry into the names it answers to with `glossaryTerms`.
import { Type } from '@sinclair/typebox';

import type { VaultContext } from '../vault/context.js';
import { ErrorSchema, GlossaryEntrySchema } from './schemas.js';
import type { TypedApp } from './typed-app.js';

export function registerTermRoutes(app: TypedApp, context: () => VaultContext): void {
  app.get(
    '/api/glossary',
    {
      schema: {
        tags: ['terms'],
        summary: 'One entry per definition note, sorted by title',
        response: { 200: Type.Array(GlossaryEntrySchema), 503: ErrorSchema },
      },
    },
    () => context().index.glossary(),
  );
}
