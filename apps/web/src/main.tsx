import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import './styles/tokens.css';
import './styles/base.css';
// Initialises i18next synchronously (bundled resources, synchronous detector) and registers
// the instance with react-i18next, so it must run before the first render.
import './i18n/index.js';
import { App } from './app/App.js';

const container = document.getElementById('root');
if (!container) {
  throw new Error('index.html is missing the #root element');
}

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
