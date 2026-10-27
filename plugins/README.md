# Agent 插件

Agent 插件是 VibeStack 与具体 Agent 工具之间的适配层。插件在 Agent 启动时读取能力组和工具包，把规则、Agent、命令、技能和 MCP 注入目标工具。

插件只读取仓库内容，不复制、不链接内容到项目，也不修改 Agent 的主配置文件。

本文以 OpenCode 作为示例说明目录、清单和安装路径；规范本身不绑定任何具体 Agent 工具。

## 1. 目录结构

```text
plugins/<agent>/
├── plugin.json        # 适配器清单
├── index.ts           # 入口
├── index.test.ts      # 可选测试
└── skills/            # 可选默认技能
    └── <skill-name>/
        └── SKILL.md
```

新增 Agent 只增加同级目录，不修改能力组、工具包或其他适配器。

入口文件名和语言由目标 Agent 的插件机制决定；目录树中的 `index.ts` 是 OpenCode 示例。

## 2. plugin.json

以下以 OpenCode 为例；其他适配器只替换示例值，字段含义不变。

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

| 字段 | 必填 | 说明 |
|---|---|---|
| `schema_version` | 是 | 固定为 `1` |
| `name` | 是 | 适配器名称 |
| `agent` | 是 | 目标 Agent 名称，与目录名一致 |
| `version` | 是 | 适配器版本 |
| `entrypoint` | 是 | 入口文件，相对于插件目录 |
| `install.kind` | 是 | 当前只支持 `copy` |
| `install.target` | 是 | 入口文件安装路径，支持 `~` |
| `install.skills_target` | 否 | 默认技能安装目录，支持 `~` |
| `capabilities` | 是 | 适配器支持的能力列表 |

`capabilities` 取值：

```text
rules / agents / commands / skills / mcp / tools
```

声明为支持的能力必须实现；不支持的能力必须明确告警并跳过，不得静默忽略。

## 3. 通用运行契约

插件必须遵守以下契约：

- 启动时读取项目 `.vibestack/stack.json`；从当前目录向上查找，直到文件系统根目录。
- 没有 `stack.json` 时不加载 Core，也不加载任何能力组。
- 没有 `stack.json` 时仍可加载插件自带的 `vibestack` 指引技能。
- 仓库定位顺序：`VIBESTACK_HOME`、`VIBESTACK_REPO`、`~/.config/vibestack/config.json` 的 `repository`。
- 仓库未配置时产生告警，不阻断 Agent 启动。
- 读取能力组和工具包必须只读；不得写入项目、能力组、工具包或 Agent 主配置。
- 注入过程必须幂等：重复执行不会重复追加规则或技能路径。
- 单个规则、Agent、命令、技能或工具失败时，只跳过该项并告警，不影响其他内容和 Agent 启动。
- 插件不得引入第三方运行时依赖。
- 配置变化后由 Agent 重启重新加载，不要求插件常驻监听文件。

## 4. 加载顺序与合并

加载顺序：

```text
1. 读取 stack.json
2. 加载 stack.core（存在时）
3. 按 stack.groups 数组顺序加载
4. 每个能力组先递归加载 extends 依赖
5. 同一能力组只加载一次
6. 生成注入计划并应用到目标 Agent 配置
```

版本规则：

- `stack` 中指定 `version` 时使用指定版本。
- 未指定版本时使用该能力组的最新版本目录。
- 能力组不存在时告警并跳过。
- `extends` 依赖优先于依赖者；依赖版本优先使用 `stack.groups` 中的同名引用。

合并规则：

| 类型 | 规则 |
|---|---|
| rules | 追加，按文件路径去重 |
| skills | 追加技能目录，按路径去重 |
| agents | 同名覆盖注入字段，保留目标侧已有的 model/permission 等配置 |
| commands | 同名覆盖注入字段 |
| mcp | 同名 key 覆盖 |

## 5. 能力规范

### 5.1 Rules

源位置：`capability-groups/<group>/<version>/rules/**/*.md`

要求：

- 递归扫描 `rules/` 下的所有 `.md` 文件。
- 文件必须以 YAML frontmatter 开头，frontmatter 必须包含 `name`。
- 缺少 `name` 时跳过该规则并告警。
- 按路径排序后追加到目标 Agent 的常驻指令机制：支持路径的 Agent 注入路径，不支持路径的 Agent 可内联正文。
- 多个能力组的规则按加载顺序追加，不覆盖。
- 不得把规则内容复制到项目或 Agent 主配置。

插件只负责发现、校验和注入内容或路径。

### 5.2 Agents

