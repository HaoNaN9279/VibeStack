# VibeStack × DeepSeek Harness

把 VibeStack 能力组接入 DeepSeek Harness 的插件。它新增一个 **VibeStack 工作模式**
（agent preset），不修改标准、创造、PTC、极简等现有模式；规则、技能、命令、MCP 与
Agent 人设只在进入该模式的会话里生效。

- **Core 在该模式下始终生效**：不管会话目录是不是项目根、有没有 `.vibestack/stack.json`。
  领域能力组仍只按该项目的 `groups`（含 `extends`）加载。
- 只消费 `vibe-stack resolve --json --mode vibestack --project <cwd>`，不扫描能力组、
  不选版本、不解析 frontmatter。
- 只在本目录内新增文件，不改 `.vibestack/`、能力组或工具包。
- 安装完全由 DSH 负责（本地目录 `link:`），不上架 npm，不走插件市场。
- 失败开放：CLI 缺失、超时、JSON 损坏、schema 不兼容都只写日志，不阻断会话。

## 安装

需要：`vibe-stack` 已安装并在 `PATH`（`uv tool install --from <repo> vibe-stack`），
DSH 桌面版 0.2.x。

装进桌面版正在使用的 profile（先完全退出桌面版，再执行）：

```bash
dsh plugin --profile desktop add "D:/workspace/VibeStack/plugins/dsh"
```

只想先试一下，可以基于官方 web 模板建一个独立 profile：

```bash
dsh --profile vstest --from-default-profile web --dump-config > /dev/null
dsh plugin --profile vstest add "D:/workspace/VibeStack/plugins/dsh"
dsh --profile vstest --port 8799 --no-open
```

> 直接 `dsh plugin --profile <新名字> add ...` 只会初始化一个 base-only profile：没有
> Web UI，也没有 `agentPresets` 注册表，此时本插件的 preset 行会停在
> `pending (waiting for service: agentPresets)`。请先按上面的方式建好 web/desktop
> profile 再安装。

安装时 pnpm 会提示 `linked in dependency will not resolve the peer dependencies`：
本插件只把 `@deepseek-ai/dsh-mcp-client` 声明为可选 peer，解析不到时 MCP 能力降级为
一条告警，其余能力不受影响。

`vibe-stack plugin install` 已退场：本适配器没有声明 `install` 字段，安装动作由
`dsh plugin add` 完成（`vibe-stack plugin list/status` 仍能做适配器自省）。

卸载：

```bash
dsh plugin --profile desktop remove dsh-vibestack
```

## 使用

1. 会话模式选择器里选 **VibeStack**（新会话默认仍是标准模式）。
2. 进入模式后，首个 `agent/pre-step` 用 `vibe-stack resolve --mode vibestack` 解析
   当前会话目录：Core 始终参与，领域能力组按该目录的 `.vibestack/stack.json` 并集参与。
   规则、Agent 名册、技能、命令与 MCP 一起装进本会话。名册写在注入消息的
   `source` 里，模型看不到；占位只在会话真正开始工作后出现。
3. 输入框左下的 **Agent** 菜单（`◆` 按钮）切换本会话人设：列出 **Core 的 Agent +
   当前工作区依赖的能力组的全部 Agent**（包括 `mode: subagent` 的定义），并标注来源组。
   默认选择 `Athena`；Core 始终可用，所以 VibeStack 会话里菜单总会出现。选择会持久化。
4. 输入框右下角的模型位替换为 **模型层** 选择（未配置时用内置 `flash` 通用层兜底）；
   选层等价于切换会话模型路由。也可以用命令：

```text
/vibestack-agent           # 列出可选 Agent 与当前选择
/vibestack-agent athena    # 切换人设
/vibestack-layer           # 列出模型层与当前映射
/vibestack-layer strong    # 切换模型层（等价于选择该路由）
```

人设只改变系统提示词（追加该 Agent 的 `system`），不限制工具，也不改变其它模式。
子 Agent 会话继承同一个 preset，也按同一份 Core + 工作区并集生成名册；模型自动派发
subagent 任务时，子会话可选的 Agent / 命令 / 技能与父会话一致（子会话工作目录不同
时按子会话目录解析）。

### 命名空间

能力组命令与技能在 DSH 里统一发布为 `vibestack-<group>-<name>`，避免 Core 与领域组
同名冲突：

| 能力组 | 原名 | DSH 实际名称 |
|---|---|---|
| core | `auto-git-commit` | `/vibestack-core-auto-git-commit` |
| group-forge | `group-new` | `/vibestack-group-forge-group-new` |
| core | `caveman`（skill） | `vibestack-core-caveman` |

