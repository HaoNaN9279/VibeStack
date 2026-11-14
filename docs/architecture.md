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

## 3. 能力组与模块

```text
capability-groups/
├── core/
│   └── <version>/
│       ├── group.json
│       ├── rules/
│       ├── agents/
│       ├── commands/
│       ├── skills/
│       ├── references/
│       └── modules/<path>/        # 可选，见下
└── domain/
    └── <name>/
        └── <version>/
            ├── group.json
            ├── rules/
            ├── agents/
            ├── commands/
            ├── skills/
            ├── references/
            └── modules/<path>/
```

总共有四层作用域：

```text
Layer (core / domain / project)
└── Group (版本与分发边界)
    └── Module (激活、命名、规则作用域边界)
        └── Unit (rule / agent / command / skill)
```

三条不变量：

- 模块不单独版本化，随所在组版本走。
- 模块不跨组；跨组复用走 `extends`。
- 没有 `module.json` 的目录也是模块，目录路径就是模块 id。

Core 常驻；领域能力组只在 `.vibestack/stack.json` 的 `groups` 中列出时加载。
`load_group` 对 `core` 使用 `capability-groups/core/<version>/`，其余组使用
`capability-groups/domain/<name>/<version>/`。`discover_groups` 同时扫描两者。

项目独有能力组放在 `<project>/.vibestack/groups/<name>/`，没有版本目录，`group.json`
的 `version` 可省略。同名时项目组覆盖仓库组。

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
  "tool_permissions": { "tool:<guid>@v0.2.1": ["fs", "exec"] },
  "modules_dir": "modules",
  "default_modules": ["battle"]
}
```

`extends` 形成依赖图。解析时依赖先于依赖者，按组名去重。`modules_dir` 默认
`modules`，`default_modules` 是项目未指定模块时的默认激活集；两者都可省略。

### 3.1 模块

```text
<group>/modules/battle/
├── module.json          # 可选
├── rules/
├── agents/
├── commands/
├── skills/
└── references/
```

`module.json`（全部可选，除 `name` 外无必填）：

| 字段 | 类型 | 含义 |
|---|---|---|
| `name` | string | 若写，必须等于目录末段 |
| `title` | string | 展示名 |
| `description` | string | 一句话说明 |
| `alias` | string | 宿主命名段，默认目录各段用 `-` 连接 |
| `paths` | string[] | 模块默认规则作用域，如 `["Assets/Battle/**"]` |
| `default` | bool | 未配置默认集时是否默认激活 |
| `depends` | string[] | 同组模块路径，解析时自动补全并拓扑排序 |
| `tools` | string[] | 模块级工具引用，合并进组工具集 |

模块路径必须匹配 `^[a-z0-9]+(-[a-z0-9]+)*(/...)*$`，深度不超过 3。同一组内 `alias`
必须唯一；`depends` 必须指向同组存在的模块且无环。

组根内容与模块内容语义不同：**组根是全局默认，模块是局部覆盖**。组根适合全框架通用的
约定，模块适合某个子系统（战斗、UI、资源管线）自己的规则、Agent、命令和技能。

限定 id：

```text
组根  <group>/<name>
模块  <group>/<alias>/<name>
```

DSH 宿主名（命令、技能）：`vibestack-<group>-<alias>-<name>`；组根内容保持
`vibestack-<group>-<name>`。限定 id 与宿主名都由 resolver 计算，插件不自行拼接。

详细规范见 [`nested-modules.md`](nested-modules.md)。


## 4. 项目配置

```text
<project>/.vibestack/
├── stack.json
├── lock.json
└── groups/<name>/    # 项目独有能力组，无版本目录
```

`stack.json` 是唯一激活来源。`lock.json` 是 `sync` 生成的解析快照，供诊断和复现。

```json
{
  "schema_version": 2,
  "core": { "name": "core", "version": "0.1.0" },
  "agents": [],
  "groups": [
    { "name": "unity-framework", "version": "1.0.0", "modules": "*" },
    { "name": "hnflow-forge", "version": "0.1.0", "exclude": ["legacy"], "disable": ["unity-framework/legacy/old-rule"] }
  ],
  "agents_md": "off"
}
```

| 字段 | 含义 |
|---|---|
| `modules` | 省略 = 组根 + `default_modules`；`"*"` = 全部；数组按路径前缀包含（选 `battle` 含 `battle/ai`） |
| `exclude` | 同上语义，从激活集扣除 |
| `disable` | 规则限定 id 或裸规则名的列表，命中即不注入 |
| `agents_md` | `off`（默认）或 `nested`；`nested` 时吸收项目子目录的 `AGENTS.md` |

`schema_version` 必须为 `2`，旧值直接报错，不做兼容。

无 `stack.json` 时按 resolve 模式区分：

- `project` 模式（默认）：不加载 Core，不加载任何项目能力组，插件仍加载自带的
  `vibestack` 指引技能。
- `vibestack` 模式（DeepSeek Harness 的 VibeStack 会话）：**Core 无条件加载**，
  领域能力组仍为空；插件把 Core 的规则、Agent、命令、技能与 MCP 注入会话。

## 5. 加载算法

解析和注入由 `vibe-stack resolve --json [--mode project|vibestack]` 完成，插件不重复实现：

```text
1. 读全局配置 ~/.config/vibestack/config.json 定位仓库
2. 读 .vibestack/stack.json（schema 2）
3. 加载 Core
4. 按 groups 顺序加载领域能力组
5. 每个组先递归加载 extends
6. 按组名去重
7. 每组发现模块树，按 modules/exclude/default_modules 计算激活集
8. 按 depends 拓扑 + 路径字典序排列模块
9. 收集组根与模块的规则、Agent、命令、技能、MCP，并解析规则作用域
10. 计算限定 id 与宿主名，检测碰撞
11. 生成与目标 Agent 无关的注入计划
12. 插件把注入计划映射到目标 Agent 配置
```

`resolve` 严格只读，不写 `.vibestack/lock.json`。`project` 模式无 stack 时返回
`active=false`，不加载 Core；`vibestack` 模式无 stack 时返回 `active=true`，只含 Core。
缺失能力组或坏文件在 `resolve` 中产生告警并跳过；`sync` 保持严格校验，缺失组、缺失模块、
限定 id 重复、宿主名碰撞都直接报错。`validate` 等价于严格解析但不写 lock。

规则按作用域注入：

| 作用域 | 何时注入 |
|---|---|
| `global` | 总是 |
| `module` | 当前工作目录在模块目录内（或落在模块 `paths`） |
| `paths` | 当前工作目录匹配 `paths` 中任一 glob |
| `always: false` | 不注入正文，只进紧凑索引 |

DSH 适配器把能力组命令/技能映射为 `vibestack-<group>[-<alias>]-<name>`，会话的 Agent /
命令 / 技能列表始终是 Core + 当前工作区并集；子 Agent 会话沿用同一份计划。详见
[`dsh-plugin-plan.md`](dsh-plugin-plan.md) 的 R7–R10。

合并规则：

| 类型 | 规则 |
|---|---|
| rules | 追加；`priority` 越大越靠后注入；`overrides` 压掉同名早期规则 |
| skills | 追加路径；宿主名重复保留后加载者并告警，`sync` 报错 |
| agents | 同名覆盖；模块内容以 `<alias>/<Name>` 为键，天然不冲突 |
| commands | 同名覆盖；同上 |
| mcp | 同名覆盖；模块服务器名含 alias |

限定 id 完全相同才视为重复：`resolve` 告警并保留后加载者，`sync` / `validate` 报错。
跨组同名仍按「后加载覆盖」处理。

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
vibe-stack models show --json
```

