// Assembles the static landing page for GitHub Pages: everything in site/ plus the design
// tokens shared with the web app, so the page and the app never drift apart in colour.
import { cpSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const source = join(root, 'site');
const tokens = join(root, 'apps', 'web', 'src', 'styles', 'tokens.css');
const target = join(root, 'dist', 'site');

rmSync(target, { recursive: true, force: true });
mkdirSync(target, { recursive: true });
cpSync(source, target, { recursive: true });
cpSync(tokens, join(target, 'tokens.css'));
writeFileSync(join(target, '.nojekyll'), '');

console.log(`Site assembled in ${target}`);