命令 handler 在每次执行前重新读取当前工作区计划：Core 命令在任何 VibeStack 会话都可
执行；领域组命令只有在当前工作区激活了该组时才执行，否则返回
`不属于当前工作区`，不会跨项目泄漏。命令模板以**普通用户回合**投递（`followup`）。
官方 DSH 命令（`/model`、`/compact` 等）与本插件的 `/vibestack-agent` 不受影响。

### 模型层

模型层把用户本机的 provider/model/reasoningEffort 打包成一个具名路由，能力组只写
`model: <layer>`。层定义存放在全局配置 `~/.config/vibestack/config.json` 的
`models` 段，不进入能力组、项目或会话日志；凭据仍由 DSH 管理。

```jsonc
{
  "models": {
    "default": "strong",
    "layers": [
      { "id": "fast", "label": "快速", "provider": "deepseek-account",
        "model": "deepseek-flash", "reasoningEffort": "low" },
      { "id": "strong", "label": "深度", "provider": "deepseek-account",
        "model": "deepseek-pro", "reasoningEffort": "high" }
    ]
  }
}
```

- 根级 `vibestack-core` 行注册 `ctx.vibestack` 服务与 `GET/POST /api/vibestack/models`。
- 设置页 **VibeStack 模型层** 可增删改层、设默认层，并用 `catalog()` 检测哪些层当前可路由；
  写入是原子替换。
- **左下角始终是 Agent 选择**：列出 Core + 当前工作区能力组的全部 Agent。
- **右下角模型位替换为模型层选择**：`modelSelector: replace`（默认）用低 priority 遮蔽
  `conversation.input.model`；VibeStack 会话显示层，其它模式回退到实时原生模型目录。
  `modelSelector: additive` 可退回“保留原生模型位 + 左下角额外层控件”的兼容形态。
- 未配置任何层时，服务提供内置通用层 `flash`：`deepseek-account / deepseek-flash`。
- **Agent** 人设选择、能力组命令、用户 `/vibestack-<group>-<name>` 技能调用会读取声明的
  `model` 层并通过 `sessionController.selectModel` 应用，从下一请求起生效；失败只告警，
  不阻断人设/命令/技能。
- `models.default` 会在空白 VibeStack 会话首次 pre-step 应用一次；已有模型选择的会话
  不会覆盖。子 Agent 会话不公开模型选择入口。

### 能力组开发

`custom-agent`、`custom-command`、`custom-mcp`、`custom-rule`、`custom-skill`、
`custom-tool` 与 `custom-group` 现在属于领域组 `group-forge`，不再随 Core 常驻。在本仓库
根目录的 `.vibestack/stack.json` 中激活后，VibeStack 会话会出现
`vibestack-group-forge-custom-*` 技能、`Hephaestus` Agent 与
`/vibestack-group-forge-group-new`、`/vibestack-group-forge-group-validate` 命令。

## 能力映射

| VibeStack 计划 | DSH 机制 | 作用域 |
|---|---|---|
| `rules` | `agent/pre-step` 注入持久 `<system-reminder>` 用户消息 | 仅 VibeStack 模式 |
| `skills` | `ctx.skills.registerProvider('vibestack')` + 自带 `vibestack` 技能；能力组技能改名 `vibestack-<group>-<name>` | 该 agent |
| `commands` | `ctx.commands.register()` 注册 `vibestack-<group>-<name>`，handler 校验当前计划后模板渲染并 `agent.followup()` | 该 agent |
| `mcp` | 每台服务器动态挂载 `@deepseek-ai/dsh-mcp-client` 子插件 | 该 agent |
| `agents` | 会话投影：折叠注入消息 `source.roster` 与 `/vibestack-agent` 的 `command/run`；不写自定义事件 | 该会话 |

名册、命令、技能都是 **Core + 当前工作区并集**；名册与人设菜单都包含全部 Agent（含
`mode: subagent`）；Agent 行额外带 `group`，用于菜单标注。命令模板支持
`$ARGUMENTS`、`$1`..`$9`；`` !`cmd` `` 与 `@file` 不展开。

## 事件约束

DSH 的会话读取器只接受**第一方事件类型**，未知类型必须带 `ignorable: true` 才能保留；
而活跃会话的 `Session.append()` 无法写这个标记。插件因此**不写任何自定义事件类型**：

- 名册随规则消息的 `source.roster` 落库（`user/message`，模型不可见）；
- 人设选择由 `/vibestack-agent` 的 `command/run` 事件承载，重启后仍然有效；
- 投影 `vibestack` 只折叠这两类已知事件，`stateVersion` 变更时旧检查点自动失效。

