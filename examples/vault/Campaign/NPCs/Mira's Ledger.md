---
type: npc
race: half-elf
class: rogue
alignment: lawful evil
faction: The Gutter Court
occupation: moneylender
outlook: 55
standing: 30
tags:
  - campaign/silverstadt/npcs
  - npc/antagonist
aliases:
  - Mira Voss
  - Mira
---

# Mira's Ledger

The note is named after the ledger rather than the woman because the ledger is what the party is actually afraid of. Mira Voss lends money from a narrow house on Bell Square and keeps every debt in the city, including a great many she did not make, in a single bound volume with a brass clasp. Nobody has seen inside it and lived to describe it, which is a rumour she encourages.

#campaign/silverstadt/npcs

## The woman

Half-elf, fifties, grey bob, very good coat. Speaks quietly and lets people fill the silence with concessions. Publicly independent; privately the treasurer of [[The Gutter Court]], which is why [[Sable]] defers to her and hates it.

## The ledger

Contents, so far as the party has pieced together from [[Session 11 – Under the Lantern Bridge]] and Orrin's questions:

| Debtor | Amount | Note |
| --- | --- | --- |
| [[Brannoc Ironweld]] | 80 gp | Tools; he pays interest in repairs |
| Orrin Quill | 300 gp | The party's debt, see [[A Debt to Mira]] |
| The Municipal [[Campaign/Places/Archive\|Archive]] | unknown | The Archive owes *her*, which nobody can explain |
| ~~Harl Bellringer~~ | 40 gp | Struck through in her own hand the day he disappeared, see [[The Missing Bellringer]] |

## What she wants

To be the only one in the city who knows what everyone owes. The tidewater charts threaten that, because whatever is under the [[Sunken Archive]] predates her ledger.

> [!gm] The last page
> Mira forged the Archive's debt herself, to keep a hold on the city clerk. If the party reads the last page, she knows within the hour.

## Stats

Master Thief stat block, no weapons on her person. Four bodyguards, always in the next room.

```statblock
name: Mira Voss
size: Medium
type: humanoid
subtype: half-elf
alignment: lawful evil
ac: 16
hp: 84
hit_dice: 13d8 + 26
speed: 30 ft.
stats: [11, 18, 14, 17, 15, 16]
saves:
  - dex: 7
  - int: 6
skillsaves:
  - deception: 9
  - insight: 8
  - investigation: 6
senses: passive Perception 12
languages: Common, Elvish, Thieves' cant
cr: 5
ledger_pages: 412
traits:
  - name: Cunning Action
    desc: On each of her turns she can take the Dash, Disengage or Hide action as a bonus action.
  - name: Every Debt Recorded
    desc: She knows what anyone in Silverstadt owes, to whom, and since when.
actions:
  - name: Hidden Blade
    desc: "Melee Weapon Attack: +7 to hit, reach 5 ft., one target. Hit: 7 (1d6 + 4) piercing damage, plus 14 (4d6) if she has advantage."
reactions:
  - name: Call the Debt
    desc: When a creature that owes her money attacks her, it has disadvantage on the roll.
```
