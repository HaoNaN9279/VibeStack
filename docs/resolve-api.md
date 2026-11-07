# Resolve API v2

`vibe-stack resolve --json` 是能力组解析的唯一边界。插件调用它获取注入计划，
不在插件内扫描目录、选择版本或解析 frontmatter。

## 调用

```bash
vibe-stack resolve --json [--mode project|vibestack] [--api-version 1|2] --project <project-dir>
```

- `--repo` 可选，默认按全局配置和环境变量定位仓库。
- `--json` 输出机器可读 JSON；省略时输出摘要。
- `--mode` 默认 `project`：
  - `project`：历史行为；无 `.vibestack/stack.json` 时返回 `active=false`，不加载 Core。
  - `vibestack`：**Core 始终加载**；无 stack 时也返回 `active=true`，只含 Core。
- `--api-version` 默认 `2`；`1` 输出旧形状（无 `mode`，agent/command/skill 不带 `model`），
  用于老插件回退。
- `stdout` 只包含 JSON，UTF-8 编码。
- 命令只读，不创建或修改 `.vibestack/lock.json`。
- 非致命内容问题写入 `warnings`，退出码仍为 `0`。
- 仓库缺失、stack JSON 损坏等致命错误写 `stderr`，退出码为 `1`。

## 响应

```json
{
  "schema_version": 2,
  "active": true,
  "mode": "vibestack",
  "repository": "D:/workspace/work/VibeStack",
  "project": "D:/workspace/project",
  "core": {
    "guid": "32hex",
    "name": "core",
    "version": "0.1.0",
    "description": "core",
    "root": "D:/workspace/work/VibeStack/capability-groups/core/0.1.0",
    "permissions": ["fs"],
    "extends": [],
    "tools": []
  },
  "groups": [],
  "rules": [
    { "name": "global", "path": ".../rules/00-global.md", "group": "core" }
  ],
  "skills": [
    { "name": "caveman", "path": ".../skills/caveman", "group": "core" }
  ],
  "agents": {
    "Athena": {
      "description": "...",
      "mode": "all",
      "system": "...",
      "source": ".../agents/athena.md",
      "group": "core"
    }
  },
  "commands": {
    "auto-git-commit": {
      "description": "...",
      "template": "...",
      "source": ".../commands/auto-git-commit.md",
      "group": "core"
    }
  },
  "mcp": {
    "vibe:core_demo_mcp": { "type": "remote", "url": "..." }
  },
  "warnings": [],
  "fingerprint": "sha256"
}
```

字段：

| 字段 | 说明 |
|---|---|
| `schema_version` | API 版本，当前为 `2` |
| `active` | 计划是否生效；`mode=vibestack` 时始终为 `true` |
| `mode` | `project` 或 `vibestack`；v1 响应视为 `project` |
| `core` | 已解析的 Core 摘要；`project` 模式无 stack 时为 `null` |
| `groups` | 已解析的领域组摘要，按加载顺序 |
| `rules` | 已校验规则路径，按加载顺序追加 |
| `skills` | 已校验技能目录，按加载顺序追加；可带 `model`（层 id） |
| `agents` | 已合并 Agent，同名后加载者覆盖；可带 `model`（层 id） |
| `commands` | 已合并命令，同名后加载者覆盖；可带 `model`（层 id） |
| `mcp` | 已合并 MCP 配置，key 为 `vibe:<group>_<server>` |
| `warnings` | 非致命问题 |
| `fingerprint` | 解析输入内容的 SHA-256，用于诊断和未来缓存 |

路径为绝对路径和正斜杠。`agents`、`commands` 的 key 是名称；正文分别放在
`system`、`template`。`mcp` 已移除 `name` 字段。`rules`、`skills`、`agents`、`commands`
的每一项都带 `group`，它是“Core + 当前工作区并集”的来源标识；DSH 插件用它生成
`vibestack-<group>-<name>` 命名空间，并区分 Core 常驻命令与领域组命令。

`model` 可选，语法为 `^[a-z0-9][a-z0-9_-]*$`、长度 ≤32。resolver 只校验语法，不校验层是否
存在（层属于用户本机配置）；非法值写入 `warnings` 并省略该字段。DSH 插件把 `model` 当作
模型中间层的层 id，在 Agent 选择、命令执行或用户 `/skill` 调用时解析为
provider/model/reasoningEffort。

## 解析规则

加载顺序：

1. Core（`mode=vibestack` 时无条件；`project` 模式仅当 stack 存在）
2. `stack.groups` 数组顺序
3. 每个组的 `extends` 依赖优先
4. 同名组只加载一次

`mode=vibestack` 且项目无 stack 时，使用全局配置的 `core`（默认 `core@0.1.0`）合成一个
空 groups 的 stack；`mode=project` 保持历史行为。

内容校验：

| 类型 | 规则 |
|---|---|
| rules | 递归发现 `rules/**/*.md`；必须有 `name` |
| `model` | Agent / 命令 / 技能可选；层 id 语法与长度校验，非法时告警并省略 |
| agents | 单层 `agents/*.md`；必须有 `name`、`description`、`mode`，`mode` 只能是 `primary`、`subagent`、`all` |
| commands | 单层 `commands/*.md`；必须有 `name`、`description`，`agent` 可选 |
| skills | 目录内必须有 `SKILL.md`；`name` 匹配目录名和 `[a-z0-9]+(-[a-z0-9]+)*`；`description` 1-1024 字符；禁止 `metadata` |
| MCP | 仅处理 `group.tools` 引用的工具包；`mcp.enabled=false` 跳过 |

合并：

- rules、skills 追加并按路径去重。
- agents、commands、mcp 同名后加载者覆盖。
- 不注入 `model`、`temperature`、`permission`。
- 单个文件或工具失败只跳过该项并告警。

## 兼容与失败策略

- API 只做加法扩展；破坏性变更提升 `schema_version`。
- v2 新增 `mode`；v1 响应按 `mode=project` 读取。
- DSH 插件接受 `schema_version` ∈ {1, 2}。v1 没有 `mode`，插件按 `project` 处理，
  因此不会获得“Core 常驻”语义；需要升级 CLI 后重新加载。
- 插件必须校验 `schema_version`，不兼容时只加载默认技能。
- 插件调用失败不得阻断 Agent 启动。
- 插件建议设置超时（默认 5 秒），可通过 `VIBESTACK_RESOLVE_TIMEOUT_MS`
  覆盖。
- CLI 必须已安装并在 `PATH` 中；自定义路径使用 `VIBESTACK_CLI`。

首版不提供磁盘缓存。若冷启动超过 1 秒，再基于 `fingerprint` 评估只读缓存。
