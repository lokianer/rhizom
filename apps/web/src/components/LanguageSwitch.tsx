import { useId } from 'react';
import { useTranslation } from 'react-i18next';

import { changeLanguage } from '../i18n/index.js';
import { isSupportedLanguage, supportedLanguages } from '../i18n/detect.js';

export function LanguageSwitch() {
  const { t, i18n } = useTranslation();
  const id = useId();
  // resolvedLanguage is `string | undefined` under strict typing; language is always set.
  const current = i18n.resolvedLanguage ?? i18n.language;

  return (
    <div className="language-switch">
      <label htmlFor={id}>{t('language.switch')}</label>{' '}
      <select
        id={id}
        value={current}
        onChange={(event) => {
          const next = event.target.value;
          if (isSupportedLanguage(next)) {
            void changeLanguage(next);
          }
        }}
      >
        {supportedLanguages.map((language) => (
          <option key={language} value={language}>
            {t(`language.names.${language}`)}
          </option>
        ))}
      </select>
    </div>
  );
}
