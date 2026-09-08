# PRD: Agent Annotations

**English** | [中文](PRD.zh.md)

Select Markdown in Obsidian, write annotations into `current.json`, and let an Agent Skill edit the notes directly. The human does not accept or reject patches. Failed rows stay in the queue so you can run again.

- Status: v1.0 (MVP shipped)

---

## 1. Background

While reading Markdown in Obsidian, you get scattered rewrite notes (“say this differently”, “add an example”). Today that breaks in three places:

1. Nowhere to put the note: writing it into the body pollutes the document; keeping it in your head loses it.
2. Handoff is copy-paste: sending comments one by one does not scale across files.
3. Existing tools go the other way: Tandem / Skribe have the Agent write a suggestion and a human Accept it. Here the Agent edits the body; the human does not review.

## 2. Goals and non-goals

### Goals

| # | Goal | Measure |
|---|---|---|
| G1 | Write edit instructions while reading, without breaking flow | Select → `+ Agent instruction` → `⌘↵` to save, in three steps |
| G2 | Annotate many files in one round, hand off once | Any Agent runs the Skill once and processes every pending row |
| G3 | Zero-copy handoff | The Agent only reads the fixed path `current.json`; no prompt text |
| G4 | Trustworthy close-out | Clear only when everything succeeds; any failure or crash leaves rerunnable annotations |

### Non-goals (this release)

- Collaboration comments: author, status, thread, timeline, resolve.
- Human review (Accept / Reject suggestion).
- The Agent writing discussion, status, replies, or completed fields into the JSON.
- A dedicated CLI, session daemon, or batch lock (Skill discipline instead; see §8).
- Embedding an Agent inside Obsidian.

## 3. User and scenario

One user: the vault author, who also runs the Agent.

Core path: the person reads a set of notes in Obsidian and writes several edit instructions → switches to an Agent (Cursor / Claude Code / Codex) and invokes the Skill → the Agent edits each note and reports → cards disappear (all succeeded) or leftovers remain (partial success).

## 4. Core flow

```text
Person reads Markdown in Obsidian
  → selects text and writes how to change it (current.json, not the note body)
  → invokes the Skill in an Agent (no prompt paste)
  → Skill reads current.json, must answer every row, edits the .md files
  → all succeeded: current.json is emptied, cards disappear
  → failure / crash / one row unfinished: failed annotations stay, Skill can run again
```

## 5. Requirements

### FR-1 Editor instruction cards

- Select body text → `+ Agent instruction` (selection toolbar or context menu) → insert an input card below the end of the selection.
- `⌘↵` saves, `Esc` cancels. After save, the span stays lightly highlighted and the card stays open.
- Card title is **Agent instruction** plus an index; body shows only the instruction plus `Edit` / `×`.
- Click the card body to edit; `×` deletes immediately, no confirm, with a short Undo toast (3–5s).
- Several instructions on one paragraph: cards stack under the selection in creation order.
- Instruction text is **not** written into the `.md` body. With Review mode off, editing has no leftover chrome.

CM6 notes: a `Decoration.widget` (`block: true`, `side: 1`) at the end of the selection; a `mark` on `from→to` for highlight; map decorations through `decorationSet.map(update.changes)` when the body edits.

### FR-2 Review Mode

| State | Behavior |
|---|---|
| On | Show every open card, highlights, and the new-annotation entry |
| Off | Hide cards and highlights; `current.json` is unchanged |
| On again | Re-render from `current.json` |
| End session | Person clears `current.json` (abandons the queue) |

Review mode is off by default. Whether creating an annotation forces it on is in §10.

### FR-3 Review Queue pane

Obsidian ItemView titled **Agent Annotations**. This is the pending list for this round, not history.

| Action | Behavior |
|---|---|
| Click a file name | Open that `.md` and scroll to the first annotation |
| Click an annotation | Open the file, locate the span, flash highlight |
| Edit / Delete | Change or drop a row before the Agent runs |
| Clear file | Drop every pending annotation on that file |
| Clear all / End session | Clear `current.json` |

Files with annotations show a count at the top, such as `Agent annotations · 3`. Files with none get no extra UI.

### FR-4 `current.json` storage

One shared file, fixed path:

```text
<vault>/.obsidian/agent-annotations/current.json
```

- The plugin writes when the person saves; the Skill reads and writes back. Do not split queue vs frozen copies.
- Flat JSON; each row carries its own `file`.
- The file shape is **always a pending-instruction list**. Do not add status, reply, or completed fields.
- Missing file = no pending annotations; an empty `annotations` array is the same.

### FR-5 File watch and card lifetime

- The plugin watches `current.json`. After the Skill writes back (deletes rows or clears the file), the matching cards and highlights disappear without a manual refresh.
- On `.md` rename/move: update `file` when possible; on failure keep the row so the Skill can report a locate miss.
- If a local edit makes `selectedText` miss: the plugin does not clean it up; the Skill treats it as unfinished.

