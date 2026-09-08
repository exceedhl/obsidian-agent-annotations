# PRD：Agent Annotations

[English](PRD.md) | **中文**

在 Obsidian 里对着 Markdown 划选区写批注，写入 `current.json`，由 Agent Skill 直接改正文。人不验收；失败条目留在队列里可再跑。

- 状态：v1.0（已实现 MVP）

---

## 1. 背景与问题

人在 Obsidian 里通读 Markdown 全文时，会产生零散的改写意见（「这段换个说法」「这里举个例子」）。现状的断点：

1. 意见没有地方放：写进正文会污染文档；记在脑子里会丢。
2. 交接靠 Copy：把意见一条条复制给 Agent，多文件时不可行。
3. 现成工具方向不同：Tandem / Skribe 是「Agent 写 suggestion、人再 Accept」的协作审稿，作者是另一个参与者；这里要的是「Agent 直接改正文，人不验收」。

## 2. 目标与非目标

### 目标

| # | 目标 | 衡量 |
|---|---|---|
| G1 | 边读边写改稿指令，不打断阅读流 | 选中 → `+ Agent instruction` → `⌘↵` 保存，三步以内 |
| G2 | 多文件一轮批注，一次交给 Agent | 任意 Agent 调一次 Skill 处理全部待处理条目 |
| G3 | 交接零复制 | Agent 只读固定路径 `current.json`，不需要 prompt 文本 |
| G4 | 结果可信收尾 | 全成功才清空；任何失败/崩溃都残留可续跑的批注 |

### 非目标（本期不做）

- 协作评论的一切：作者、状态、thread、时间线、resolve。
- 人验收环节（Accept/Reject suggestion）。
- Agent 回写讨论、往 JSON 写 status / 回复 / completed 字段。
- 专用 CLI、session daemon、跑批锁（用 Skill 纪律代替，见 §8）。
- 把 Agent 嵌进 Obsidian。

## 3. 用户与场景

单一用户：vault 作者本人，同时也是 Agent 的操作者。

核心场景：人在 Obsidian 读完一组文档并打上若干条改稿指令 → 切到 Agent（Cursor / Claude Code / Codex）调 Skill → Agent 逐条改正文并汇报 → 卡片自动消失（全部成功）或留下没做成的（部分成功）。

## 4. 核心流程

```text
人在 Obsidian 读 Markdown 全文
  → 划线写下怎么改（current.json，不进正文）
  → 在 Agent 里调用 Skill（不必复制 prompt）
  → Skill 读 current.json，必须对每一条都回应，直接改 .md
  → 全部成功：清空 current.json，卡片消失
  → 失败 / 崩溃 / 有一条没做成：失败的批注留在文件里，可再跑 Skill
```

## 5. 功能需求

### FR-1 编辑器指令卡片

- 选中正文 → 出现 `+ Agent instruction` 入口（选区浮层或右键菜单，二选一，实现选开发成本低者）→ 选区末尾下方插入输入卡。
- `⌘↵` 保存、`Esc` 取消。保存后选区保持淡高亮，卡片持久展开。
- 卡片标题固定为 **Agent instruction** + 序号；内容只显示指令文本 + `Edit` / `×`。
- 点卡片正文进入编辑；`×` 立即删除，不二次确认，给短 Undo toast（3–5s）。
- 同一段落多条指令：卡片在选区下按创建顺序叠放。
- 指令文本**不写入 `.md` 正文**；平时编辑（Review mode 关闭时）无任何视觉残留。

CM6 实现要点：选区末尾 `Decoration.widget`（`block: true`, `side: 1`）插卡片；`from→to` 用 `mark` 做高亮；正文本地编辑时 `decorationSet.map(update.changes)` 跟随位移。

### FR-2 Review Mode

| 状态 | 行为 |
|---|---|
| 开 | 显示全部展开卡片、选区高亮、新建入口 |
| 关 | 卡片与高亮全部隐藏，`current.json` 队列不动 |
| 再打开 | 从 `current.json` 重新渲染 |
| End session | 人主动清空 `current.json`（放弃队列） |

Review mode 默认关闭；是否「新建批注强制开 Review mode」见 §10 Open Questions。

### FR-3 Review Queue 面板

Obsidian ItemView，标题 **Agent Annotations**。这是本轮待处理清单，不是历史记录。

| 操作 | 行为 |
|---|---|
| 点文件名 | 打开该 `.md`，滚到第一条批注 |
| 点批注 | 打开文件、定位选区、短闪高亮 |
| Edit / Delete | 处理前改或删这一条 |
| Clear file | 清掉该文件全部未处理批注 |
| Clear all / End session | 清空 `current.json` |

有批注的文件顶部显示计数，如 `Agent annotations · 3`；无批注文件无额外 UI。

### FR-4 `current.json` 存储

唯一共享文件，路径固定：

```text
<vault>/.obsidian/agent-annotations/current.json
```

- 人写时插件写；Skill 读并写回。不拆 queue / 冻结稿两份文件。
- JSON 扁平，每条自带 `file`。
- 文件形状**永远是「待处理指令列表」**：禁止增加 status、回复、completed 字段。
- 文件不存在 = 无待处理批注；空 `annotations` 数组等价。

### FR-5 文件监视与卡片生命周期

