# Example vault

`vault/` is a small Obsidian vault that stands in for a real one: a D&D campaign, a handful of
research notes, daily notes, templates and a couple of attachments, with the mess a vault
accumulates after a few months of use. It exists for four things:

- the Phase 1 acceptance test ("a real Obsidian vault opens and works"),
- the Playwright end-to-end tests,
- the Docker demo,
- screenshots and examples in the documentation.

It deliberately contains the awkward cases a parser has to survive: two notes with the same
name in different folders, three links to notes that do not exist, one note with broken
frontmatter, one with an empty frontmatter block, one saved with Windows line endings, one
starting with a byte order mark, an empty note, a 15 KB note, file names with an umlaut, an
apostrophe, a dot and an en dash, tags inside code that must not count, and an `.obsidian/`
folder and a `.trash/` folder that must be ignored.

`vault.manifest.json` next to it lists what an indexer should find (note count, the unresolved
link targets, the ambiguous name, tags that must and must not exist, embed targets, expected
titles). Tests read the manifest rather than hard-coding these numbers.

## Pointing Rhizom at it

The server serves one vault, chosen by `RHIZOM_VAULT_DIR` (absolute, or relative to the working
directory):

```sh
RHIZOM_VAULT_DIR=examples/vault pnpm dev
```

In development the variable can be left unset: when `NODE_ENV` is not `production`, the server
falls back to `examples/vault` and logs that it did. The Docker image expects a vault at
`/vault`; mount this folder there to run the demo against it.

## Editing the vault

Keep it small (under 300 KB) and keep the manifest in step: if a note, link, tag or special
file changes, change the corresponding entry. The line-ending and encoding quirks are part of
the fixture, so do not let an editor or formatter normalise `Research/Zettelkasten.md` (CRLF),
`Research/Sinus-Milieus.md` (BOM) or `Daily/Scratch.md` (0 bytes).
