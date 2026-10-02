// Everything that belongs to one vault, emptied before another one is shown. The note sources
// and query answers already know how to forget everything after a rebuild; a switch is the same
// event as far as they are concerned.
import { useNoteSources } from './notes.js';
import { useQueryResults } from './queries.js';
import { resetVaultStore } from './vault.js';

export function resetVaultStores(): void {
  resetVaultStore();
  useNoteSources.getState().invalidate(null);
  useQueryResults.getState().invalidate();
}
