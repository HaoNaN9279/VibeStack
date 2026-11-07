# VibeStack

面向 AI Agent 工具的能力组与工具包仓库。当前 Agent 适配器是
[DeepSeek Harness](plugins/dsh/README.md)。

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
│   └── dsh/
│       ├── plugin.json
│       ├── package.json
│       ├── cordis.patch.yml
│       ├── index.js
│       ├── client.js
│       └── skills/
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
- Core 位于 `capability-groups/core/`：`project` 模式下随 `.vibestack/stack.json` 加载；
  DSH 的 `vibestack` 模式下无条件加载。
- 领域能力组位于 `capability-groups/domain/`，只在 `groups` 中列出时加载。
- 内容目录：`rules/`、`agents/`、`commands/`、`skills/`、`references/`。
- 能力组内不放 `mcp/`、`tools/`、`pyproject.toml` 或工具源码。

能力组开发由领域组 `group-forge` 提供；在 VibeStack 仓库根目录的
`.vibestack/stack.json` 中已激活它。详见
[`group-forge`](capability-groups/domain/group-forge/0.1.0/group.json)。

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
# 1. 全局安装 CLI，供 DSH 插件和工具调用
uv tool install --from . vibe-stack

# 2. 把 DSH 适配器装进当前 profile（本地 link: 安装）
dsh plugin --profile desktop add "D:/workspace/VibeStack/plugins/dsh"

# 3. 在项目中初始化并激活能力组
cd my-project
vibe-stack init
vibe-stack activate data-forge blender

# 4. 重启 DeepSeek Harness
```

DSH 适配器只读写自己的运行态，不复制文件到 Agent 私有目录。插件源码在
`plugins/dsh/`，本地 `link:` 安装后修改源码只需重启 DSH；升级本仓库后重新执行
`uv tool install --from . vibe-stack` 即可更新 CLI。

安装与卸载细节见 [`plugins/dsh/README.md`](plugins/dsh/README.md)。

## 项目部署

项目只写 `.vibestack/`，不复制或链接内容到 `.dsh/` 等 Agent 私有目录：

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
  "groups": [
    { "name": "data-forge", "version": "1.0.0" },
    { "name": "blender", "version": "1.0.0" }
  ]
}
```

`agents` 字段已废弃；resolver 继续接受但忽略，下一版 stack schema 再删除。

加载顺序：

1. Core 能力组
2. `groups` 数组顺序
3. `extends` 依赖先于依赖者
4. 同名 Agent / 命令 / MCP 后加载者覆盖

`vibe-stack resolve` 默认是 `project` 模式：项目没有 `.vibestack/stack.json` 时 Core 不加载。
DeepSeek Harness 的 VibeStack 模式使用 `--mode vibestack`：**Core 无条件加载**，领域能力组
仍必须加入 `groups`；会话的 Agent / 命令 / 技能是 Core + 当前工作区并集。

领域能力组不默认加载，必须加入 `groups`。

## Agent 插件

DSH 适配器在 `plugins/dsh/`：

```text
plugins/dsh/
├── plugin.json          # 适配器清单
├── package.json         # DSH bundle patch + client
├── cordis.patch.yml     # 只 insert：UI 行 + `preset-vibestack` 模式
├── index.js             # 宿主半
├── client.js            # 浏览器半（Agent 菜单）
├── lib/                 # resolve / 规则 / 技能 / 命令 / 投影 / MCP
└── skills/vibestack/    # 插件自带技能
```

插件启动时调用：

```bash
vibe-stack resolve --json --mode vibestack --project <project>
```

插件只消费解析计划，把规则、技能、命令、MCP 与 Agent 人设映射到 DSH 会话；不自行扫描
能力组、选择版本或解析 frontmatter。`vibe-stack` 必须已安装并在 `PATH` 中。

| 解析计划 | DSH 机制 |
|---|---|
| `rules` | `agent/pre-step` 注入持久 `<system-reminder>` 消息 |
| `skills` | `ctx.skills.registerProvider('vibestack')`，名称 `vibestack-<group>-<name>` |
| `agents` | 会话投影 + 左下角 Agent 菜单；人设段落 |
| `commands` | `ctx.commands.register()`，模板渲染后 `followup()` |
| `mcp` | 按工具包挂载 `@deepseek-ai/dsh-mcp-client` 子插件 |

解析契约见 [`docs/resolve-api.md`](docs/resolve-api.md)，插件细节见
[`plugins/dsh/README.md`](plugins/dsh/README.md)。

安装：

```bash
dsh plugin --profile desktop add "D:/workspace/VibeStack/plugins/dsh"
vibe-stack plugin list
vibe-stack plugin status dsh
```

`vibe-stack plugin install` 已退场：DSH 自己负责安装，CLI 只做适配器自省。

### 模型层

能力组只写 `model: <layer>`；层的 provider/model/reasoningEffort 保存在
`~/.config/vibestack/config.json` 的 `models` 段，由 DSH 插件读取。设置页
「VibeStack 模型层」可增删改层；输入框右下角的模型位切换当前会话的层，左下角保持
Agent 选择。未配置层时使用内置 `flash`（`deepseek-account/deepseek-flash`）。
详见 [`plugins/dsh/README.md`](plugins/dsh/README.md#模型层)。

## CLI

```bash
vibe-stack list
vibe-stack status
vibe-stack info <group>
vibe-stack init
vibe-stack activate <group>[@version]
vibe-stack deactivate <group>
vibe-stack sync
vibe-stack resolve --json [--mode project|vibestack]
vibe-stack tool list
vibe-stack tool run <tool> -- <args>
vibe-stack tool serve <tool>
vibe-stack tool exec <tool> -- <command>
vibe-stack plugin list
vibe-stack plugin status <agent>
```

## 版本规则

- 已发布版本目录不可修改。
- 升级能力组或工具时新增版本目录。
- `guid` 不随版本变化。

## 开发

```bash
uv sync
uv run pytest -q
node plugins/dsh/test/agents.test.js
node plugins/dsh/test/plugin.test.js
# DSH 其余测试文件逐个运行，见 plugins/dsh/README.md
```

## 许可证

MIT
