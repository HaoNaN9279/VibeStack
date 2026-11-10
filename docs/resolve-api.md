# Resolve API v2

`vibe-stack resolve --json` 是能力组解析的唯一边界。插件调用它获取注入计划，
不在插件内扫描目录、选择版本、解析 frontmatter 或拼宿主名。

## 调用

```bash
vibe-stack resolve --json [--mode project|vibestack] [--project <project-dir>]
```

- `--repo` 可选，默认按全局配置和环境变量定位仓库。
- `--json` 输出机器可读 JSON；省略时输出摘要。
- `--mode` 默认 `project`：
  - `project`：无 `.vibestack/stack.json` 时返回 `active=false`，不加载 Core。
  - `vibestack`：**Core 始终加载**；无 stack 时也返回 `active=true`，只含 Core。
- 没有版本协商参数。`schema_version` 恒为 `2`，形状只有一种。
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
  "repository": "D:/workspace/VibeStack",
  "project": "D:/workspace/UnityGame",
  "core": {
    "guid": "32hex",
    "name": "core",
    "version": "0.1.0",
    "description": "core",
    "root": ".../capability-groups/core/0.1.0",
    "permissions": ["fs"],
    "extends": [],
    "tools": [],
    "modules": []
  },
  "groups": [
    {
      "guid": "32hex",
      "name": "unity-framework",
      "version": "1.0.0",
      "description": "...",
      "root": ".../capability-groups/domain/unity-framework/1.0.0",
      "permissions": ["fs"],
      "extends": [],
      "tools": ["tool:..."],
      "modules": [
        {
          "path": "battle",
          "alias": "battle",
          "title": "战斗",
          "description": "...",
          "root": ".../modules/battle",
          "paths": ["Assets/Battle/**"],
          "default": true,
          "depends": ["ui"],
          "tools": []
        }
      ]
    }
  ],
  "rules": [
    {
      "name": "global",
      "id": "core/global",
      "path": ".../rules/00-global.md",
      "group": "core",
      "module": "",
      "kind": "rule",
      "scope": "global",
      "paths": [],
      "always": true,
      "priority": 0,
      "description": ""
    }
  ],
  "skills": [
    {
      "name": "battle-tips",
      "id": "unity-framework/battle/battle-tips",
      "path": ".../modules/battle/skills/battle-tips",
      "group": "unity-framework",
      "module": "battle",
      "description": "..."
    }
  ],
  "agents": {
    "battle/BattleDev": {
      "name": "BattleDev",
      "id": "unity-framework/battle/BattleDev",
      "description": "...",
      "mode": "subagent",
      "system": "...",
      "system_path": ".../modules/battle/agents/battle-dev.md",
      "source": ".../modules/battle/agents/battle-dev.md",
      "group": "unity-framework",
      "module": "battle",
      "label": "unity-framework/battle"
    }
  },
  "commands": {
    "battle/battle-build": {
      "name": "battle-build",
      "id": "unity-framework/battle/battle-build",
      "description": "...",
      "template": "...",
      "template_path": ".../modules/battle/commands/battle-build.md",
      "source": ".../modules/battle/commands/battle-build.md",
      "group": "unity-framework",
      "module": "battle"
    }
  },
  "mcp": {
    "vibe:unity-framework_battle_unity": { "type": "stdio", "command": "..." }
  },
  "warnings": [],
  "fingerprint": "sha256",
  "model_layers": [
    { "id": "fast", "label": "快速", "kind": "speed", "rank": 1 },
    { "id": "standard", "label": "标准", "kind": "balanced", "rank": 2 },
    { "id": "strong", "label": "深度", "kind": "reasoning", "rank": 3 },
    { "id": "vision", "label": "多模态", "kind": "multimodal", "rank": 4 }
  ],
  "model_default": "standard",
  "names": {
    "agents": { "unity-framework/battle/BattleDev": "battle/BattleDev" },
    "commands": { "unity-framework/battle/battle-build": "vibestack-unity-framework-battle-battle-build" },
    "skills": { "unity-framework/battle/battle-tips": "vibestack-unity-framework-battle-battle-tips" }
  }
}
```

字段：

| 字段 | 说明 |
|---|---|
| `schema_version` | 恒为 `2` |
| `active` | 计划是否生效；`mode=vibestack` 时始终为 `true` |
| `mode` | `project` 或 `vibestack` |
| `core` | 已解析的 Core 摘要；`project` 模式无 stack 时为 `null` |
| `groups` | 已解析的领域组摘要，按加载顺序；`modules` 是已激活模块 |
| `rules` | 规则列表，按注入顺序；带作用域字段 |
| `skills` | 技能目录，按加载顺序；可带 `model`（层 id） |
| `agents` | 已合并 Agent；可带 `model`（层 id） |
| `commands` | 已合并命令；可带 `model`（层 id） |
| `mcp` | 已合并 MCP 配置，key 为 `vibe:<group>_<module-alias>_<server>` |
| `warnings` | 非致命问题 |
| `fingerprint` | 解析输入内容的 SHA-256，用于诊断和缓存评估 |
| `model_layers` | 平台模型层目录 |
| `model_default` | 平台默认层 id |
| `names` | 限定 id → 宿主名（命令、技能）或计划键（Agent） |

路径为绝对路径和正斜杠。

### 限定 id 与计划键

| 位置 | 格式 |
|---|---|
| 组根内容的 `id` | `<group>/<name>` |
| 模块内容的 `id` | `<group>/<module-alias>/<name>` |
| `agents` / `commands` 的键 | 组根用 `<name>`；模块用 `<module-alias>/<name>` |
| `skills` 的宿主名 | `vibestack-<group>[-<module-alias>]-<name>` |

`rules` 的 `kind` 为 `rule` 或 `agents`（吸收的 `AGENTS.md`）。`scope` 为
`global`、`module`、`paths`；`always: false` 的规则只进索引，不注入正文。

`agents.system` 与 `commands.template` 仍内联正文，因为宿主 `systemPrompt` 回调是同步的。
`system_path` / `template_path` 指向同一文件，供需要按需读取的实现使用。

`model` 可选，值必须是平台层 id（`fast` / `standard` / `strong` / `vision`），长度 ≤32。
未知或非法值写入 `warnings` 并省略该字段。层到 provider/model/reasoningEffort 的绑定属于
用户本机配置，由插件按 `model_layers` 解析。能力组不得写 provider、具体模型名、
temperature、permission 等宿主参数。

## 解析规则

加载顺序：

1. Core（`mode=vibestack` 时无条件；`project` 模式仅当 stack 存在）
2. `stack.groups` 数组顺序
3. 每个组的 `extends` 依赖优先
4. 同名组只加载一次
5. 每组内部：组根内容 → 激活模块（`depends` 拓扑 + 路径字典序）

模块激活：

- `stack.groups[].modules` 省略：组根 + `default_modules`，再退化到 `module.json` 的 `default: true`。
- `"*"`：全部模块。
- 数组：按路径前缀包含（选 `battle` 含 `battle/ai`）。
- `exclude`：同上语义，从激活集扣除；`depends` 自动补全被依赖但未选中的模块。
- 选择不存在的模块：`resolve` 告警并跳过，`sync` / `validate` 报错。

内容校验：

| 类型 | 规则 |
|---|---|
| rules | 递归发现 `rules/**/*.md`；必须有 `name`；可选 `description`、`scope`、`paths`、`always`、`priority`、`overrides`、`model` |
| `model` | Agent / 命令 / 技能可选；必须是平台模型层 id，未知或非法时告警并省略 |
| agents | 递归发现 `agents/**/*.md`；必须有 `name`、`description`、`mode`，`mode` 只能是 `primary`、`subagent`、`all` |
| commands | 递归发现 `commands/**/*.md`；必须有 `name`、`description`，`agent` 可选 |
| skills | 每个含 `SKILL.md` 的目录一项；`name` 匹配目录名和 `[a-z0-9]+(-[a-z0-9]+)*`；`description` 1-1024 字符；禁止 `metadata` |
| AGENTS.md | 组根与模块内自动吸收为 `kind=agents` 规则；项目子目录仅在 stack 的 `agents_md` 为 `nested` 时吸收 |
| MCP | 仅处理组与模块工具引用；`mcp.enabled=false` 跳过 |

规则作用域默认值：组根为 `global`；模块有 `paths` 时为 `paths`，否则为 `module`。
显式写了 `paths` 但没写 `scope` 时视为 `paths`。作用域非法的规则告警并回退默认值。

## 合并与冲突

- rules：追加；`priority` 越大越靠后；`overrides` 压掉同组已收集的同名规则；`stack` 的 `disable` 按限定 id 或裸名剔除。
- skills：追加；宿主名重复保留后加载者并告警，`sync` 报错。
- agents、commands、mcp：同名后加载者覆盖。模块内容因键含 `module-alias` 不与其他模块冲突。
- 同一个限定 id 重复（同组同模块同名同类）才算真重复：`resolve` 告警并保留后加载者，`sync` / `validate` 报错。
- 不注入宿主模型参数（provider、具体模型名、temperature、permission）；只透传可选的层 id。
- 单个文件或工具失败只跳过该项并告警。

## 失败策略

- 只有一种形状，没有版本协商；插件必须校验 `schema_version == 2`。
- 不兼容时插件只加载默认技能，不得阻断 Agent 启动。
- 插件调用失败不得阻断 Agent 启动；建议超时 5 秒，可通过
  `VIBESTACK_RESOLVE_TIMEOUT_MS` 覆盖。
- CLI 必须已安装并在 `PATH` 中；自定义路径使用 `VIBESTACK_CLI`。

首版不提供磁盘缓存。若冷启动超过 1 秒，再基于 `fingerprint` 评估只读缓存。