插件的 `agents` 能力基于规则注入：`rules: false` 或项目没有规则文件时，Agent 菜单不会出现
（人设段落仍按 `defaultAgent` 生效）。

## 配置

在 profile 的 `cordis.patch.yml` 里按行 id 覆盖（`config` 是整体替换，需写全字段）：

```yaml
# 根级服务：模型层与设置路由
- id: vibestack-core
  name: dsh-vibestack
  config:
    role: core
    modelsFile: ''
    modelSelector: replace      # 或 additive

# 会话模式
- id: vibestack
  name: dsh-vibestack
  config:
    role: preset
    command: 'C:/Users/me/.local/bin/vibe-stack.exe'
    timeoutMs: 5000
    resolveMode: vibestack
    namePrefix: vibestack
    maxCommandNameLength: 48
    skillRank: 250
    applyModelOnAgent: true
    applyModelOnCommand: true
    applyModelOnSkill: true
    applyDefaultLayer: true
    rules: true
    skills: true
    commands: true
    agents: true
    mcp: true
    maxRulesBytes: 65536
    defaultAgent: ''
```

| 字段 | 默认 | 含义 |
|---|---|---|
| `role` | `preset` | `core`：根级服务/设置路由；`preset`：会话模式；`ui`：纯客户端行 |
| `host` | `true` | `false` 时该行只提供客户端 UI（根级 `vibestack-ui` 行用） |
| `modelsFile` | `''` | **core 行**：层文件；空则用全局 `~/.config/vibestack/config.json` 的 `models` 段 |
| `modelSelector` | `replace` | **core 行**：`replace` 右下角原生模型位替换为层选择（非 VibeStack 会话回退原生目录）；`additive` 保留原生位并在左下角加层控件 |
| `applyModelOnAgent` | `true` | 切换人设时应用其 `model` 层 |
| `applyModelOnCommand` | `true` | 执行能力组命令时应用其 `model` 层 |
| `applyModelOnSkill` | `true` | 用户 `/vibestack-...` 调技能时应用其 `model` 层 |
| `applyDefaultLayer` | `true` | 空白会话首次 pre-step 应用 `models.default` |
| `command` | `''` | `vibe-stack` 可执行文件；空则按 `VIBESTACK_CLI` → `vibe-stack.exe` → `vibe-stack` 查找 |
| `timeoutMs` | `5000` | 解析超时；`VIBESTACK_RESOLVE_TIMEOUT_MS` 优先 |
| `resolveMode` | `vibestack` | `vibestack`：Core 常驻；`project`：退回旧行为（无 stack 不加载 Core） |
| `namePrefix` | `vibestack` | 命令/技能命名空间前缀；改名需自行承担冲突 |
| `maxCommandNameLength` | `48` | 发布名超长时截断并追加短 hash |
| `skillRank` | `250` | 能力组技能的候选 rank |
| `rules` | `true` | 注入规则 |
| `skills` | `true` | 暴露技能 |
| `commands` | `true` | 注册命令与 `/vibestack-agent` |
| `agents` | `true` | Agent 投影、菜单与人设段落 |
| `mcp` | `true` | 挂载 MCP 服务器 |
| `maxRulesBytes` | `65536` | 规则上下文上限 |
| `defaultAgent` | `''` | 默认 Agent 名；空则优先 `Athena` |

> `resolveMode: vibestack` 需要 CLI 输出 `schema_version >= 2`。旧 CLI 不支持
> `--mode`，会返回错误；此时插件失败开放（不注入），并提示升级 `vibe-stack`。

## 结构

```text
plugins/dsh/
├── plugin.json          # VibeStack 适配器清单
├── package.json         # DSH 组合包：dsh.bundle.patch + dsh.client
├── cordis.patch.yml     # 只 insert：根级 core/UI 行 + `preset-vibestack` 模式
├── index.js             # 宿主半（core / preset 两种角色）
├── client.js            # 浏览器半（手写 bundle，仅 require react / react-dom）
├── lib/                 # resolve / 缓存 / 规则 / 技能 / 命令 / 投影 / MCP / 命名 / 计划 / 模型层
├── scripts/             # 旧会话事件修复
├── skills/vibestack/    # 插件自带技能
└── test/                # node:test
```

`cordis.patch.yml` 里 preset 的子插件清单镜像
`@deepseek-ai/dsh-web-app/presets/standard.patch.yml`（DSH 0.2.1-rc.3）。preset 没有继承
机制，DSH 升次要版本时需要同步这份清单。

