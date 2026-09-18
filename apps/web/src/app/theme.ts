import type { ThemeChoice } from '../store/ui.js';

/**
 * Writes the chosen theme onto <html>, where tokens.css picks it up: Humus is the default,
 * Kalk is the light one, "system" follows the operating system.
 */
export function applyTheme(choice: ThemeChoice): void {
  document.documentElement.dataset.theme = choice;
}