### FR-6 Agent Skill protocol (a deliverable)

Ship an installable SKILL.md that requires:

1. Read `.obsidian/agent-annotations/current.json`. Missing or empty → report nothing pending.
2. Snapshot **every** id this round. Answer every row. Finishing a subset is a protocol failure.
3. Group by file. Locate with `selectedText` / `headingPath` / `prefix` / `suffix`. Make the smallest edit.
4. Overlapping or same-heading instructions become one coherent edit; the report is still one line per id.
5. Do not change `instruction` text. Do not write replies into the JSON.
6. Write-back: drop successful ids; keep failures; if nothing finished after start, leave the file untouched; if everything succeeded, empty or delete the file.
7. Terminal / chat output: every id appears (what changed, or why it did not).

## 6. Data spec

```json
{
  "version": 1,
  "annotations": [
    {
      "id": "a_001",
      "file": "docs/auth.md",
      "instruction": "Explain refresh tokens.",
      "selectedText": "The token expires after 24 hours.",
      "headingPath": ["Auth", "Token lifetime"],
      "prefix": "…about 40 characters before…",
      "suffix": "…about 40 characters after…"
    }
  ]
}
```

| Field | Required | Notes |
|---|---|---|
| `version` | yes | Always `1`; increment when the schema changes |
| `id` | yes | Plugin-generated, e.g. `a_` + short random; unique in the round |
| `file` | yes | Path relative to the vault (POSIX separators) |
| `instruction` | yes | The person's original instruction; the Agent must not edit it |
| `selectedText` | yes | Selected source text; primary locate anchor |
| `headingPath` | recommended | Heading chain from H1 to the nearest heading |
| `prefix` / `suffix` | recommended | About 40 characters on each side, for disambiguation |

Write-back outcomes (all three must be implemented and tested):

1. All succeeded → `annotations` is `[]`, or the file is deleted.
2. Partial success → keep only failed ids, byte-identical to the snapshot rows.
3. Crash / no write-back → the file is **byte-identical** to before the run. On rerun, a drifted `selectedText` is treated as unfinished (outcome 2).

## 7. Edges and errors

| Case | Behavior |
|---|---|
| Same `selectedText` appears more than once | Disambiguate with `headingPath` + `prefix`/`suffix`; if still tied, Skill reports unfinished and keeps the row |
| Person adds comments while the Skill runs | MVP: discipline only (do not add); no lock, see §8 |
| Two Agents read at once | Same; out of scope |
| `.md` deleted externally | Plugin marks the row unlocatable; Skill reports unfinished and keeps it |
| JSON corrupted (hand-edited) | Plugin shows an error in the pane; do not auto-repair or overwrite |
| Instruction spans paragraphs / headings | MVP allows any selection; see §10 |

## 8. Concurrency and locks (explicit downgrade)

File locks (“Skill is running, no more annotations”) and two-Agent protection need a dedicated CLI. **This release uses Skill discipline only.** Occasional conflicts fall back to outcome 3 (byte-identical file). Worst case: run the Skill again.

## 9. Non-functional

- Offline, local only: no network; JSON is the only store.
- Privacy: `current.json` stays in the vault. What the Agent does on the network is the user's Agent choice; the plugin does not participate.
- Performance: 100+ cards in one file should scroll smoothly (CM6 viewport culling); the pane should render instantly up to about a thousand rows.
- Compatibility floor is Obsidian 1.5.0 (`minAppVersion`), for CM6 APIs.

## 10. Open questions

1. If Review mode is off, does creating an annotation force it on? (Lean: do not force; saving turns it on.)
2. May one instruction span several paragraphs or headings? (Lean: yes; schema does not constrain it.)
3. How to avoid shortcut and visual clashes with Tandem / Document Comments? (Lean: left rule + light wash on this plugin's cards, following the theme accent.)

## 11. Acceptance

One executable check per G1–G4:

1. **G1**: In any `.md`, save an instruction in three steps; the card opens immediately; the note file bytes do not change.
2. **G2**: Put ≥2 annotations in each of 3 files; the pane total is correct; one Skill run processes every row and reports each id.
3. **G3**: Never paste prompt text into the Agent; only invoke the Skill.
4. **G4a**: After the Skill reports all-success, `current.json` is empty or gone and every card disappears.
   **G4b**: Plant one unlocatable instruction; after the Skill run that row is still in the JSON and the editor; successful rows are gone.
   **G4c**: Kill the Skill process before write-back; `current.json` diffs empty against the pre-run file.

## 12. Milestones

| Milestone | Scope | Exit |
|---|---|---|
| M1 Editor cards | FR-1 + FR-2 + write side of FR-4 | Select, save JSON, toggle Review mode |
| M2 Queue pane | FR-3 + watch side of FR-5 | Pane actions complete; UI tracks external JSON changes |
| M3 Skill loop | FR-6 + the three §6 outcomes | G2–G4 pass |
| M4 Polish | Undo toast, count badge, error UI, theme | §9 performance checks pass |