源位置：`capability-groups/<group>/<version>/agents/*.md`

要求：

- 至少扫描 `agents/*.md`；当前约定为单层，不递归子目录。
- 文件必须以 YAML frontmatter 开头，frontmatter 必须包含 `name`、`description`、`mode`。
- `mode` 只能是 `primary`、`subagent` 或 `all`。
- 正文作为目标 Agent 的系统提示词。
- 缺少必填字段或 `mode` 非法时跳过该 Agent 并告警。
- 以 frontmatter 的 `name` 作为唯一标识，不以文件名为准。
- 同名 Agent 后加载者覆盖注入字段；目标侧已有的 `model`、`temperature`、`permission` 等用户配置必须保留。
- 能力组 Agent 定义中的 `model`、`temperature`、`permission` 不得注入，也不得写入能力组。

### 5.3 Commands

源位置：`capability-groups/<group>/<version>/commands/*.md`

要求：

- 至少扫描 `commands/*.md`；当前约定为单层，不递归子目录。
- 文件必须以 YAML frontmatter 开头，frontmatter 必须包含 `name`、`description`。
- `agent` 可选，用于指定执行命令的 Agent。
- 正文作为命令模板，原样传递，不自行替换参数。
- 缺少 `name` 或 `description` 时跳过该命令并告警。
- 同名命令后加载者覆盖注入字段。
- `$ARGUMENTS`、位置参数、shell 注入、文件引用等模板语法由目标 Agent 解释；适配器不得假设所有 Agent 支持相同语法。

### 5.4 Skills

源位置：`capability-groups/<group>/<version>/skills/<skill-name>/SKILL.md`

同时适用于插件自带的默认技能：`plugins/<agent>/skills/<skill-name>/SKILL.md`。

要求：

- 每个技能必须位于独立目录，目录名即技能名，目录内必须包含 `SKILL.md`。
- `SKILL.md` 必须以 YAML frontmatter 开头，frontmatter 必须包含 `name`、`description`。
- `name` 必须与目录名一致，匹配 `[a-z0-9]+(-[a-z0-9]+)*`，长度 1-64。
- `description` 长度 1-1024。
- 可选字段：`license`、`compatibility`、`allowed-tools`。
- 不允许定义 `metadata`。
- 校验通过后，把技能目录加入目标 Agent 的技能搜索路径，或按目标 Agent 的机制注册；不复制目录内容。
- 校验失败时跳过该技能并告警。
- 同名技能由目标 Agent 的搜索路径顺序决定；插件不得覆盖能力组之外的技能文件。

`references/`、`scripts/`、`assets/` 随技能目录一起被发现，不作为独立能力注入。

### 5.5 Tools

源位置：仓库根目录 `tools/<name>/<version>/tool.json`

要求：

- 建立工具索引，至少支持按 `tool:<guid>@v<version>` 查找；可同时支持 `name@version`。
- 读取当前加载能力组 `group.json` 的 `tools` 数组；能力组应使用完整工具 ID 引用。
- 工具不存在时告警并跳过。
- 非 MCP 工具不注入 Agent 配置；由规则或技能指示 Agent 通过 `vibe-stack tool run <tool> -- <args>` 调用。
- `tool_permissions` 不写入 Agent 的模型或权限配置；工具执行权限由 `vibe-stack tool` 和用户环境处理。
- 能力组内不得包含 `tools/`、`tool.json`、`pyproject.toml` 或工具源码。

`provider` 行为：

| provider | CLI | MCP |
|---|---|---|
| `python` | `vibe-stack tool run` | `vibe-stack tool serve` |
| `mcp` | 不支持，提示使用 `tool serve` | 直接使用 `tool.json` 的 `mcp` 配置 |
| `builtin` / `sandbox` / `app` | 保留扩展位 | 保留扩展位 |

### 5.6 MCP

MCP 不作为独立目录存在，而是工具包的一种配置：`tool.json` 中的 `mcp` 对象。

要求：

- 只处理 `tool.json` 中存在 `mcp` 对象的工具；与 `provider` 无关。
- `mcp.enabled` 为 `false` 时跳过。
- 注入 key 格式：`vibe:<group>_<server>`，其中 `<server>` 优先取 `mcp.name`，否则取工具 `name`。
- 注入前删除 `mcp.name`，因为目标配置的 key 已经表示服务器名称。
- `mcp` 的其余字段原样传递，由目标 Agent 解释远程或本地 MCP 配置。
- 同一 key 冲突时，后处理者覆盖。
- 不同能力组通过 group 前缀隔离，避免同名 MCP 冲突。
- MCP 凭据、Token 不得写入仓库；使用环境变量或目标 Agent 的密钥机制。
- 本地 MCP 启动命令必须自包含，不依赖用户机器上的随机路径。

