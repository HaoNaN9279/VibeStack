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

无 `stack.json` 时按 resolve 模式区分：

- `project` 模式（默认）：不加载 Core，不加载任何项目能力组，插件仍加载自带的
  `vibestack` 指引技能。
- `vibestack` 模式（DeepSeek Harness 的 VibeStack 会话）：**Core 无条件加载**，
  领域能力组仍为空；插件把 Core 的规则、Agent、命令、技能与 MCP 注入会话。

## 5. 加载算法

解析和注入由 `vibe-stack resolve --json [--mode project|vibestack]` 完成，插件不重复实现：

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

`resolve` 严格只读，不写 `.vibestack/lock.json`。`project` 模式无 stack 时返回
`active=false`，不加载 Core；`vibestack` 模式无 stack 时返回 `active=true`，只含 Core。
缺失能力组或坏文件在 `resolve` 中产生告警并跳过；`sync` 保持严格校验，缺失组直接报错。

DSH 适配器把能力组命令/技能映射为 `vibestack-<group>-<name>`，会话的 Agent / 命令 /
技能列表始终是 Core + 当前工作区并集；子 Agent 会话沿用同一份计划。详见
[`dsh-plugin-plan.md`](dsh-plugin-plan.md) 的 R7–R10。

合并规则：

| 类型 | 规则 |
|---|---|
| rules | 追加 |
| skills | 追加路径 |
| agents | 同名覆盖；插件按层 id 应用模型，保留宿主侧其它配置 |
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

当前唯一适配器是 DeepSeek Harness：

```text
plugins/dsh/
├── plugin.json          # 适配器清单（无复制式 install 字段）
├── package.json         # DSH bundle patch + client
├── cordis.patch.yml     # 只 insert：UI 行 + preset-vibestack
├── index.js             # 宿主半
├── client.js            # 浏览器半
├── lib/                 # resolve / 规则 / 技能 / 命令 / 投影 / MCP
└── skills/vibestack/    # 插件自带技能
```

`plugin.json`：

```json
{
  "schema_version": 1,
  "name": "dsh",
  "agent": "dsh",
  "version": "0.4.0",
  "entrypoint": "index.js",
  "capabilities": ["rules", "agents", "commands", "skills", "mcp"]
}
```

安装由 DSH 完成：

```bash
dsh plugin --profile desktop add "D:/workspace/VibeStack/plugins/dsh"
```

`vibe-stack plugin install` 已退场；`vibe-stack plugin list/status` 只做适配器自省。
插件不得修改 Agent 主配置或用户 profile 组合。

### DSH 适配

插件只调用：

```bash
vibe-stack resolve --json --mode vibestack --project <project>
vibe-stack models catalog --json
```

插件不读取能力组目录、不解析 frontmatter，也不实现版本选择、`extends`、
覆盖顺序或内容校验。解析结果已经包含规则路径、技能路径、Agent/命令定义和
MCP 配置；模型层目录来自 `models catalog`。

插件只负责：

- 把规则注入为持久 `<system-reminder>` 消息
- 把 Agent 名册发布为会话投影，驱动左下角菜单与 persona 段落
- 把命令/技能映射为 `vibestack-<group>-<name>`，命令模板以 `followup()` 投递
- 按能力组工具引用动态挂载 MCP 子插件
- 从平台模型层目录读取层，按 `models.bindings.<agent>` 绑定到本机模型
- 告警记录和失败开放

| VibeStack 计划 | DSH 机制 |
|---|---|
| rules | `agent/pre-step` 注入持久用户消息 |
| skills | `ctx.skills.registerProvider('vibestack')` |
| agents | 会话投影 + 系统提示词人设段 + 左下角菜单 |
| commands | `ctx.commands.register()` + `followup()` |
| mcp | 每台服务器挂载 `@deepseek-ai/dsh-mcp-client` 子插件 |
| models | 平台层目录 + `models.bindings.dsh`；未绑定层降级 |

失败处理：

- CLI 缺失、超时、非零退出、JSON 或 schema 不合法：只加载插件默认技能并告警。
- `resolve` 已跳过的坏项通过 `warnings` 返回，插件记录后继续启动。
- MCP 挂载失败不阻断规则、技能、命令与名册注入。
- 插件不得写入项目、能力组、工具包或 Agent 主配置。

详细契约见 [`resolve-api.md`](resolve-api.md) 与
[`dsh-plugin-plan.md`](dsh-plugin-plan.md)。

## 8. 全局配置

```text
~/.config/vibestack/config.json
```

```json
{
  "schema_version": 1,
  "repository": "D:/workspace/work/VibeStack",
  "core": { "name": "core", "version": "0.1.0" },
  "models": {
    "default": "standard",
    "bindings": {
      "dsh": {
        "fast": { "provider": "deepseek-account", "model": "deepseek-flash" },
        "standard": { "provider": "deepseek-account", "model": "deepseek-flash" },
        "strong": { "provider": "deepseek-account", "model": "deepseek-flash" },
        "vision": { "provider": "deepseek-account", "model": "deepseek-flash" }
      }
    }
  }
}
```

该文件属于 VibeStack：CLI 读取仓库/Core 配置，并管理 `models` 绑定；各 Agent 插件读取
`models.bindings.<agent>`，把层映射成宿主模型。层目录由 Python Core 定义，经
`vibe-stack models catalog --json` 与 `resolve` 输出；能力组只写 `model: <layer>`。
provider / model / reasoningEffort 与凭据留在本机。详见 [`model-layers.md`](model-layers.md)。

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
| `models catalog/show/bind/unbind/default/migrate` | 模型层目录与本机绑定管理 |
| `tool list/run/serve/exec` | 工具入口 |
| `plugin status/list` | 适配器自省（安装由 `dsh plugin add` 负责） |

## 10. 迁移来源

| 内容 | 来源 | 处理 |
|---|---|---|
| core | 旧 `core/` | 迁移为 `core/0.1.0` |
| domain | `capability-groups/domain/` | 领域能力组统一目录，不默认加载 |
| data-forge | GitHub `HaoNaN9279/data_forge` | 重新部署，pin commit |
| markitdown | GitHub `microsoft/markitdown` | 重新部署，pin tag |
| video-transcribe | 本地 | 直接迁移 |

旧 `stacks/` 预设不再保留。
