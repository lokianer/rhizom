// The sidebar's tabs, and the modifier key the shortcut labels are written with.
import type { SidebarTab } from '../../store/ui.js';

/** The sidebar's tabs in the order they stand, each with the key that names it. */
export const SIDEBAR_TABS = [
  { tab: 'tree', label: 'sidebar.files' },
  { tab: 'search', label: 'sidebar.search' },
  { tab: 'tags', label: 'sidebar.tags' },
  { tab: 'outline', label: 'sidebar.outline' },
] as const satisfies readonly { tab: SidebarTab; label: string }[];

/** The modifier the shortcuts use, Command on Apple systems and Control everywhere else. */
export function modifierLabel(): string {
  return navigator.platform.startsWith('Mac') || navigator.platform === 'iPhone' ? '⌘' : 'Ctrl';
}
