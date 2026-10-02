// What the `/v/:vault` route knows before anything inside it renders: which vaults exist, and
// whether the address names one of them. Picking a vault here, rather than in a component, means
// the API client, the stores and every link already point at it when the first page draws.
import type { VaultSummary } from '@rhizom/core';
import { redirect, type LoaderFunctionArgs, type ShouldRevalidateFunctionArgs } from 'react-router';

import { api } from '../api/client.js';
import {
  lastVault,
  leavesVault,
  legacyUrl,
  pickVault,
  redirectTarget,
  setCurrentVault,
} from '../routing/vault.js';
import { resetVaultStores } from '../store/reset.js';
import { switchVaultUi } from '../store/vault-ui.js';
import { useVaultStore } from '../store/vault.js';

let registered: Promise<VaultSummary[]> | undefined;
let shown: string | null = null;

/**
 * The registered vaults, asked for once per page load: they only change when the server
 * restarts. A server that cannot be reached answers with none, and the pages then say what is
 * wrong the way they always have, instead of the router's error screen.
 */
export function registeredVaults(): Promise<VaultSummary[]> {
  registered ??= api.vaults().catch(() => {
    registered = undefined;
    return [];
  });
  return registered;
}

export interface VaultLoaderData {
  vaults: VaultSummary[];
  known: boolean;
}

export async function vaultLoader({
  params,
  request,
}: LoaderFunctionArgs): Promise<VaultLoaderData> {
  const vaults = await registeredVaults();
  const id = params.vault ?? '';
  // With no vault configured there is nothing to switch to; the pages say so as they do today.
  const known = vaults.length === 0 || vaults.some((vault) => vault.id === id);
  if (known && id !== shown) {
    shown = id;
    setCurrentVault(id, vaults.length > 0);
    resetVaultStores();
    await switchVaultUi(id);
    // A page that stays mounted — the way back from a switch that never committed — does not
    // load again by itself; a fresh one finds this load already running and waits for it. Not
    // for the player view, which must not hold the GM's note list, tree or tags at all: going
    // from there to the GM lens mounts the layout, and the layout loads.
    if (!isPlayerView(new URL(request.url).pathname)) {
      void useVaultStore.getState().load();
    }
  }
  return { vaults, known };
}

/**
 * React Router keeps a parent's data while its parameters stay the same. A switch that was
 * interrupted before it committed leaves the tab speaking to the other vault while this one is on
 * screen, with the same parameters; the next navigation inside it must run the loader again.
 */
export function revalidateVault({
  nextParams,
  defaultShouldRevalidate,
}: Pick<ShouldRevalidateFunctionArgs, 'nextParams' | 'defaultShouldRevalidate'>): boolean {
  return leavesVault(nextParams.vault) || defaultShouldRevalidate;
}

/** `/` and every address from before vaults were in the URL. */
export async function legacyRedirect({ request }: LoaderFunctionArgs): Promise<Response> {
  const vaults = await registeredVaults();
  return redirect(
    redirectTarget(legacyUrl(request.url, window.location), pickVault(vaults, lastVault())),
  );
}

/** Whether an address is the player view's: `/v/<id>/table`, or anything below it. */
export function isPlayerView(pathname: string): boolean {
  return /^\/v\/[^/]+\/table(?:\/|$)/.test(pathname);
}
