---
type: query
---

# Open questions

A page that keeps itself current. The blocks below are read from the index every time this note
is opened, so nothing here has to be maintained by hand.

Everything in Research, most recently changed first:

```rhizom-query
from: Research
sort: -modified
limit: 5
```

The people of the campaign, with the tags that say what they are to the party:

```rhizom-query
from: Campaign/NPCs
as: table
columns: [title, tags, modified]
```

What the vault defines, as cards:

```rhizom-query
type: definition
as: cards
```

A query block understands ten keys and nothing else — `from`, `type`, `tag`, `title`, `linksTo`,
`where`, `sort`, `limit`, `as` and `columns`. There is no expression language on purpose: a vault
is a folder that can come from anywhere, and opening one should never be the moment it starts
running something. A key Rhizom does not know is reported underneath the block, with its line,
and the rest of the block still answers.
