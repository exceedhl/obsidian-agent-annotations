# obsidian-agent-annotations

Obsidian 插件：对着 Markdown 全文划选区写「Agent instruction」改稿指令，
存进 `<vault>/.obsidian/agent-annotations/current.json`；随后到任意 Agent
（pi / Claude Code / Codex）里调 Skill 读这份文件，直接改正文。
人不验收，失败条目留在 JSON 里可再跑。

产品需求与协议定义见 forge：
`40_Projects/obsidian-agent-annotations.md`（需求本体、一轮跑完 JSON 的三种结局、Agent Protocol）、
`20_Zettels/research/knowledge/markdown-reader-agent-comment.md`（为什么不复用 Tandem / Skribe）。

## MVP 范围

- 编辑器指令卡片（选区下展开，CodeMirror 6 widget）
- 跨文件 Review Queue 面板（ItemView）
- `current.json` 读写与监视（Skill 改后卡片随之消失）
- Skill 侧协议：全量回应、成功才删、失败留条、不增量状态字段
