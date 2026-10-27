# Resolve API v1

`vibe-stack resolve --json` 是能力组解析的唯一边界。插件调用它获取注入计划，
不在插件内扫描目录、选择版本或解析 frontmatter。

## 调用

```bash
vibe-stack resolve --json --project <project-dir>
```

- `--repo` 可选，默认按全局配置和环境变量定位仓库。
- `--json` 输出机器可读 JSON；省略时输出摘要。
- `stdout` 只包含 JSON，UTF-8 编码。
- 命令只读，不创建或修改 `.vibestack/lock.json`。
- 无 `.vibestack/stack.json` 时返回 `active=false`，不加载 Core。
- 非致命内容问题写入 `warnings`，退出码仍为 `0`。
- 仓库缺失、stack JSON 损坏等致命错误写 `stderr`，退出码为 `1`。

## 响应

```json
{
  "schema_version": 1,
  "active": true,
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
| `schema_version` | API 版本，当前为 `1` |
| `active` | 是否存在项目 stack |
| `core` | 已解析的 Core 摘要；无 stack 时为 `null` |
| `groups` | 已解析的领域组摘要，按加载顺序 |
| `rules` | 已校验规则路径，按加载顺序追加 |
| `skills` | 已校验技能目录，按加载顺序追加 |
| `agents` | 已合并 Agent，同名后加载者覆盖 |
| `commands` | 已合并命令，同名后加载者覆盖 |
| `mcp` | 已合并 MCP 配置，key 为 `vibe:<group>_<server>` |
| `warnings` | 非致命问题 |
| `fingerprint` | 解析输入内容的 SHA-256，用于诊断和未来缓存 |

路径为绝对路径和正斜杠。`agents`、`commands` 的 key 是名称；正文分别放在
`system`、`template`。`mcp` 已移除 `name` 字段。

## 解析规则

加载顺序：

1. Core
2. `stack.groups` 数组顺序
3. 每个组的 `extends` 依赖优先
4. 同名组只加载一次

内容校验：

| 类型 | 规则 |
|---|---|
| rules | 递归发现 `rules/**/*.md`；必须有 `name` |
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
- 插件必须校验 `schema_version`，不兼容时只加载默认技能。
- 插件调用失败不得阻断 Agent 启动。
- 插件建议设置超时（默认 5 秒），可通过 `VIBESTACK_RESOLVE_TIMEOUT_MS`
  覆盖。
- CLI 必须已安装并在 `PATH` 中；自定义路径使用 `VIBESTACK_CLI`。

首版不提供磁盘缓存。若冷启动超过 1 秒，再基于 `fingerprint` 评估只读缓存。
