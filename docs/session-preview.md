# 会话内容预览

回答一个问题：**这个工作目录、这个 Agent，会话里到底加载了什么？**

两个入口共用同一份决策逻辑：

- `vibe-stack preview`：命令行列出内容、状态、字节数与摘要。
- DSH 插件的 `▤` 按钮：输入框左下角、Agent 选择器旁，弹窗列出同一份清单，悬停预览图标看全文。

## 1. 顺序即真实加载顺序

段的装配顺序固定为：

```text
persona → skills → commands → mcp → rules → rules-skipped → agents
```

- `persona`：当前人设正文（system prompt 段）。
- `skills` / `commands`：技能与命令目录。
- `mcp`：为当前 Agent 挂载的 MCP 服务。
- `rules`：最后追加的规则消息；内部严格按渲染顺序 `injected → indexed → omitted`。
- `rules-skipped`：当前目录不匹配、根本不会加载的规则，默认折叠。
- `agents`：人设候选，仅界面可见，不进上下文，默认折叠。

`rules` 段与注入共用 `planRules`（Python 侧为 `rules.plan_rules`）这一个决策函数，字节记账、
`always: false` 索引行、预算截断标记都与真实注入逐字节一致。改一处不会出现两套答案。

## 2. 状态符号

| 符号 | 状态 | 含义 |
| --- | --- | --- |
| `+` | injected | 已并入规则消息 |
| `~` | indexed | `always: false`，只贡献一行索引 |
| `!` | omitted | 超预算或正文为空，未注入 |
| `-` | skipped | 当前目录不匹配作用域 |
| `*` | active | 技能 / 命令 / MCP / 人设已生效 |

ASCII 符号是刻意的：Windows 的 GBK 控制台无法输出 `✓` / `○`。

## 3. CLI

```bash
vibe-stack preview [--agent <name>] [--cwd <dir>] [--mode project|vibestack]
                   [--max-rules-bytes <n>] [--json] [--with-text] [--text-bytes <n>]
```

| 参数 | 说明 |
| --- | --- |
| `--agent` | 人设名；缺省取第一个非 subagent。只影响人设与模型层，规则/技能/命令/MCP 由路径决定 |
| `--cwd` | 项目相对路径，缺省项目根；绝对路径会换算成相对路径 |
| `--project` | 项目根，缺省当前目录 |
| `--mode` | `project`（默认，需要 `stack.json`）或 `vibestack`（Core 无条件加载） |
| `--max-rules-bytes` | 规则预算，默认 65536，与插件 `maxRulesBytes` 同义 |
| `--json` | 输出结构化字段，见下 |
| `--with-text` | 内联正文，配合 `--text-bytes` 截断 |

JSON 形状：

```json
{
  "schema_version": 1,
  "project": "<project-root>",
  "cwd": "Assets/Battle",
  "mode": "project",
  "agent": { "name": "BattleDev", "id": "unity/battle/BattleDev", "group": "unity",
             "module": "battle", "model": "strong", "system_path": "<path>", "label": "unity/battle" },
  "model": { "default": "standard", "agent": "strong", "catalog": ["fast", "standard", "strong"] },
  "sections": [{ "kind": "rules", "title": "规则", "collapsed": false, "items": [] }],
  "budget": { "limit": 65536, "used": 4211, "omitted": 0 },
  "warnings": [],
  "fingerprint": "<resolve fingerprint>"
}
```

条目字段：`kind`、`id`、`name`、`group`、`module`、`scope`、`status`、`bytes`、`path`、
`description`、`summary`，以及按需出现的 `host_name`、`current`、`text`、`truncated`。

## 4. DSH 面板

- 位置：`conversation.input.left` 槽，`order: 8`，只在 `agentPreset === 'vibestack'` 时显示。
- 弹窗：`min(940px, 92vw)`、最高 `86vh`；`Esc`、遮罩点击、关闭按钮都能退出；分段可折叠。
- 每次打开或点「刷新」都会重新解析，改完文件立刻能看到新结果。
- 悬停任意条目右侧的预览图标 120ms 后弹出全文浮窗：等宽、`pre-wrap`、可滚动，右侧优先并做边缘翻转；
  离开图标有 180ms 宽限，方便把鼠标移进浮窗。
- 浮窗内可「复制路径」「复制全文」。
- 工作目录取会话自身，不由客户端指定，因此面板与下一步注入不会错位。

两条只读路由（宿主 core 行注册，`cache-control: no-store`）：

```text
GET /api/vibestack/inventory?sessionId=<id>[&agent=<name>]
GET /api/vibestack/inventory/text?sessionId=<id>&kind=<kind>&id=<id>
```

文本路由**不是文件读取器**：它在服务端计划里按 `kind` + `id` 查表，客户端无法探测任意路径；
单条上限 `inventoryTextBytes`（默认 65536）。

配置项：

| 键 | 默认 | 说明 |
| --- | --- | --- |
| `inventory` | `true` | 关闭后不注册路由、不显示按钮 |
| `inventoryTextBytes` | `65536` | 单条预览正文上限 |

## 5. 与 `rules show` 的分工

- `vibe-stack rules show --for <path>`：只看规则，适合精确定位「这条规则为什么没生效」。
- `vibe-stack preview`：看整个会话的加载面，包括预算、技能、命令、MCP 与人设。

两者命中集合必须一致，`tests/test_preview.py` 会断言这一点。
