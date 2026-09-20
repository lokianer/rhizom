import { createBrowserRouter } from 'react-router';
import { RouterProvider } from 'react-router/dom';

import { HomePage } from './HomePage.js';
import { Layout } from './Layout.js';

// Created once at module level: a data router must not live in React state.
const router = createBrowserRouter([
  {
    path: '/',
    Component: Layout,
    children: [
      { index: true, Component: HomePage },
      // Splat routes: the note path keeps its slashes, without the .md extension.
      // The editor brings CodeMirror and its Markdown grammar, which together are the largest
      // thing in the app and of no use to somebody who came to read; like the three below it is
      // fetched when someone goes there rather than on the first page.
      {
        path: 'notes/*',
        lazy: async () => ({ Component: (await import('./NotePage.js')).NotePage }),
      },
      // The graph brings the force layout, the wiki the Markdown renderer; both are loaded
      // when someone goes there rather than on the first page.
      {
        path: 'wiki/*',
        lazy: async () => ({ Component: (await import('./WikiPage.js')).WikiPage }),
      },
      {
        path: 'graph',
        lazy: async () => ({ Component: (await import('./GraphPage.js')).GraphPage }),
      },
      {
        path: 'glossary',
        lazy: async () => ({ Component: (await import('./GlossaryPage.js')).GlossaryPage }),
      },
      // Anything unmatched shows the home page. React Router ranks routes by how specific they
      // are rather than by order, so this does not shadow its siblings; it is written last
      // because that is where a reader looks for the fallback.
      { path: '*', Component: HomePage },
    ],
  },
]);

export function App() {
  return <RouterProvider router={router} />;
}
