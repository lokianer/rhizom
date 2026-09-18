// Typed translation keys: t('app.name') is checked against the English bundle.
// The file has a top-level import, so `declare module` augments i18next instead of shadowing it.
import type { defaultNS, resources } from './index.js';

declare module 'i18next' {
  interface CustomTypeOptions {
    defaultNS: typeof defaultNS;
    resources: (typeof resources)['en'];
  }
}
