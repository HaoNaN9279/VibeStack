# VibeStack 架构

## 1. 定位

VibeStack 管理面向多种 AI Agent 工具的能力组和工具包。

核心变化：

- 能力组按版本发布，内容只存在仓库中。
- 项目只保存 `.vibestack/stack.json`。
- Agent 插件在启动时加载能力组。
- 工具统一由 `vibe-stack` 入口运行。
- MCP 作为工具包管理，不再有独立 `mcp/` 目录。

## 2. 分层

```text
capability-groups/  ── 内容（规则/Agent/命令/技能）
        │
plugins/<agent>/    ── 读取 .vibestack，注入 Agent 配置
        │
<project>/.vibestack/stack.json ── 激活顺序
        │
tools/              ── 可执行工具包（CLI / MCP）
        │
vibe-stack CLI      ── 管理 + 工具入口
```

## 3. 能力组

```text
capability-groups/<name>/<version>/
├── group.json
├── rules/
├── agents/
├── commands/
├── skills/
└── references/
```

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

`extends` 形成依赖图。解析时依赖先于依赖者，按 `guid` 去重。

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

```text
1. 读全局配置 ~/.config/vibestack/config.json 定位仓库
2. 读 .vibestack/stack.json
3. 加载 Core
4. 按 groups 顺序加载
5. 每个组先递归加载 extends
6. 按 guid 去重
7. 注入 Agent 配置
```

合并规则：

| 类型 | 规则 |
|---|---|
| rules | 追加 |
| skills | 追加路径 |
| agents | 同名覆盖，保留用户配置中的 model/permission |
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

MCP 工具包的 `tool.json` 包含 `mcp` 对象。插件读取后注入：

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
  "version": "0.1.0",
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

使用 `config` hook：

- v1：`config.instructions`、`config.agent`、`config.command`、`config.mcp`、`config.skills.paths`
- v2：`config.skills` 数组、`config.agents`、`config.commands`

Agent frontmatter 解析：

- 文件必须以 YAML frontmatter 开头，必须包含 `name`、`description`、`mode`
- `name`、`description`、`mode` 进入配置
- 正文作为 `system`
- 缺少必填字段或 `mode` 非法时跳过该 Agent 并告警
- 忽略 `model`、`temperature`、`permission`

Rule frontmatter 解析：

- 文件必须以 YAML frontmatter 开头，必须包含 `name`
- 文件路径追加到 `config.instructions`
- 缺少 `name` 时跳过该规则并告警

Command frontmatter 解析：

- 文件必须以 YAML frontmatter 开头，必须包含 `name`、`description`；`agent` 可选
- `name`、`description`、`agent` 进入配置
- 正文作为 `template`
- 缺少 `name` 或 `description` 时跳过该命令并告警

Skill frontmatter 解析：

- 每个技能目录必须包含 `SKILL.md`，文件必须以 YAML frontmatter 开头
- 必须包含 `name`、`description`；`license`、`compatibility`、`allowed-tools` 可选
- `name` 必须与目录名一致，并匹配 `[a-z0-9]+(-[a-z0-9]+)*`，长度 1-64
- `description` 长度 1-1024
- 不允许定义 `metadata`
- 有效的技能目录加入 `config.skills.paths`；不合规技能跳过并告警

工具包 MCP 注入 `config.mcp`。

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
| `sync` | 解析并写 `lock.json` |
| `tool list/run/serve/exec` | 工具入口 |
| `plugin install/status/list` | 适配器安装 |

## 10. 迁移来源

| 内容 | 来源 | 处理 |
|---|---|---|
| core | 旧 `core/` | 迁移为 `core/0.1.0` |
| domains | 旧 `domains/` | 每个 domain 一个能力组 |
| data-forge | GitHub `HaoNaN9279/data_forge` | 重新部署，pin commit |
| markitdown | GitHub `microsoft/markitdown` | 重新部署，pin tag |
| video-transcribe | 本地 | 直接迁移 |

旧 `stacks/` 预设不再保留。
