// The `/v/:vault` route: the app inside a vault, or a page saying the vault does not exist.
import { useTranslation } from 'react-i18next';
import { Link, useLoaderData, useParams } from 'react-router';

import { vaultHref } from '../routing/vault.js';
import { Layout } from './Layout.js';
import type { VaultLoaderData } from './vault-loader.js';

export function VaultRoot() {
  const { known, vaults } = useLoaderData<VaultLoaderData>();
  const { vault = '' } = useParams();
  const { t } = useTranslation();
  if (!known) {
    return (
      <main className="rz-page rz-home">
        <h2>{t('vault.notFound.title')}</h2>
        <p>{t('vault.notFound.body', { id: vault })}</p>
        <ul className="rz-recent">
          {vaults.map((entry) => (
            <li key={entry.id}>
              <Link to={vaultHref('/', entry.id)}>{entry.name}</Link>
            </li>
          ))}
        </ul>
      </main>
    );
  }
  // Keyed by the vault: switching remounts everything below, so no component keeps state that
  // belongs to the vault it came from.
  return <Layout key={vault} />;
}
