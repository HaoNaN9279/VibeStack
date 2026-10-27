# VibeStack 架构

## 1. 定位

VibeStack 管理面向多种 AI Agent 工具的能力组和工具包。

核心变化：

- 能力组按版本发布，内容只存在仓库中。
- 项目只保存 `.vibestack/stack.json`。
- Agent 插件通过 `vibe-stack resolve --json` 获取统一注入计划。
- 解析、校验、排序和合并只在 Python resolver 中实现一次。
- 工具统一由 `vibe-stack` 入口运行。
- MCP 作为工具包管理，不再有独立 `mcp/` 目录。

## 2. 分层

```text
<project>/.vibestack/stack.json ── 激活顺序
        │
        ▼
vibe-stack resolve --json        ── 统一 resolver
        │
        ├── capability-groups/   ── 规则/Agent/命令/技能
        └── tools/               ── 工具包与 MCP 配置
        │
        ▼
plugins/<agent>/                 ── 只做目标 Agent 映射
        │
        ▼
Agent 运行时配置
```

CLI 管理命令和工具入口仍由 `vibe-stack` 提供。

## 3. 能力组

```text
capability-groups/
├── core/
│   └── <version>/
│       ├── group.json
│       ├── rules/
│       ├── agents/
│       ├── commands/
│       ├── skills/
│       └── references/
└── domain/
    └── <name>/
        └── <version>/
            ├── group.json
            ├── rules/
            ├── agents/
            ├── commands/
            ├── skills/
            └── references/
```

Core 常驻；领域能力组只在 `.vibestack/stack.json` 的 `groups` 中列出时加载。
`load_group` 对 `core` 使用 `capability-groups/core/<version>/`，其余组使用
`capability-groups/domain/<name>/<version>/`。`discover_groups` 同时扫描两者。

`group.json`：

```json
{
  "guid": "32hex",
  "name": "blender",
  "version": "1.0.0",
  "description": "...",
  "permissions": ["fs"],
  "extends": [],
  "tools": ["tool:<guid>@v0.2.1"],
  "tool_permissions": { "tool:<guid>@v0.2.1": ["fs", "exec"] }
}
```

`extends` 形成依赖图。解析时依赖先于依赖者，按组名去重。

## 4. 项目配置

```text
<project>/.vibestack/
├── stack.json
└── lock.json
```

`stack.json` 是唯一激活来源。`lock.json` 是 `sync` 生成的解析快照，供诊断和复现。

无 `stack.json`：

- 不加载 Core
- 不加载任何项目能力组
- 插件仍加载自带的 `vibestack` 指引技能

## 5. 加载算法

解析和注入由 `vibe-stack resolve --json` 完成，插件不重复实现：

```text
1. 读全局配置 ~/.config/vibestack/config.json 定位仓库
2. 读 .vibestack/stack.json
3. 加载 Core
4. 按 groups 顺序加载领域能力组
5. 每个组先递归加载 extends
6. 按组名去重
7. 校验规则、Agent、命令、技能和 MCP
8. 生成与目标 Agent 无关的注入计划
9. 插件把注入计划映射到目标 Agent 配置
```

`resolve` 严格只读，不写 `.vibestack/lock.json`。无 stack 时返回
`active=false`，不加载 Core。缺失能力组或坏文件在 `resolve` 中产生告警并跳过；
`sync` 保持严格校验，缺失组直接报错。

合并规则：

| 类型 | 规则 |
|---|---|
| rules | 追加 |
| skills | 追加路径 |
| agents | 同名覆盖；插件合并时保留用户配置中的 model/permission |
| commands | 同名覆盖 |
| mcp | 同名覆盖 |

## 6. 工具包

```text
tools/<name>/<version>/
├── tool.json
├── pyproject.toml
└── src/
```

`provider`：

- `python`：通过 `uv run --project` 执行
- `mcp`：直接启动 MCP 命令
- `builtin` / `sandbox` / `app`：保留扩展位

工具 ID：

```text
tool:<guid>@v<version>
```

入口：

```bash
vibe-stack tool list
vibe-stack tool run <id>
vibe-stack tool serve <id>
vibe-stack tool exec <id> -- <command>
```

MCP 工具包的 `tool.json` 包含 `mcp` 对象。resolver 读取并生成映射，插件注入：

```text
mcp["vibe:<group>_<server>"]
```

## 7. Agent 插件

```text
plugins/<agent>/
├── plugin.json
├── index.ts
└── skills/
```

`plugin.json`：

```json
{
  "schema_version": 1,
  "name": "opencode",
  "agent": "opencode",
  "version": "0.2.0",
  "entrypoint": "index.ts",
  "install": {
    "kind": "copy",
    "target": "~/.config/opencode/plugins/vibestack.ts",
    "skills_target": "~/.config/opencode/plugins/vibestack-skills"
  },
  "capabilities": ["rules", "agents", "commands", "skills", "mcp", "tools"]
}
```

安装只复制文件。禁止修改 Agent 的主配置文件。

### OpenCode 适配

插件只调用：

```bash
vibe-stack resolve --json --project <project>
```

插件不读取能力组目录、不解析 frontmatter，也不实现版本选择、`extends`、
覆盖顺序或内容校验。解析结果已经包含规则路径、技能路径、Agent/命令定义和
MCP 配置。

插件只负责：

- v1/v2 配置字段映射
- 与目标侧现有配置合并
- 保留用户已有的 `model`、`temperature`、`permission`
- 告警记录和失败开放

| VibeStack 计划 | OpenCode v1 | OpenCode v2 |
|---|---|---|
| rules | `config.instructions` | `config.instructions` |
| skills | `config.skills.paths` | `config.skills` 数组 |
| agents | `config.agent` | `config.agents` |
| commands | `config.command` | `config.commands` |
| mcp | `config.mcp` | `config.mcp` |

失败处理：

- CLI 缺失、超时、非零退出、JSON 或 schema 不合法：只加载插件默认技能并告警。
- `resolve` 已跳过的坏项通过 `warnings` 返回，插件记录后继续启动。
- 插件不得写入项目、能力组、工具包或 Agent 主配置。

详细契约见 `docs/resolve-api.md`。

## 8. 全局配置

```text
~/.config/vibestack/config.json
```

```json
{
  "schema_version": 1,
  "repository": "D:/workspace/work/VibeStack",
  "core": { "name": "core", "version": "0.1.0" }
}
```

该文件只属于 VibeStack，不被 Agent 读取。

## 9. CLI

| 命令 | 作用 |
|---|---|
| `list` | 列出能力组和工具 |
| `status` | 显示项目激活项 |
| `info` | 组详情 |
| `init` | 创建 `stack.json` |
| `activate` | 追加组 |
| `deactivate` | 移除组 |
| `sync` | 严格解析并写 `lock.json` |
| `resolve --json` | 生成只读注入计划，供插件消费 |
| `tool list/run/serve/exec` | 工具入口 |
| `plugin install/status/list` | 适配器安装 |

## 10. 迁移来源

| 内容 | 来源 | 处理 |
|---|---|---|
| core | 旧 `core/` | 迁移为 `core/0.1.0` |
| domain | `capability-groups/domain/` | 领域能力组统一目录，不默认加载 |
| data-forge | GitHub `HaoNaN9279/data_forge` | 重新部署，pin commit |
| markitdown | GitHub `microsoft/markitdown` | 重新部署，pin tag |
| video-transcribe | 本地 | 直接迁移 |

旧 `stacks/` 预设不再保留。