## 6. 目标 Agent 映射

适配器必须把统一注入模型映射到目标 Agent 的配置机制：

| 能力 | 目标机制要求 |
|---|---|
| rules | 常驻指令或上下文注入；支持路径时注入路径，不支持路径时内联正文 |
| skills | 技能搜索路径或技能注册机制 |
| agents | 主 Agent/子 Agent 定义机制；保留目标侧已有的 model/permission |
| commands | 命令或提示模板注册机制 |
| MCP | MCP 服务器配置机制 |

通用要求：

- 规则和技能路径追加并去重。
- Agent 和命令按名称合并，保留目标侧未冲突字段。
- MCP 按 key 合并。
- 不覆盖 Agent 主配置文件，只能通过目标 Agent 提供的运行时配置扩展机制（如 hook、plugin API 或等价接口）注入。
- 目标 Agent 缺少某项能力时，必须在 `capabilities` 中声明不支持，并告警跳过。

### 示例：OpenCode

| VibeStack | OpenCode v1 | OpenCode v2 |
|---|---|---|
| rules | `config.instructions` | `config.instructions` |
| skills | `config.skills.paths` | `config.skills` 数组 |
| agents | `config.agent` | `config.agents` |
| commands | `config.command` | `config.commands` |
| MCP | `config.mcp` | `config.mcp` |

其他适配器参考此表实现等价映射，但不得把 OpenCode 的字段名当作通用规范。

## 7. 安装与发现

```bash
vibe-stack plugin list
vibe-stack plugin install <agent>
vibe-stack plugin status <agent>
```

安装行为：

- `plugin install` 读取 `plugin.json`，复制 `entrypoint` 到 `install.target`；目标目录由适配器按目标 Agent 定义。
- 存在 `skills/` 且配置了 `skills_target` 时，复制默认技能到目标目录；目标目录由适配器定义。
- 只复制文件，不修改 Agent 主配置。
- 安装后把当前仓库路径写入全局配置 `~/.config/vibestack/config.json` 的 `repository`。
- 重新安装覆盖入口文件和默认技能。

插件发现：

- CLI 自动发现 `plugins/*/plugin.json`，不需要修改注册表。
- 运行时插件根据全局配置或环境变量定位仓库。
- 默认技能安装后由插件重新校验并注入技能目录。

## 8. 适配器验收清单

新增或修改适配器时至少验证：

- [ ] 没有 `.vibestack/stack.json` 时不加载 Core 和能力组，但仍加载默认技能。
- [ ] Core 先于其他能力组加载。
- [ ] `groups` 按数组顺序加载，`extends` 依赖优先。
- [ ] rules 递归发现、按路径排序、缺少 `name` 时跳过并告警。
- [ ] agents 校验 `name`、`description`、`mode`，缺少或非法时跳过并告警。
- [ ] commands 校验 `name`、`description`，保留可选 `agent`。
- [ ] skills 校验目录名、名称格式、描述长度和 `metadata` 禁用规则。
- [ ] tools 能按工具 ID 解析，缺失工具时告警。
- [ ] MCP 使用 `vibe:<group>_<server>` 命名，`enabled: false` 时跳过。
- [ ] 同名 Agent、命令、MCP 后加载者覆盖；规则和技能路径追加。
- [ ] 用户已有的 Agent `model`、`permission` 不被覆盖。
- [ ] 安装后不修改 Agent 主配置。
- [ ] 单个坏文件不阻断 Agent 启动，告警可通过目标 Agent 日志查看。
- [ ] 重复启动或重复注入保持幂等。

测试命令示例（当前 OpenCode 适配器）：

```bash
uv run pytest -q
cd plugins/opencode && bun test
```

其他适配器应使用自身技术栈的测试命令，并在适配器目录中说明。

## 9. 新增适配器步骤

```text
1. 创建 plugins/<agent>/
2. 编写 plugin.json，声明 entrypoint、安装路径和支持的能力
3. 实现入口，读取 stack、解析能力组、生成注入计划
4. 按目标 Agent 的配置机制实现注入
5. 添加默认技能 skills/vibestack/SKILL.md
6. 编写测试，覆盖加载顺序、各能力校验、覆盖/追加和告警
7. 执行 vibe-stack plugin install <agent> 并验证 status
8. 在无 stack、有 stack、非法 frontmatter 三种场景下手动验证
```

当前适配器：`opencode`。
