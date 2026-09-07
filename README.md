# obsidian-agent-annotations

Obsidian 插件：对着 Markdown 全文划选区写批注（Annotation），
存进 `<vault>/.obsidian/agent-annotations/current.json`；随后到任意 Agent
（pi / Claude Code / Codex）里调 Skill 读这份文件，直接改正文。
人不验收，失败条目留在 JSON 里可再跑。

产品需求见 `docs/PRD.md`。

## 安装（开发）

把本仓放到 vault 的插件目录，或做软链：

```bash
ln -s ~/code/obsidian-agent-annotations \
  "<vault>/.obsidian/plugins/agent-annotations"
cd ~/code/obsidian-agent-annotations
npm install
npm run build
```

在 Obsidian → Settings → Community plugins 关闭 Safe mode，启用 **Agent Annotations**。
改代码时用 `npm run dev`，再装 [Hot Reload](https://github.com/pjeby/hot-reload) 可免重启。

## 用法

1. 在 `.md` 里划一段文字，点 `+ Annotation`（或右键菜单 / 命令 `Add annotation`）。
2. 写下怎么改，点 **Save** / **Cancel**，或用卡片快捷键（默认 `Mod+Enter` / `Escape`）。保存会打开 Review mode。
3. 卡片插在该行下方、跟着正文滚动；点正文编辑，`×` 删除（有短 Undo）。
4. 卡片快捷键在 **Settings → Agent Annotations** 里改。`Add annotation` 本身可在 Settings → Hotkeys 绑定。
5. 命令 `Toggle Review mode` 可隐藏全部卡片与高亮，队列仍在 `current.json`。
6. 右侧 **Annotations** 面板是本轮待处理清单：点行跳转，行上删除单条。面板菜单或命令可清空全部。
7. 到 Agent 里调用 `obsidian-agent-annotations` Skill（不要粘贴 prompt）。

## Skill

把 `skill/obsidian-agent-annotations/` 拷进所用 Agent 的 skills 目录，例如：

- Cursor：`~/.cursor/skills/obsidian-agent-annotations/`
- Claude Code：`~/.claude/skills/obsidian-agent-annotations/`

Skill 用 `$VAULT_PATH`，否则从 cwd 向上找到第一份 `.obsidian/agent-annotations/current.json`。在 vault 工作区里调用即可。行内 `file` 是相对 vault 根目录，不是相对仓库。

协议要点：必须逐条回应；成功才删 id；失败留原文；写回前崩溃则文件不动。禁止往 JSON 写 status / 回复。对话里先说这一轮结果，再按文件列出每条做成了什么或为什么留下。

## 存储

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
      "instruction": "解释 refresh token。",
      "selectedText": "Token 会在 24 小时后过期。",
      "headingPath": ["认证", "令牌生命周期"],
      "prefix": "…上文 40 字…",
      "suffix": "…下文 40 字…"
    }
  ]
}
```

## 命令

| 命令 | 作用 |
|---|---|
| Add annotation | 把当前选区变成一条批注草稿 |
| Toggle Review mode | 显示 / 隐藏卡片与高亮 |
| Open annotations pane | 打开右侧批注列表 |
| End session (clear all annotations) | 清空 `current.json` |

## 开发

```bash
npm test
npm run build
```
