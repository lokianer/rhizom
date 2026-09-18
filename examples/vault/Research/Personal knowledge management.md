---
type: research
status: long
started: 2026-04-02
last_major_edit: 2026-09-16
sources:
  - Bush, Vannevar. "As We May Think." The Atlantic Monthly, July 1945.
  - 'Frand, Jason and Carol Hixon. "Personal Knowledge Management: Who, What, Why, When, Where, How?" Working paper, UCLA Anderson School of Management, 1999.'
  - Allen, David. Getting Things Done. Viking, 2001.
  - Ahrens, Sönke. How to Take Smart Notes. 2017.
  - Forte, Tiago. Building a Second Brain. Atria, 2022.
tags:
  - research
  - research/pkm
---

#research/pkm

# Personal knowledge management

The longest note in the vault and the one I rewrite most. It is the practical companion to the metaphors in [[Rhizomes]] and [[Mycorrhizal networks]]: not what a collection of notes is *like*, but what I do with mine on a Tuesday, and why. Sections are in the order the work happens: capture, organise, find, review. The history is first because I keep forgetting that none of this is new.

## What the term covers

"Personal knowledge management" is an awkward phrase for an old habit. People have kept commonplace books since the Renaissance, card indexes since the nineteenth century and diaries for as long as there has been paper. The phrase itself comes from a 1999 working paper by Frand and Hixon at UCLA, who were trying to name the skills a business student would need to cope with more information than any one person could hold, and who defined it, sensibly, as a set of processes an individual uses to gather, classify, store, search and retrieve knowledge in their daily activities. That definition still holds. Everything since has been argument about the processes.

What the term does not cover, though it is often sold as if it did, is thinking. A note is a place to put a thought so that you can stop holding it. Whether the thought was any good is not the note's problem.

## History in five stops

### 1945: the memex

Vannevar Bush, in *The Atlantic* in the summer of 1945, imagined a desk with microfilm inside it and two screens on top. The user reads a document on one screen, another on the second, and presses a lever to join them; from then on, calling up either recalls the other. He called the joins *trails* and the desk a *memex*. Two things about it matter here. The trails are made by hand, one at a time, by the person who will follow them; there is no algorithm. And the memex is a desk, not a network: one person's trails on one person's film. The idea of sharing trails is in the essay but only as an aside to the main one, which is that a person's associations are worth keeping.

### 1981: the slip box explains itself

Niklas Luhmann's essay on communicating with his card index is covered in [[Zettelkasten]]. For this note the point is his claim that the box paid back what you put into it only after years, and only if you had put things in without knowing what they would be for. That is a hard sell in 1981 and a harder one now.

### 1999: the term

Frand and Hixon, above. Their paper is a curriculum proposal and reads like one, but it fixes the word.

### 2001: Getting Things Done

David Allen's book is about tasks, not knowledge, and I include it because it supplied the vocabulary that every later system borrowed: the *inbox* as a single place where everything lands, the *weekly review* as the ritual that keeps the inbox from becoming a landfill, and the rule that a thing is either actionable or it is reference, and reference goes somewhere you can find it and nowhere else. The daily notes in this vault are Allen's inbox with a date on it.

### 2017 onwards: the second wave

Ahrens's book on the slip box, Forte's on the "second brain", and the arrival of tools that treat a folder of plain text files as a graph. This is the wave I am in. Its distinguishing belief is that the link, not the folder, is the primary way to organise, and its distinguishing weakness is that it produces a great many notes about note-taking. This note is one of them; I try to keep it to one.

## Capture

Capture is getting the thing out of your head and into the system before it goes. It has to be fast, and it has to be forgiving, because if it is either slow or fussy you will not do it and the system starves.

### Inbox

#### The rule of one place

Everything that is captured lands in one place. For me that is the daily note for the day: [[2026-09-16]] has two thoughts about the vault graph in it that will end up in [[Graph visualisation]] or nowhere, and that is fine. The reason for one place is not tidiness; it is that a capture step which asks "where does this go" at capture time will lose the thought while you decide. Decide later.

#### What goes in

Anything. A line from a paper, a ruling made at the game table, a name the players invented, the shape of a chart. The daily note is the only place in the vault where I allow myself to be incoherent, and the only place where a fragment does not need a link, because the date is its link.

### Fleeting notes

Ahrens's word for the scribbles. Mine live in the daily note and have a life of about a day. If the fragment is still interesting the next morning it becomes a section of a research note or a new note; if it is not, it stays in the daily note and gets found by search or not at all. I do not move fleeting notes into a holding folder any more; the holding folder was the Inbox that [[v2.0 Notes]] removed, and it had become a place where thoughts went to be safe from being read.

