// The vault this tab is in. One tab shows one vault at a time, and the `/v/:vault` loader sets
// it before anything inside renders, so the API client, the event stream and every in-app link
// can read it here instead of threading it through every component.
import type { VaultSummary } from '@rhizom/core';

const LAST_VAULT_KEY = 'rhizom.lastVault';
const FALLBACK = 'default';

let current = FALLBACK;

export function currentVault(): string {
  return current;
}

/**
 * Makes `id` the tab's vault. `remember` is false when the server's list of vaults could not be
 * read: the id is then a guess, and must not replace the vault this browser actually used last.
 */
export function setCurrentVault(id: string, remember = true): void {
  current = id;
  if (!remember) {
    return;
  }
  try {
    window.localStorage.setItem(LAST_VAULT_KEY, id);
  } catch {
    // Storage blocked: the next visit starts at the first vault, which is fine.
  }
}

export function lastVault(): string | null {
  try {
    return window.localStorage.getItem(LAST_VAULT_KEY);
  } catch {
    return null;
  }
}

/** Whether an address in `vault` lies outside the vault the tab is in. */
export function leavesVault(vault: string | undefined): boolean {
  return vault !== current;
}

/** `/notes/X` inside a vault: `/v/<id>/notes/X`. */
export function vaultHref(path: string, vault: string = current): string {
  const prefix = `/v/${encodeURIComponent(vault)}`;
  return path === '/' || path === '' ? prefix : `${prefix}${path}`;
}

/** The in-vault part of a pathname: `/v/dnd/notes/X` → `/notes/X`. */
export function stripVault(pathname: string): string {
  const match = /^\/v\/[^/]+(\/.*)?$/.exec(pathname);
  if (match === null) {
    return pathname;
  }
  return match[1] ?? '/';
}

/**
 * The remembered vault while it is still registered, else the first one. With no list at all —
 * the server could not be asked — the remembered vault is still the best guess.
 */
export function pickVault(vaults: readonly VaultSummary[], remembered: string | null): string {
  if (remembered !== null && (vaults.length === 0 || vaults.some((v) => v.id === remembered))) {
    return remembered;
  }
  return vaults[0]?.id ?? FALLBACK;
}

/**
 * The address a redirect loader was asked for, with its fragment. A loader's request carries no
 * fragment — a `Request` never does — so `/wiki/Home#voice` would lose its heading on the way to
 * the vault. The address bar still has it when it shows the same page, which on a fresh load or a
 * bookmark it does.
 */
export function legacyUrl(requestUrl: string, location: { pathname: string; hash: string }): URL {
  const url = new URL(requestUrl);
  if (url.hash === '' && location.pathname === url.pathname) {
    url.hash = location.hash;
  }
  return url;
}

/** Where an address from before vaults were in the URL (`/notes/…`, `/graph?…`) lives now. */
export function redirectTarget(url: URL, vault: string): string {
  return vaultHref(`${url.pathname === '/' ? '' : url.pathname}${url.search}${url.hash}`, vault);
}