## 验证

```bash
# 用 DSH 运行时的 node（沙箱内不能跑 `node --test <dir>`：子进程管道会被拦）
node test/agents.test.js && node test/config.test.js && node test/commands.test.js \
  && node test/mcp.test.js && node test/names.test.js && node test/plan.test.js \
  && node test/plans.test.js && node test/resolve.test.js && node test/rules.test.js \
  && node test/skills.test.js && node test/repair.test.js && node test/plugin.test.js \
  && node test/layers.test.js && node test/service.test.js && node test/models-route.test.js \
  && node test/core.test.js
```

`repair.test.js` 用合成的 v4 日志覆盖：补标记、保留 header 独立帧、幂等、拒绝撕裂尾部、
备份与原子替换。`plugin.test.js` 用内存版 Cordis 上下文跑完整链路：解析 → 规则注入去重 →
Core + 工作区并集名册随消息 `source` 发布 → 命名空间命令注册与当前工作区校验 → 人设段落
跟随 `command/run` 选择 → 子会话拿到同一份名册。它也断言插件**不向会话追加任何事件**
（自定义类型会让会话在重启后无法打开）。

### 旧会话修复

0.1.x 写入了 `vibestack/agents` / `vibestack/select` 事件，携带这些事件的会话在 DSH 重启后
会报 `contains event type ... unknown to this harness and not marked ignorable`。修复脚本给
这些记录补上 `ignorable: true`（序号不变，其余记录不动），先干跑只报告：

```bash
node scripts/repair-session-events.mjs                                    # 默认扫描 ~/.dsh/sessions，干跑
node scripts/repair-session-events.mjs --write                            # 就地修复，逐个留 .bak
node scripts/repair-session-events.mjs "<session 目录或 session.v4.jsonl.zstd>"  # 只查一个
```

DSH 的物理格式要求**第一个 Zstandard 帧只包含 header 行**，后面每个追加批次一帧。脚本
按帧结构解码，重写时把 header 与事件体压成两个独立帧；不能把整个日志压成一帧，否则会
报 `first frame is not exactly one header line`。写入是“临时文件 + fsync + 原子替换”，原
文件保留为 `session.v4.jsonl.zstd.bak`。旧脚本（0.2.0 之前）会把整个日志压成一帧，已在
本版本修正。

安装新插件并重启**不会**改写已有日志：新代码只保证不再写入自定义事件，历史修复仍需
跑一次脚本。修复前请退出桌面版；修复后重新打开会话，投影会自动从旧事件重建（旧
`vibestack/agents` 事件按未知可忽略事件保留，不再参与投影）。

安装后检查：

```bash
dsh --profile <profile> --dump-config | grep -i -A2 vibestack
```

已在 DSH 0.2.1-rc.3 / Windows 上验证：

- `dsh plugin --profile <p> add <本地目录>` 建立 `link:` 依赖成功，`--dump-config`
  出现 `# == dsh-vibestack` 层与 `preset-vibestack` 行。
- 用官方 web 模板启动时，启动图包含 `{"id":"dsh-vibestack"}`，
  `/plugins/??dsh-vibestack/client.js` 返回 200，且没有未激活告警。
- `node test/*.test.js` 全绿。

## 排查

日志前缀 `vibestack:`，常见原因：

- `vibe-stack` 不在 `PATH`（桌面版从 GUI 启动时继承的环境可能没有 `~/.local/bin`），
  用 `command` 配置绝对路径。
- 会话目录不是项目根：Core 仍然生效；只有领域能力组需要该目录的
  `.vibestack/stack.json`。子目录会话按子目录解析，通常没有领域组。
- 解析超时：调大 `timeoutMs` 或 `VIBESTACK_RESOLVE_TIMEOUT_MS`。
- MCP 未出现：macOS/Windows 桌面版需要 `@deepseek-ai/dsh-mcp-client` 可被运行时解析；
  解析不到时插件只记一条告警并跳过，其它能力不受影响。
- Agent 菜单不出现：确认会话模式是 VibeStack，且规则注入未被 `rules: false` 关掉；
  Core 始终自带 `Athena`、`Hermes`，所以正常情况下菜单总会出现。新会话要等第一轮
  注入之后才出现菜单。
- 命令不存在：能力组命令在首个 `agent/pre-step` 之后才注册；领域组命令还要求当前
  会话目录激活了该组。Core 命令（`vibestack-core-*`）在任何 VibeStack 会话都可用。
- 历史加载失败并提示 `event type "vibestack/..." ... not marked ignorable`：会话由
  0.1.x 写入，用上面的修复脚本补标记。
