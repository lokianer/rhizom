// The control that chooses how the graph page draws the vault: the bubble field, or a milieu
// field between two named axes.
//
// In a file of its own because both layouts carry it at the head of their controls, and neither
// may import the other.
import type { JSX } from 'react';
import { useTranslation } from 'react-i18next';

import { useUiStore } from '../store/ui.js';

export function GraphLayoutSelect(): JSX.Element {
  const { t } = useTranslation();
  const layout = useUiStore((state) => state.graphLayout);
  const setGraphLayout = useUiStore((state) => state.setGraphLayout);

  return (
    <div className="rz-field">
      <label htmlFor="rz-graph-layout">{t('graph.layout')}</label>{' '}
      <select
        id="rz-graph-layout"
        value={layout}
        onChange={(event) => {
          setGraphLayout(event.target.value === 'milieu' ? 'milieu' : 'bubbles');
        }}
      >
        <option value="bubbles">{t('graph.bubbles')}</option>
        <option value="milieu">{t('graph.milieu')}</option>
      </select>
    </div>
  );
}
