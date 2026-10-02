// The way between vaults, in the header. Shown only when the operator registered more than one:
// a single-vault setup looks exactly as it did before vaults were in the URL.
import type { VaultSummary } from '@rhizom/core';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';

import { vaultHref } from '../../routing/vault.js';
import { showsVaultSwitcher } from './commands-model.js';

export function VaultSwitcher({ vaults, current }: { vaults: VaultSummary[]; current: string }) {
  const navigate = useNavigate();
  const { t } = useTranslation();
  if (!showsVaultSwitcher(vaults)) {
    return null;
  }
  return (
    <select
      aria-label={t('vault.switch')}
      value={current}
      onChange={(event) => {
        void navigate(vaultHref('/', event.target.value));
      }}
    >
      {vaults.map((vault) => (
        <option key={vault.id} value={vault.id}>
          {vault.name}
        </option>
      ))}
    </select>
  );
}
