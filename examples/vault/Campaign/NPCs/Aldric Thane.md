---
type: npc
race: human
class: paladin
alignment: lawful good
faction: Order of the Lantern
age: 47
alive: true
outlook: 15
standing: 78
tags:
  - campaign
  - campaign/silverstadt/npcs
  - npc/ally
aliases:
  - Captain Thane
---

# Aldric Thane

Captain of the [[Order of the Lantern]]'s night watch on the [[Lantern Bridge]]. Broad, grey at the temples, speaks slowly because he expects to be quoted back at himself. He has worked the bridge for nineteen years and treats the river as a colleague rather than a hazard.

#campaign/silverstadt/npcs

## Appearance and manner

Wears the Order's dark blue coat with the lantern badge blackened by weather. Keeps a pocket ledger of favours owed (he and Ilex compared notes once, to mutual respect). Never sits with his back to a door.

## What he wants

Order, in the literal sense. He believes the fire at the Municipal [[Campaign/Places/Archive|Archive]] was set to destroy a specific record and wants to know which one before the [[The Archivists|Archivists]] do.

> [!gm] revealed: 12
> Aldric owes Mira forty gold, and she has reminded him of it twice. The party overheard the second time.

## Relationship to the party

| Session | Event | Attitude after |
| --- | --- | --- |
| 4 | Met on the bridge during the smugglers' business | Neutral |
| 7 | Party returned a stolen watch lantern | Friendly |
| 11 | Warned the party off the Gutter Court, see [[Session 11 – Under the Lantern Bridge]] | Friendly, worried |
| 13 | Found them near the Archive fire | Suspicious |

## Voice notes

Short sentences. Calls everyone "citizen" until he decides to use their name, which is a promotion. Says "the river remembers" when he means "I remember".

## Stats

Uses the Knight stat block with Divine Smite and Lay on Hands added; AC 18, 52 hit points, a +2 longsword he calls Vigil. Does not draw it in the city if he can avoid it.

```statblock
name: Captain Aldric Thane
size: Medium
type: humanoid
subtype: human
alignment: lawful good
ac: 18
hp: 52
hit_dice: 8d8 + 16
speed: 30 ft.
stats: [16, 11, 14, 11, 13, 15]
saves:
  - con: 4
  - wis: 3
senses: passive Perception 11
languages: Common
cr: 3
traits:
  - name: Brave
    desc: He has advantage on saving throws against being frightened.
actions:
  - name: Vigil (+2 longsword)
    desc: "Melee Weapon Attack: +7 to hit, reach 5 ft., one target. Hit: 9 (1d8 + 5) slashing damage."
  - name: Lay on Hands
    desc: He restores up to 25 hit points to a creature he touches, from a pool that refills after a long rest.
reactions:
  - name: Parry
    desc: He adds 2 to his AC against one melee attack that would hit him.
```