插件不读取能力组目录、不解析 frontmatter，也不实现版本选择、`extends`、
覆盖顺序或内容校验。解析结果已经包含规则路径、技能路径、Agent/命令定义和
MCP 配置；模型层目录、项目默认绑定、本机覆盖与默认层来自 `models show`。

插件只负责：

- 把规则注入为持久 `<system-reminder>` 消息
- 把 Agent 名册发布为会话投影，驱动左下角菜单与 persona 段落
- 把命令/技能映射为 `vibestack-<group>-<name>`，命令模板以 `followup()` 投递
- 按能力组工具引用动态挂载 MCP 子插件
- 从 `models show` 读取层目录与生效绑定，项目默认由 `.vibestack/models.json` 提供，本机可逐层覆盖
- 告警记录和失败开放

| VibeStack 计划 | DSH 机制 |
|---|---|
| rules | `agent/pre-step` 注入持久用户消息 |
| skills | `ctx.skills.registerProvider('vibestack')` |
| agents | 会话投影 + 系统提示词人设段 + 左下角菜单 |
| commands | `ctx.commands.register()` + `followup()` |
| mcp | 每台服务器挂载 `@deepseek-ai/dsh-mcp-client` 子插件 |
| models | 平台层目录 + 项目默认绑定 + 本机 `models.bindings.dsh` 覆盖；未绑定层降级 |

