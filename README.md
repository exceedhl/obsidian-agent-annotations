# Agent Annotations

**English** | [中文](README.zh.md)

Select Markdown text, write Agent instructions, and hand the queue to any Agent via `<vault>/.obsidian/agent-annotations/current.json`. The Agent edits the notes directly. Failed rows stay in the file so you can run again.

Product requirements: [`docs/PRD.md`](docs/PRD.md) ([中文](docs/PRD.zh.md)).

## Install

In Obsidian: **Settings → Community plugins → Browse**, search **Agent Annotations**, install and enable.

Until the listing is live, install from GitHub: download `main.js`, `manifest.json`, and `styles.css` from the latest [Release](https://github.com/exceedhl/obsidian-agent-annotations/releases) into `<vault>/.obsidian/plugins/agent-annotations/`, then enable the plugin.

## Install (development)

Put this repo in the vault plugin folder, or symlink it:

```bash
ln -s ~/code/obsidian-agent-annotations \
  "<vault>/.obsidian/plugins/agent-annotations"
cd ~/code/obsidian-agent-annotations
npm install
npm run build
```

In Obsidian → Settings → Community plugins, turn off Restricted mode and enable **Agent Annotations**.
While coding, run `npm run dev` and install [Hot Reload](https://github.com/pjeby/hot-reload) to skip restarts.

## Usage

1. Select text in a `.md` file, then click `+ Annotation` (or the context menu / command `Add annotation`).
2. Write the change, then **Save** / **Cancel**, or use the card shortcuts (default `Mod+Enter` / `Escape`). Saving turns Review mode on.
3. The card sits below that line and scrolls with the note. Click the card body to edit; `×` deletes it (short Undo).
4. Change card shortcuts in **Settings → Agent Annotations**. Bind `Add annotation` itself in Settings → Hotkeys.
5. `Toggle Review mode` hides every card and highlight. The queue stays in `current.json`.
6. The **Annotations** pane on the right is this round's pending list: click a row to jump, delete one row from the list. The pane menu or a command can clear everything.
7. In your Agent, invoke the `obsidian-agent-annotations` Skill. Do not paste a prompt.

## Skill

Copy `skill/obsidian-agent-annotations/` into the Agent's skills directory, for example:

- Cursor: `~/.cursor/skills/obsidian-agent-annotations/`
- Claude Code: `~/.claude/skills/obsidian-agent-annotations/`

The Skill uses `$VAULT_PATH`, otherwise it walks up from cwd to the first `.obsidian/agent-annotations/current.json`. Run it from a vault workspace. Each row's `file` is relative to the vault root, not the git repo.

Protocol: answer every row; delete an id only after it succeeds; leave failures as-is; if the process crashes before write-back, leave the file untouched. Do not write status or replies into the JSON. In chat, lead with this round's outcome, then list per file what landed or why a row stayed.

## Storage

```text
<vault>/.obsidian/agent-annotations/current.json
```

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

## Commands

| Command | Action |
|---|---|
| Add annotation | Turn the current selection into a draft annotation |
| Toggle Review mode | Show / hide cards and highlights |
| Open annotations pane | Open the right-hand annotation list |
| End session (clear all annotations) | Clear `current.json` |

## Development

```bash
npm test
npm run build
```
