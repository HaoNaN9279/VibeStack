# Agent 插件

Agent 插件是 VibeStack 与具体 Agent 工具之间的适配层。插件调用
`vibe-stack resolve --json` 获取统一注入计划，再把计划映射到目标 Agent 的
运行时配置。

插件不扫描能力组目录、不选择版本、不解析 frontmatter，也不实现 `extends`、
覆盖顺序或内容校验。这些逻辑只存在于 Python resolver 中。

插件只读取解析结果和自身默认技能，不复制、不链接内容到项目，也不修改
Agent 的主配置文件。解析契约见 [`../docs/resolve-api.md`](../docs/resolve-api.md)。

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

## 2. plugin.json

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

声明为支持的能力必须实现；不支持的能力必须明确告警并跳过。

## 3. 运行契约

- 启动时调用 `vibe-stack resolve --json --project <project>`。
- `vibe-stack` 必须已安装并在 `PATH` 中；自定义路径使用 `VIBESTACK_CLI`。
- 调用超时默认 5 秒，可用 `VIBESTACK_RESOLVE_TIMEOUT_MS` 覆盖。
- 一次启动只解析一次，`config` hook 只应用缓存结果。
- `stdout` 只按 UTF-8 解析 JSON；`stderr` 用于诊断。
- 校验 `schema_version`；不兼容时只加载默认技能并告警。
- 无 `.vibestack/stack.json` 时使用 `active=false` 的结果，不加载 Core。
- 解析失败、CLI 缺失、超时、非零退出、JSON 损坏：只加载插件默认技能。
- 失败不得阻断 Agent 启动。
- `resolve` 返回的 `warnings` 通过目标 Agent 日志输出。
- 插件不得写入项目、能力组、工具包或 Agent 主配置。
- 注入保持幂等：重复执行不重复追加规则或技能路径。
- 插件不得引入第三方运行时依赖。
- 配置变化后由 Agent 重启重新加载，不要求插件常驻监听文件。

默认技能只来自插件自身的 `skills/` 或安装后的 `vibestack-skills/`。能力组
技能由 `resolve` 返回路径，插件不读取其内容。

## 4. 职责边界

| 事项 | Resolver (`vibe-stack resolve`) | 插件 |
|---|---|---|
| 定位仓库和 stack | 是 | 否 |
| Core / groups / extends 顺序 | 是 | 否 |
| 版本选择与去重 | 是 | 否 |
| frontmatter 解析与校验 | 是 | 否 |
| 同名 Agent / 命令 / MCP 合并 | 是 | 否 |
| rules / skills 去重 | 是 | 映射时再兜底去重 |
| 目标 Agent 字段映射 | 否 | 是 |
| 保留用户 model / permission | 否 | 是 |
| 失败开放与日志 | 返回 warnings | 应用结果并记录 |

## 5. 注入计划

```json
{
  "schema_version": 1,
  "active": true,
  "rules": [{ "name": "global", "path": "...", "group": "core" }],
  "skills": [{ "name": "caveman", "path": "...", "group": "core" }],
  "agents": {
    "Athena": {
      "description": "...",
      "mode": "all",
      "system": "...",
      "source": "...",
      "group": "core"
    }
  },
  "commands": {
    "auto-git-commit": {
      "description": "...",
      "template": "...",
      "source": "...",
      "group": "core"
    }
  },
  "mcp": {
    "vibe:core_demo_mcp": { "type": "remote", "url": "..." }
  },
  "warnings": []
}
```

插件只提取映射所需字段：rules/skills 的 `path`，agents 的
`description`/`mode`/`system`，commands 的 `description`/`agent`/`template`，
以及 `mcp`。不得把 `source`、`group` 等诊断字段写入目标配置。

## 6. 目标 Agent 映射

| 能力 | 目标机制要求 |
|---|---|
| rules | 常驻指令或上下文注入；支持路径时注入路径 |
| skills | 技能搜索路径或技能注册机制 |
| agents | 主/子 Agent 定义机制；保留目标侧已有 model/permission |
| commands | 命令或提示模板注册机制 |
| MCP | MCP 服务器配置机制 |

通用要求：

- 规则和技能路径追加并去重。
- Agent 和命令按名称合并，保留目标侧未冲突字段。
- MCP 按 key 合并。
- 不覆盖 Agent 主配置文件，只能通过运行时配置扩展机制注入。
- 目标 Agent 缺少某项能力时，必须在 `capabilities` 中声明不支持并告警。

### OpenCode

| VibeStack 计划 | OpenCode v1 | OpenCode v2 |
|---|---|---|
| rules | `config.instructions` | `config.instructions` |
| skills | `config.skills.paths` | `config.skills` 数组 |
| agents | `config.agent` | `config.agents` |
| commands | `config.command` | `config.commands` |
| mcp | `config.mcp` | `config.mcp` |

其他适配器参考此表实现等价映射，但不得把 OpenCode 字段名当作通用规范。

## 7. 安装与发布

```bash
vibe-stack plugin list
vibe-stack plugin install <agent>
vibe-stack plugin status <agent>
```

安装行为：

- `plugin install` 读取 `plugin.json`，复制 `entrypoint` 到 `install.target`。
- 存在 `skills/` 且配置了 `skills_target` 时，复制默认技能。
- 只复制文件，不修改 Agent 主配置。
- 安装后把当前仓库路径写入全局配置 `~/.config/vibestack/config.json`。
- 重新安装覆盖入口文件和默认技能。

插件发现：

- CLI 自动发现 `plugins/*/plugin.json`，不需要修改注册表。
- 运行时由 `vibe-stack resolve` 根据全局配置和环境变量定位仓库。

## 8. 验收清单

- [ ] 无 `.vibestack/stack.json` 时不加载 Core 和能力组，但仍加载默认技能。
- [ ] 只调用一次 `vibe-stack resolve --json`，并传入正确 project。
- [ ] 校验 `schema_version`，不兼容时只加载默认技能并告警。
- [ ] CLI 缺失、超时、非零退出、JSON 损坏时不阻断 Agent 启动。
- [ ] rules、skills 路径正确追加并去重。
- [ ] agents、commands、mcp 正确映射，诊断字段不进入目标配置。
- [ ] 用户已有的 Agent `model`、`permission` 不被覆盖。
- [ ] Core 先于其他能力组加载。
- [ ] `groups` 按数组顺序加载，`extends` 依赖优先。
- [ ] 同名 Agent、命令、MCP 后加载者覆盖。
- [ ] 解析 warnings 可通过目标 Agent 日志查看。
- [ ] 安装后不修改 Agent 主配置。
- [ ] 重复启动或重复注入保持幂等。
- [ ] 插件目录中没有能力组解析、版本选择或 frontmatter 实现。

## 9. 测试

```bash
uv run pytest -q
cd plugins/opencode && bun test
```

无 `bun` 的环境可用 Node `--experimental-strip-types` 做入口加载和映射验证；
提交前至少完成一次解析 API 的真实 CLI 调用验证。

## 10. 新增适配器步骤

```text
1. 创建 plugins/<agent>/
2. 编写 plugin.json，声明 entrypoint、安装路径和支持的能力
3. 实现 resolve CLI 调用、schema 校验和失败开放
4. 按目标 Agent 的配置机制实现注入计划映射
5. 添加默认技能 skills/vibestack/SKILL.md
6. 编写测试，覆盖 API 成功、损坏 JSON、schema 不兼容、超时和幂等
7. 执行 vibe-stack plugin install <agent> 并验证 status
8. 在无 stack、有 stack、坏组和 CLI 缺失场景下手动验证
```

当前适配器：`opencode`。