- 插件监视 `current.json`：Skill 写回（删条目或清空）后，对应卡片与 highlight 自动消失，无需人刷新。
- `.md` 文件重命名/移动：尽力更新 `file` 字段；失败则条目保留，由 Skill 侧报「定位失败」。
- 正文本地改动导致 `selectedText` 失配：插件不主动清理，留给 Skill 按「没做成」处理。

### FR-6 Agent Skill 协议（交付物之一）

仓库内提供可安装的 SKILL.md，约定：

1. 读 `.obsidian/agent-annotations/current.json`；不存在或列表空 → 报告没有待处理评论。
2. 记下本轮**全部** id，必须逐条回应，不许只处理一部分就当完成。
3. 按文件分组，用 `selectedText` / `headingPath` / `prefix` / `suffix` 定位，做最小修改。
4. 重叠或同 heading 的指令合成一次连贯编辑，输出仍按 id 逐条交代。
5. 不改 instruction 文本，不写回复进 JSON。
6. 写回：删掉已成功 id；没做成的留下；启动后一条未做成即中止 → 文件原样不动；全部成功 → 清空或删文件。
7. 终端输出：每个 id 都要出现（做成了什么 / 为什么没做成）。

## 6. 数据规格

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

| 字段 | 必填 | 说明 |
|---|---|---|
| `version` | 是 | 固定 `1`，schema 演进时递增 |
| `id` | 是 | 插件生成，如 `a_` + 短随机；一轮内唯一 |
| `file` | 是 | vault 相对路径（POSIX 分隔符） |
| `instruction` | 是 | 人的指令原文；Agent 不得修改 |
| `selectedText` | 是 | 选区原文，首要定位锚 |
| `headingPath` | 建议 | 所在标题链，从 H1 到最近标题 |
| `prefix` / `suffix` | 建议 | 选区前后各约 40 字，辅助消歧 |

写回纪律（三种结局，实现与测试都要覆盖）：

1. 全成功 → `annotations` 为空数组，或删除整个文件。
2. 部分成功 → 只保留失败 id，原文不动。
3. 崩溃 / 无写回 → 文件与跑前**字节级一致**；重跑时旧 `selectedText` 可能对不上，对不上按「没做成」走结局 2。

## 7. 边界与异常

| 场景 | 行为 |
|---|---|
| 同一 `selectedText` 在文件中出现多次 | 用 `headingPath` + `prefix/suffix` 消歧；仍歧义则 Skill 报「没做成」，条目留下 |
| 跑 Skill 期间人又加了新评论 | MVP 用纪律约束（不加）；不实现锁，见 §8 |
| 两台 Agent 同时读 | 同上，本期不防 |
| `.md` 被外部删除 | 插件标该文件条目为不可定位；Skill 报「没做成」，条目留下 |
| JSON 损坏（人手改坏） | 插件解析失败时显示队列面板错误态，不自动修复、不覆盖原文件 |
| 指令跨段落/跨标题 | MVP 允许选中任意选区，不特殊处理；见 §10 |

## 8. 并发与锁（明确降级）

「正在跑、禁止再划线」的文件锁、防双 Agent 读取，依赖专用 CLI 才做。**本期只用 Skill 纪律**，风险接受：偶发冲突靠 JSON 结局 3 的字节级不变性兜底，最坏是重跑一轮。

## 9. 非功能需求

- 离线纯本地：无任何网络请求；JSON 是唯一存储。
- 隐私：`current.json` 不出 vault；Skill 侧 Agent 的网络行为由用户自选 Agent 决定，插件不介入。
- 性能：单文件 100+ 卡片时编辑器滚动不卡顿（decoration 依赖 CM6 原生 viewport 裁剪）；队列面板千条以内即时渲染。
- 兼容性底线为 Obsidian 1.5.0（`minAppVersion`），以保证 CM6 API 可用。

## 10. Open Questions

1. Review mode 关着时，新建批注是否强制先打开 Review mode？（倾向：不强制，保存即开。）
2. 是否允许一条指令跨多个段落/标题？（倾向：允许，schema 不约束。）
3. 与 Tandem / Document Comments 共存时的快捷键、视觉冲突怎么避让？（倾向：本插件卡片左侧边线 + 淡底，与主题 accent 走。）

## 11. 验收标准

按 G1–G4 各出一条可执行验收：

1. **G1**：在任意 `.md` 选中一段文字，三步内保存一条指令；卡片刻即展开显示，正文文件字节不变。
2. **G2**：在 3 个文件各打 ≥2 条，面板显示总数正确；调一次 Skill 后全部条目被处理并逐条汇报。
3. **G3**：全程不向 Agent 粘贴任何 prompt 文本，仅调用 Skill。
4. **G4a**：Skill 汇报全成功后，`current.json` 为空或不存在，所有卡片消失。
   **G4b**：人为构造一条无法定位的指令，Skill 跑完后该条仍在 JSON 与编辑器中，成功条目已消失。
   **G4c**：Skill 进程在写回前被 kill，`current.json` 与跑前 diff 为空。

## 12. 里程碑拆解

| 里程碑 | 内容 | 退出标准 |
|---|---|---|
| M1 编辑器卡片 | FR-1 + FR-2 + FR-4 的写入侧 | 能划线、存 JSON、开关 Review mode |
| M2 队列面板 | FR-3 + FR-5 的监视 | 面板操作齐全，JSON 外部变更后 UI 同步 |
| M3 Skill 闭环 | FR-6 + §6 三种结局 | G2–G4 验收通过 |
| M4 打磨 | Undo toast、计数徽标、异常态 UI、主题适配 | §9 性能项过检 |
