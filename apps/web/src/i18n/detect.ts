/** UI languages in order of preference: English is the default, German the second. */
export const supportedLanguages = ['en', 'de'] as const;

export type SupportedLanguage = (typeof supportedLanguages)[number];

export const fallbackLanguage: SupportedLanguage = 'en';

export function isSupportedLanguage(value: unknown): value is SupportedLanguage {
  return typeof value === 'string' && (supportedLanguages as readonly string[]).includes(value);
}

/**
 * Picks the UI language: an explicitly stored choice wins, then the first browser preference
 * whose language part is supported, then English.
 */
export function resolveLanguage(
  stored: string | null | undefined,
  preferred: readonly string[],
): SupportedLanguage {
  if (isSupportedLanguage(stored)) {
    return stored;
  }
  for (const tag of preferred) {
    const language = tag.toLowerCase().split('-')[0];
    if (isSupportedLanguage(language)) {
      return language;
    }
  }
  return fallbackLanguage;
}
