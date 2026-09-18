import { useTranslation } from 'react-i18next';

import { LanguageSwitch } from './components/LanguageSwitch.js';

export function App() {
  const { t } = useTranslation();

  return (
    <main className="app-shell">
      <header>
        <h1>{t('app.name')}</h1>
        <p>{t('app.tagline')}</p>
      </header>
      <LanguageSwitch />
    </main>
  );
}
