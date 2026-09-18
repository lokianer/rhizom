// Generates a synthetic vault for performance testing: many interlinked Markdown notes with
// frontmatter, tags and headings. Deterministic (seeded), so two runs with the same arguments
// produce identical files.
//
//   node scripts/generate-vault.mjs <target-dir> [--notes 5000] [--links 4] [--seed 42]
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const args = parseArgs(process.argv.slice(2));
if (!args.target) {
  console.error(
    'usage: node scripts/generate-vault.mjs <target-dir> [--notes N] [--links N] [--seed N]',
  );
  process.exit(2);
}

const random = mulberry32(args.seed);
const folders = [
  'Research',
  'Campaign/NPCs',
  'Campaign/Places',
  'Daily',
  'Projects',
  'Reading',
  'Ideas',
  'Archive',
];
const topics = [
  'rhizome',
  'mycelium',
  'archive',
  'ledger',
  'harbour',
  'lantern',
  'index',
  'graph',
  'vault',
  'compass',
  'river',
  'granite',
  'saffron',
  'meridian',
  'quorum',
  'tessera',
  'ember',
  'lattice',
];
const words = (
  'the a of and to in is on with from by as at into over under between through during without ' +
  'note link graph index vault folder tag heading paragraph draft revision source claim question ' +
  'evidence pattern structure system layer boundary interface signal noise memory field cluster ' +
  'edge node bubble milieu axis colour legend export search preview outline palette command'
).split(' ');

const names = Array.from({ length: args.notes }, (_, i) => {
  const topic = topics[Math.floor(random() * topics.length)] ?? 'note';
  return `${capitalize(topic)} ${String(i + 1).padStart(4, '0')}`;
});
const paths = names.map((name, i) => `${folders[i % folders.length] ?? 'Notes'}/${name}.md`);

rmSync(args.target, { recursive: true, force: true });
for (const folder of folders) {
  mkdirSync(join(args.target, ...folder.split('/')), { recursive: true });
}

let linkCount = 0;
for (const [i, path] of paths.entries()) {
  const name = names[i] ?? 'Note';
  const tags = pick(
    ['research', 'campaign', 'daily', 'idea', 'reading', 'todo', 'people', 'places'],
    1 + Math.floor(random() * 3),
  );
  const lines = [
    '---',
    `title: ${name}`,
    `tags: [${tags.join(', ')}]`,
    `created: 2026-${String(1 + Math.floor(random() * 9)).padStart(2, '0')}-${String(1 + Math.floor(random() * 28)).padStart(2, '0')}`,
    `weight: ${Math.floor(random() * 100)}`,
    '---',
    '',
    `# ${name}`,
    '',
  ];
  const sections = 2 + Math.floor(random() * 4);
  for (let s = 0; s < sections; s += 1) {
    lines.push(`## ${capitalize(sentence(3, 5))}`, '');
    const paragraphs = 1 + Math.floor(random() * 3);
    for (let p = 0; p < paragraphs; p += 1) {
      lines.push(paragraphWithLinks(i), '');
    }
  }
  lines.push(`Tags: ${tags.map((t) => `#${t}`).join(' ')}`, '');
  writeFileSync(join(args.target, ...path.split('/')), lines.join('\n'));
}

console.log(
  `Generated ${String(paths.length)} notes with ${String(linkCount)} links in ${args.target}`,
);

/**
 * @param {number} sourceIndex
 * @returns {string}
 */
function paragraphWithLinks(sourceIndex) {
  const parts = [];
  const sentences = 3 + Math.floor(random() * 4);
  for (let s = 0; s < sentences; s += 1) {
    parts.push(capitalize(sentence(8, 18)) + '.');
    if (random() < args.links / (sentences * 3)) {
      // Prefer neighbours so folders form clusters, with some long-range links.
      const spread = random() < 0.8 ? 40 : paths.length;
      const target = (sourceIndex + 1 + Math.floor(random() * spread)) % paths.length;
      const targetName = names[target] ?? 'Note';
      parts.push(
        random() < 0.3
          ? `See [[${targetName}|${targetName.toLowerCase()}]].`
          : `See [[${targetName}]].`,
      );
      linkCount += 1;
    }
  }
  return parts.join(' ');
}

/**
 * @param {number} min
 * @param {number} max
 * @returns {string}
 */
function sentence(min, max) {
  const length = min + Math.floor(random() * (max - min + 1));
  return Array.from({ length }, () => words[Math.floor(random() * words.length)] ?? 'note').join(
    ' ',
  );
}

/**
 * @template T
 * @param {T[]} items
 * @param {number} count
 * @returns {T[]}
 */
function pick(items, count) {
  const copy = [...items];
  const out = [];
  while (out.length < count && copy.length > 0) {
    const [item] = copy.splice(Math.floor(random() * copy.length), 1);
    if (item !== undefined) {
      out.push(item);
    }
  }
  return out;
}

/**
 * @param {string} text
 * @returns {string}
 */
function capitalize(text) {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/**
 * Small, fast seeded PRNG (32-bit state), good enough for test data.
 * @param {number} seed
 * @returns {() => number}
 */
function mulberry32(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * @param {string[]} argv
 * @returns {{ target: string | undefined, notes: number, links: number, seed: number }}
 */
function parseArgs(argv) {
  /** @type {{ target: string | undefined, notes: number, links: number, seed: number }} */
  const parsed = { target: undefined, notes: 5000, links: 4, seed: 42 };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = argv[i + 1];
    if (arg === '--notes' && next !== undefined) {
      parsed.notes = Number(next);
      i += 1;
    } else if (arg === '--links' && next !== undefined) {
      parsed.links = Number(next);
      i += 1;
    } else if (arg === '--seed' && next !== undefined) {
      parsed.seed = Number(next);
      i += 1;
    } else if (arg !== undefined && !arg.startsWith('--')) {
      parsed.target = arg;
    }
  }
  return parsed;
}