失败处理：

- CLI 缺失、超时、非零退出、JSON 或 schema 不合法：只加载插件默认技能并告警。
- `resolve` 已跳过的坏项通过 `warnings` 返回，插件记录后继续启动。
- MCP 挂载失败不阻断规则、技能、命令与名册注入。
- 插件不得写入项目、能力组、工具包或 Agent 主配置。

详细契约见 [`resolve-api.md`](resolve-api.md) 与
[`dsh-plugin-plan.md`](dsh-plugin-plan.md)。

## 8. 模型默认与全局配置

项目根 `.vibestack/models.json` 提供四层默认路由，当前四层均为
`deepseek-account/deepseek-flash`：

```json
{
  "schema_version": 1,
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
```

本机可在 `~/.config/vibestack/config.json` 逐层覆盖，不需要复制全部四层：

```json
{
  "schema_version": 1,
  "repository": "D:/workspace/work/VibeStack",
  "models": {
    "default": "strong",
    "bindings": {
      "dsh": {
        "fast": { "provider": "local", "model": "small" }
      }
    }
  }
}
```

该文件属于 VibeStack：CLI 读取仓库/Core 配置，并管理 `models` 绑定；各 Agent 插件通过
`vibe-stack models show --json` 获取层目录、项目默认、本机覆盖与生效默认层。全局
`models.bindings.<agent>` 覆盖项目同名层；默认层优先取全局，其次项目，最后内置
`standard`。层目录由 Python Core 定义，能力组只写 `model: <layer>`。
provider / model / reasoningEffort 与凭据留在项目模型文件或本机。详见
[`model-layers.md`](model-layers.md)。

## 9. CLI

| 命令 | 作用 |
|---|---|
| `list [--tree]` | 列出能力组和工具；`--tree` 带模块树 |
| `status` | 显示项目激活项、stack schema、模块选择 |
| `info <group> [--modules]` | 组详情，含模块与计数 |
| `init` | 创建 `stack.json` |
| `activate` | 追加组 |
| `deactivate` | 移除组 |
| `sync` | 严格解析并写 `lock.json` |
| `validate [--json]` | 严格解析，不写文件，失败退出码 1 |
| `resolve --json` | 生成只读注入计划，供插件消费 |
| `rules list/show` | 列出规则；`show --for <path>` 看某路径生效的规则 |
| `preview` | 按会话顺序列出某目录与 Agent 实际加载的内容及摘要（含宿主 `AGENTS.md` 链） |
| `module list/enable/disable` | 查看、启用、停用模块（写回 stack.json） |
| `models catalog/show/bind/unbind/default/migrate` | 模型层目录、项目默认与本机覆盖管理 |
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