### Literature notes

What a source says, in my own words, with the reference in the frontmatter. In this vault they are the research notes themselves; I do not keep a separate layer. The `sources` list at the top of each note is the literature note's citation, and the prose is the paraphrase. When a note like [[Mycorrhizal networks]] is mostly about one paper, that is a literature note that has grown a point of view.

## Folders, tags and links

The three ways of saying "this belongs with that". Every tool offers all three and every system picks a favourite. The argument is older than the tools and will outlast them; the version of it that convinced me is in [[Rhizomes#The six principles]], and the practical upshot is below.

### Folders

A folder puts a note in exactly one place. That is its strength and its limit. It is the right tool when the notes really do have one home, which in this vault means the campaign: an NPC is in `Campaign/NPCs/` and nowhere else, because at the table I need to find all the people in one list. Folders are also what the file system gives you for nothing, which means they survive the death of any particular tool. The campaign folder has a folder note, [[Campaign/Campaign|Campaign]], because a folder full of things wants an introduction; the research folder does not, because [[Home]] is its introduction.

What folders are bad at is the note that belongs to two of them. Both notes called Archive are examples: [[Campaign/Places/Archive]] is a place in the campaign, [[Research/Archive]] is a holding note for research, and they share a name because the word means the same thing in both worlds. A folder cannot say that; a link can.

### Tags

A tag puts a note in as many places as you like, and a tag is cheap, which is the problem. My first pass at this vault had forty-one tags for sixty notes, most used once. The [[v2.0 Notes]] cut them to about twenty, along two rules:

1. **Nested tags for the campaign, flat tags for research.** `campaign/silverstadt/npcs` says three things at once (it is campaign material, it is this campaign, it is a person) and the tag pane collapses them into a tree. Research tags are flat, `research/pkm` and its siblings being the only nesting, because research does not have a natural hierarchy and pretending it does was the mistake the first time.
2. **A tag must be used at least three times or it is deleted.** A tag used once is a folder with one thing in it.

The syntax has edges worth knowing. A tag is a hash followed immediately by letters, and it ends at whitespace or at punctuation, so "filed under #research/pkm, alongside the others" tags the note with `research/pkm` and not with `research/pkm,`. A hash inside code is not a tag: `#not-a-tag` is a code span and stays out of the tag pane, and so does anything inside a fenced block, which is how a shell snippet like the one below can mention a hash without filing the note under it.

```bash
# count notes that carry the pkm tag; the comment above is not a tag either
grep -rl "#fenced-not-a-tag" Research/ | wc -l
```

A hash followed by a space is a heading, and a hash followed by digits only, like an issue number, is nothing. I have watched three different tools disagree about the last one.

### Links

A link says "this note has something to do with that one", and unlike a tag it says it from a particular sentence, so the reader can see *why*. This is the reason the second wave puts links first. A link is also the only one of the three that is symmetric in effect: the target gets a backlink without being edited, which is how a note can find out that it has become important.

Links in this vault take four forms and I try to use the plainest one that works: the bare title when it reads well in the sentence; the title with a pipe and display text when it does not; the title with a hash and a heading when the whole note would be too much; and the folder path in front of the title only when two notes share a name and the plain link would be ambiguous, as with [[Campaign/Places/Archive|the Archive in Silverstadt]]. The double brackets are the only syntax in the vault that I would miss if I moved to another tool, and even they are just text: to write about them without making a link, escape them, \[\[not a link\]\], and the brackets stay on the page.

The cost of a link is that it promises the target exists. When it does not, Obsidian shows the link faded and creates the note on click; the links to [[The Ashen Codex]] and [[Lady Vermillion]] in the session notes are faded on purpose, because they are hooks and not notes yet, and I want any tool that reads this vault to leave them alone.

## Retrieval

Finding it again. In order of how often I actually use them:

1. **Search.** Full text, every time. This is why the vault is plain text and why I resist the urge to put information into frontmatter fields that search does not reach as easily as prose.
2. **Backlinks.** Opening a note and reading what points at it. This is the memex trail run backwards and it is the feature that makes links worth writing.
3. **The Home page.** [[Home]] is a hand-maintained map of content, one link to every corner. It costs a minute a week to keep honest and saves that many times over.
4. **The graph.** Rarely, and only the local graph. The full graph is a picture of the vault's shape, not a way to find anything in it; see [[Graph visualisation#The hairball]].
5. **Folders.** At the table, for the campaign, where I want a list of people and do not want to search for it.

What I never use is a hierarchy of tags as a browsing tree. It is there in the tag pane and I have not opened it in months.

## Review

Allen's weekly review, cut down. On a Sunday, or when I notice it has been a fortnight:

- [x] Read the week's daily notes and promote or delete every fragment
- [x] Open [[Home]] and check that every folder is still reachable from it in two clicks
- [ ] Look at the tag pane for tags used fewer than three times
- [ ] Open five research notes at random and fix one thing in each
- [ ] Empty `.trash/`

The unticked items are unticked because this is the week's list and it is Thursday. The review is the only part of the system that is a habit rather than a tool, and it is the part that fails first when I am busy, which is why the rule about one capture place matters: if the review slips for a month, the daily notes are still there, in order, and nothing is lost except tidiness.

## Tools I have used

| Years | Tool | What it taught me |
| --- | --- | --- |
| 2014 to 2017 | Paper notebooks, one a year | Dates are the best index |
| 2017 to 2019 | A wiki on a home server | A page that nobody links to does not exist |
| 2019 to 2021 | Outliner with bullet points | Structure imposed at capture time kills capture |
| 2021 to 2024 | Plain Markdown files in folders, synced | Folders are fine until the second Archive |
| 2024 onwards | Obsidian on the same files | Links plus search is enough; the rest is furniture |

The files from 2021 are still here, unchanged. That is the whole argument for plain text: the tool changed twice and the notes did not notice.

## Failure modes

The ways this has gone wrong for me, in the order they happened.

- **The collector's fallacy.** Saving a source felt like reading it. Cured, mostly, by the rule that a research note must contain at least one sentence that disagrees with its sources.
- **Organising instead of writing.** The two reorganisations documented in [[v2.0 Notes]] were each a fortnight during which no note was written. The second one ends with the instruction "do not reorganise; write notes", addressed to me.
- **Notes about notes.** This note. The rule now is one, and it is this one; [[Zettelkasten]] is allowed because it is about a specific historical object, and its second half, which drifts into method, is marked for cutting.
- **Orphans.** Notes with no links in or out. They accumulate in the research folder because a research note starts as a paraphrase of one source and nothing else is about that source yet. The review catches them; [[Home]] catches the rest.
- **Tag drift.** The same idea tagged `pkm`, `knowledge`, `notes` and `research/notes` in four notes written a month apart. Cured by the three-uses rule and by the tag pane, which shows the drift the moment you look.
- **Trusting the graph.** Reading a dense cluster of nodes as a dense cluster of thought. It is a dense cluster of brackets; see [[Mycorrhizal networks#Why it is in this vault]] for the biological version of the same mistake.

## What this vault does

The rules, as short as I can make them, so that I can check the vault against them and so that the tool I am writing can be tested against a vault that follows them.

1. One capture place: the daily note.
2. One folder per kind of *thing* (people, places, sessions); no folders for *ideas*, which live flat in `Research/`.
3. Links written when the sentence is written, in the plainest form that resolves.
4. Tags nested for the campaign, flat for research, deleted below three uses.
5. Frontmatter for what a machine will read (type, status, sources, dates); prose for everything a person will.
6. [[Home]] links to every folder; every note is two clicks from it.
7. Nothing is deleted from the vault by a tool. Notes go to `.trash/` by hand, and that folder is not part of the vault.
8. Broken links are allowed and shown as broken. Two notes may share a name. A note may be empty, or malformed, or saved by a Windows editor with its own ideas about line endings, and the vault still opens.

The last rule is the one the tool exists to honour, and this note, being the longest and most heavily linked in the vault, is a reasonable place to find out whether it does.

## Reading

Beyond the sources in the frontmatter, the pieces I would hand someone who asked where to start, with a sentence on why.[^1]

- Bush, for the memex, because it is short and it is the origin of the link as a personal act rather than a publishing one.
- Luhmann's 1981 essay, because it is the only first-person account by someone whose system demonstrably worked over forty years, and because it is funnier than its reputation.
- Ahrens, for the workflow, with the caveat that the book is twice as long as its argument.
- Munzner on visualisation, for the chapter on what a picture of a network can and cannot show, which is the sober version of [[Graph visualisation]].

[^1]: I have left out the essays on "evergreen notes" and similar because they are good and because they are the part of the second wave that turned into notes about notes. Read them after you have a hundred notes of your own, not before.
