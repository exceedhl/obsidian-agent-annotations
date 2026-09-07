---
name: obsidian-agent-annotations
description: Apply pending Obsidian Agent Annotations from .obsidian/agent-annotations/current.json. Use when the user asks to apply annotations, process the review queue, run the annotation skill, or fix notes from current.json.
---

# Obsidian Agent Annotations

Read the pending instruction list and edit the Markdown files directly. The human does not accept or reject patches. Report every id. Write the JSON back with only unfinished rows left.

## Locate the queue

The handoff file is always:

```text
<vault>/.obsidian/agent-annotations/current.json
```

`file` on each row is a path relative to `<vault>` (the folder that contains `.obsidian`), not to the git repo or cwd.

Find `<vault>` in this order:

1. `$VAULT_PATH` if it is set and the file exists there.
2. Walk from the current working directory toward `/`. Stop at the **first** directory that contains `.obsidian/agent-annotations/current.json`. Do not keep walking after a match.

The JSON is the only handoff. Do not ask the user to paste instructions.

- Missing file, or `annotations` is empty → say there is nothing to do, then stop. Do not create the file.
- Unreadable / invalid JSON → report the parse error, then stop. Do not rewrite the file.

## Protocol (do not weaken)

1. Snapshot **every** `id` in `annotations` before you edit anything.
2. Group rows by `file`. Locate each passage with `selectedText` first, then `headingPath`, then `prefix` / `suffix` (~40 characters of context). If two or more matches still tie, that id is failed — do not pick a winner.
3. Once you start, you must give every snapshot id an outcome (done or failed). A locate failure on one row is not a reason to stop; mark it failed and continue. Processing a subset and calling the job done is a protocol failure.
4. Make the smallest edit that satisfies `instruction`. Do not rewrite surrounding prose unless the instruction requires it.
5. Overlapping or same-heading instructions become one coherent edit in the `.md` file. The report is still one line per id.
6. Never change `instruction` text. Never write replies, status, completed, author, or thread fields into the JSON. `version` stays `1`.
7. Edit the `.md` files first. Write `current.json` **once**, at the end, only after every id has an outcome:
   - All succeeded → write `{ "version": 1, "annotations": [] }` or delete the file.
   - Some succeeded and some failed → keep **only** the failed rows, copied from the snapshot (same field values, do not rebuild a row). Drop successful ids.
   - Crash or exit before you finish the full snapshot → leave the file untouched. Do not write a partial queue.
8. After write-back (or after deciding the file is unchanged), reply with the report in **Report**. Every snapshot id must appear once.

## Location

For each row, find every occurrence of `selectedText` in that `file`. Score candidates with `headingPath` and `prefix` / `suffix`. Use the span only when exactly one candidate wins.

Treat these as "not done" and keep the row:

- The `.md` file is missing.
- `selectedText` cannot be found.
- Two or more matches still tie after `headingPath` + `prefix` / `suffix`.
- The local text has drifted so the original span is gone.

Do not invent a nearby substitute span. Do not delete a row because it looks stale.

## Write-back shapes

```json
{ "version": 1, "annotations": [] }
```

```json
{
  "version": 1,
  "annotations": [
    {
      "id": "a_001",
      "file": "docs/auth.md",
      "instruction": "解释 refresh token。",
      "selectedText": "Token 会在 24 小时后过期。",
      "headingPath": ["认证", "令牌生命周期"],
      "prefix": "…上文 40 字…",
      "suffix": "…下文 40 字…"
    }
  ]
}
```

Allowed fields on a row: `id`, `file`, `instruction`, `selectedText`, `headingPath`, `prefix`, `suffix`. Nothing else.

## Interaction

The human already wrote the instructions in Obsidian. Do not ask them to confirm, accept, or re-paste anything.

- If the queue file cannot be found, ask for the vault path once, then stop.
- If the queue is empty or the JSON is invalid, say that in one or two sentences and stop.
- Otherwise start work. Do not preview a plan and wait.
- Do not narrate file reads or tool calls.
- Do not dump `current.json`, `prefix`, `suffix`, or a full diff unless the user asks.
- Reply in the user's language.

## Report

Write the reply for a person in chat, not a log line. Structure:

1. **Lead** — one sentence they can act on:
   - all done → queue is empty
   - mixed → how many landed, how many stay in the Annotations pane
   - none landed → queue unchanged, they can fix the notes and run again
   - invalid / missing → say so; file not written
2. **By file** — one block per `file` (files in first-seen snapshot order). Inside a file, ids stay in snapshot order. Each id is one short line:
   - done — what changed in the note (one clause). Not “applied the instruction”.
   - failed — why, in plain words. Use only: file missing / selected text not found / several matches / text has drifted. Say it stays in the pane.
3. Do not list ids that were not in the snapshot. Do not omit any snapshot id.

Empty queue:

```text
No pending annotations.
```

Invalid JSON:

```text
current.json is invalid: <reason>. I did not change the file.
```

A mixed run:

```text
2 applied, 1 still in the Annotations pane.

docs/auth.md
- a_001  Added one sentence on refresh tokens next to the expiry line
- a_003  Shortened the section heading

notes/api.md
- a_002  Selected text not found. Left in the pane.

Run the skill again after you fix the leftover note.
```

All succeeded — lead with that, then the per-id lines, no “run again”.

None succeeded — lead with “Nothing applied. Queue unchanged.” then the failed lines.
