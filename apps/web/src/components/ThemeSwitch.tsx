import { useId } from 'react';
import { useTranslation } from 'react-i18next';

import { useUiStore, type ThemeChoice } from '../store/ui.js';

const CHOICES: ThemeChoice[] = ['humus', 'kalk', 'system'];

function isThemeChoice(value: string): value is ThemeChoice {
  return (CHOICES as string[]).includes(value);
}

export function ThemeSwitch() {
  const { t } = useTranslation();
  const id = useId();
  const theme = useUiStore((state) => state.theme);
  const setTheme = useUiStore((state) => state.setTheme);

  return (
    <div className="rz-field">
      <label htmlFor={id}>{t('theme.switch')}</label>{' '}
      <select
        id={id}
        value={theme}
        onChange={(event) => {
          const next = event.target.value;
          if (isThemeChoice(next)) {
            setTheme(next);
          }
        }}
      >
        {CHOICES.map((choice) => (
          <option key={choice} value={choice}>
            {t(`theme.${choice}`)}
          </option>
        ))}
      </select>
    </div>
  );
}
