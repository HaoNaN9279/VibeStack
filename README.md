# VibeStack

面向多种 AI Agent 工具的能力组与工具包仓库。

## 目录结构

```text
VibeStack/
├── capability-groups/
│   ├── core/
│   │   └── <version>/
│   │       ├── group.json
│   │       ├── rules/
│   │       ├── agents/
│   │       ├── commands/
│   │       ├── skills/
│   │       └── references/
│   └── domain/
│       └── <group-name>/
│           └── <version>/
│               ├── group.json
│               ├── rules/
│               ├── agents/
│               ├── commands/
│               ├── skills/
│               └── references/
├── tools/
│   └── <tool-name>/
│       └── <version>/
│           ├── tool.json
│           └── ...
├── plugins/
│   └── <agent-name>/
│       ├── plugin.json
│       └── index.ts
├── src/vibe_stack/
└── tests/
```

## 能力组

Core 使用 `core/<version>/group.json`，领域能力组使用 `domain/<group-name>/<version>/group.json` 定义：

```json
{
  "guid": "32 位小写十六进制 ID",
  "name": "group-name",
  "version": "0.1.0",
  "description": "能力组说明",
  "permissions": ["fs"],
  "extends": [],
  "tools": ["tool:<guid>@v0.1.0"],
  "tool_permissions": {
    "tool:<guid>@v0.1.0": ["fs"]
  }
}
```

- `guid` 在所有版本中保持不变。
- `name`、`version` 必须与目录名一致。
- `extends` 引用其他能力组名称，依赖先加载。
- Core 位于 `capability-groups/core/`，随 `.vibestack/stack.json` 加载。
- 领域能力组位于 `capability-groups/domain/`，只在 `groups` 中列出时加载。
- 内容目录：`rules/`、`agents/`、`commands/`、`skills/`、`references/`。
- 能力组内不放 `mcp/`、`tools/`、`pyproject.toml` 或工具源码。

## 工具包

工具包位于 `tools/<tool-name>/<version>/`，由 `tool.json` 定义：

```json
{
  "schema_version": 1,
  "guid": "32 位小写十六进制 ID",
  "name": "tool-name",
  "tool_name": "tool_name",
  "version": "0.1.0",
  "description": "工具说明",
  "provider": "python",
  "entrypoint": "tool.py:build_tool",
  "permissions": ["fs"],
  "idempotent": true,
  "source": { "type": "local" },
  "run": { "kind": "uv", "command": "tool-name" },
  "mcp": null
}
```

- `provider`：`python`、`mcp`、`builtin`、`sandbox`、`app`。
- `run`：Python 工具通过 `uv` 运行；`serve_command` 用于 MCP。
- `mcp`：MCP 工具包的服务器配置；能力组不直接保存 MCP 文件。
- `source`：本地工具为 `local`；GitHub 工具记录 `url`、`commit`、`tag`。

能力组通过统一工具 ID 引用：

```text
tool:<guid>@v<version>
```

工具统一入口：

```bash
vibe-stack tool list
vibe-stack tool run <tool> -- <args>
vibe-stack tool serve <tool>
vibe-stack tool exec <tool> -- python -m <module>
```

## 安装

```bash
# 1. 全局安装 CLI，供插件和工具调用
uv tool install --from . vibe-stack

# 2. 安装 OpenCode 插件
vibe-stack plugin install opencode

# 3. 在项目中初始化并激活能力组
cd my-project
vibe-stack init
vibe-stack activate data-forge blender

# 4. 重启 OpenCode
```

插件运行依赖 PATH 中的 `vibe-stack`。升级本仓库后需重新执行
`uv tool install --from . vibe-stack` 和 `vibe-stack plugin install opencode`。

`plugin install` 只写 `~/.config/vibestack/config.json` 和
`~/.config/opencode/plugins/`，不修改 `opencode.json`。

## 项目部署

项目不再复制或链接内容到 `.opencode/`。激活能力组只写项目配置：

```text
<project>/.vibestack/
├── stack.json       # 激活顺序，手写或 CLI 维护
└── lock.json        # sync 生成的解析结果
```

`stack.json`：

```json
{
  "schema_version": 1,
  "core": { "name": "core", "version": "0.1.0" },
  "agents": ["opencode"],
  "groups": [
    { "name": "data-forge", "version": "1.0.0" },
    { "name": "blender", "version": "1.0.0" }
  ]
}
```

加载顺序：

1. Core 能力组
2. `groups` 数组顺序
3. `extends` 依赖先于依赖者
4. 同名 Agent / 命令 / MCP 后加载者覆盖

项目没有 `.vibestack/stack.json` 时，Core 不加载。领域能力组不默认加载，必须加入 `groups`。

## Agent 插件

插件统一放在 `plugins/<agent>/`：

```text
plugins/opencode/
├── plugin.json
├── index.ts
└── skills/vibestack/SKILL.md
```

OpenCode 插件启动时调用：

```bash
vibe-stack resolve --json --project <project>
```

插件只把解析计划映射到 `config` hook，不自行扫描能力组、选择版本或解析
frontmatter。`vibe-stack` 必须已安装并在 `PATH` 中。

| 解析计划 | OpenCode v1 | OpenCode v2 |
|---|---|---|
| `rules` | `instructions` | `instructions` |
| `agents` | `agent` | `agents` |
| `commands` | `command` | `commands` |
| `skills` | `skills.paths` | `skills` 数组 |
| `mcp` | `mcp` | `mcp` |

插件默认加载 `vibestack` 技能，指导 Agent 使用本仓库。解析契约见
[`docs/resolve-api.md`](docs/resolve-api.md)。

安装：

```bash
vibe-stack plugin install opencode
```

插件复制到 `~/.config/opencode/plugins/`，不修改 `opencode.json`。

## CLI

```bash
vibe-stack list
vibe-stack status
vibe-stack info <group>
vibe-stack init
vibe-stack activate <group>[@version]
vibe-stack deactivate <group>
vibe-stack sync
vibe-stack resolve --json
vibe-stack tool list
vibe-stack tool run <tool> -- <args>
vibe-stack tool serve <tool>
vibe-stack tool exec <tool> -- <command>
vibe-stack plugin install opencode
vibe-stack plugin status opencode
```

## 版本规则

- 已发布版本目录不可修改。
- 升级能力组或工具时新增版本目录。
- `guid` 不随版本变化。

## 开发

```bash
uv sync
uv run pytest -q
cd plugins/opencode && bun test
```

## 许可证

MIT
