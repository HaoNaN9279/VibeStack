# VibeStack × DeepSeek Harness 插件开发方案（v2.3）

| 项 | 值 |
| --- | --- |
| 文档版本 | 2.3（OpenCode 退场；R7–R10；模型层核心与增量选择器） |
| 日期 | 2026-11-07 |
| 目标运行环境 | DSH `0.2.1-rc.5`（桌面版 / web profile） |
| 插件 | `dsh-vibestack`（本仓库 `plugins/dsh`，本地 `dsh plugin add` 安装） |
| 范围 | 只自用：不发布 npm、不上架插件市场、不走 DSH 官方验证/审核流程 |
| 关联 | HNFlow 插件（`dsh-hnflow`）**强依赖**本插件；本插件不知道 HNFlow 存在（单向依赖） |
| 文档状态 | 方案稿 + 实施记录。§4（OpenCode 退场）、§7（层服务/设置页/选择器，含可选 `replace`）、§9 根级 core 行、§16–§19 与 §8.3 已实施；剩余主要是 GUI 手工验收 |
| 现行规范 | 模型层已平台化：层目录由 Python Core 定义，DSH 只保留本机绑定与自定义层；见 [`model-layers.md`](model-layers.md) |

---

## 0. 摘要

四项需求与结论：

| 需求 | 结论 | 关键约束 |
| --- | --- | --- |
| 删除 OpenCode 支持 | 删除 `plugins/opencode/`，改写文档与 CLI；能力组内容去掉 OpenCode 字样 | 保留 `plugins/<agent>/plugin.json` 适配器结构，当前唯一适配器是 `dsh` |
| 能力组 Command = 快捷提示词 | 把命令文件正文当模板，渲染后作为**普通用户回合**投给会话（与 DSH 原生命令共存） | 用 `followup()`（下一回合），不用 `steer()`（当前步骤） |
| `/` 调用加命名空间 | 统一为 `vibestack-<group>-<name>`（**小写 kebab**） | DSH 命令名与 skill 名都只接受小写语法，`VibeStack-` 大写形式无法注册 |
| 模型中间层 | 新增用户级「层」定义；agent / skill / command 用 `model: <layer>` 引用；VibeStack 会话的模型选择位改为层选择 | 模型选择是**会话级**的（交互入口在客户端，宿主可用 `sessionController` 写入）；层不含凭据、不写进能力组 |

本版新增四项需求（R7–R10）：

| 需求 | 结论 | 关键约束 |
| --- | --- | --- |
| R7 Core 为特殊能力组 | VibeStack 模式下 Core 无条件应用；`project` 模式保持"有 stack 才加载" | core 版本取全局配置 / stack；无 stack 时合成空 groups |
| R8 custom 系列独立成组 | 新建领域组 `group-forge`，承接 `custom-*` 与新的 `custom-group` | 领域组不默认激活；Core 不再包含这些技能 |
| R9 Agent / 命令 / 技能列表 = 并集 | Core + 当前工作区 `groups` + `extends`；每条带 `group` | 命令/技能命名空间化；领域命令按当前工作区校验 |
| R10 子会话名册 = 并集 | DSH 子 Agent 会话继承同一 preset，按同一份计划生成名册 | 不新增委派工具；子会话 cwd 不同时按子会话 cwd 解析 |

一句话：**能力组继续只描述"用什么能力"，用户自己的模型路由被抽成中间层；命令从"注册一个斜杠命令"变成"投一段提示词"；所有对外名称加 `vibestack-` 前缀以消除同名冲突；VibeStack 模式把 Core 当作无条件基底，Agent / 命令 / 技能 / 子会话名册都是 Core 与工作区能力组的并集。**

---

## 1. 范围与前提

1. **只做 DSH 适配器**：`plugins/opencode/` 已删除，`plugins/` 下只有 `dsh`。
2. **只自用**：不追求 npm 发布、市场上架、官方审核所需的元数据与展示规范；但仍遵守 DSH 的**技术**插件契约（bundle manifest / Config schema / 生命周期 / 命令语法 / 技能语法 / 不写自定义会话事件）。
3. **不重复实现 resolver**：插件仍然只消费 `vibe-stack resolve --json [--mode vibestack]`；不扫描能力组、不解析 frontmatter、不选版本。新增字段由 resolver 输出，插件只做映射。
4. **不新增第三方运行时依赖**：JS 侧只用 Node 内置与 DSH 运行时装好的 React。
5. **破坏性变更允许**：命名空间化会让现有 `/caveman`、`/auto-git-commit` 失效，按 §6.4 迁移；R7–R10 进一步把 Core 设为 VibeStack 模式的常驻基底。
6. **Core 常驻只属于 VibeStack 模式**：`vibe-stack resolve` 默认的 `project` 模式语义不变，避免影响其他适配器与既有脚本。
7. **子会话不新增委派入口**：R10 只要求子 Agent 会话继承同一份并集名册，不注册新的 subagent 委派工具，也不发布动态 preset。

---

## 2. 需求到设计的映射

| 编号 | 需求 | 设计落点 | 主要改动 |
| --- | --- | --- | --- |
| R1 | 删除 OpenCode | §4 | 删目录、改文档、CLI / skill / 能力组清理 |
| R2 | Command = 快捷提示词，与 DSH 命令共存 | §5 | 命令注册 + `followup` + 模型层应用 + 失败码 |
| R3 | `/` 调用命名空间 `VibeStack-{group}-{name}` | §6 | 名称规范化、显示名、冲突与迁移 |
| R4 | 模型中间层（定义 / 设置面板 / 会话选择 / 三处引用） | §7 | 层存储、`ctx.vibestack` service、设置页、composer 选择位、resolve v2 |
| R5 | 现状审计与修正 | §8 | 规范偏差、重复造轮子、跨项目泄漏等逐条修改 |
| R6 | 架构支撑（core 行 / service / 设置页） | §9 | 根级 `vibestack-core` 行 + preset 行 + resolve v2 |
| R7 | Core 为特殊能力组（VibeStack 模式无条件应用） | §16 | resolve `--mode vibestack`、v2 `mode` 字段、插件 `planUsable` |
| R8 | custom 系列 skill 独立为能力组开发能力组 | §17 | 新 `group-forge` 领域组；Core 移除 `custom-*` |
| R9 | Agent / 命令 / 技能列表 = Core + 工作区并集 | §18 | 命名空间、`group` 字段、当前工作区校验 |
| R10 | 子 Agent 会话名册 = Core + 工作区并集 | §19 | 同一 preset / 同一份 plan；不新增委派工具 |

---

## 3. 决定命名方案的 DSH 事实

| 事实 | 证据 | 对命名的影响 |
| --- | --- | --- |
| 命令名语法 `/^[a-z][a-z0-9_-]*$/`，斜杠解析同样只认小写 | `dsh-commands` 源码：`COMMAND_NAME` 与 `execute()` 的正则 | `VibeStack-core-foo` **无法注册、也无法被解析** |
| 重复命令名在同层注册会抛错 | 同上：`NamedEntries` 重名错误 | 必须靠前缀避免与其他插件/内置命令撞名 |
| skill 名语法 kebab：`/^[a-z0-9]+(?:-[a-z0-9]+)*$/`，非法名加载返回 `undefined` | `dsh-skill` 源码：`SKILL_NAME` | skill 名不能有下划线、不能有大写 |
| 用户 `/name` 调 skill 是**用户文本 token 扫描**，不是命令注册 | `dsh-tool-skill` README：`/name` 手势 pre-step 监听 | skill 与命令同名时，命令会先吃掉该行；命名空间必须同时覆盖两者 |
| 模型选择是**会话级**、由客户端发起 | `dsh-client-ui-model-selection` README + `ctx.modelDirectories` 服务 | 插件不能"给某条消息换模型"；只能切换会话路由，从下一请求生效 |
| Host 也可写会话模型（命令/钩子） | Host `sessionController.selectModel({sessionId, provider, model, reasoningEffort?})` | 命令 handler 可以在投递提示词前应用层 |
| 子 Agent 会话不公开模型选择 | model-selection README：「已寻址 subagent 会话不公开任一入口」 | HNFlow 节点要用 `agentOptions` 在 spawn 时指定路由，不能事后再选 |
| 不能写自定义会话事件 | 既有踩坑：未知事件类型必须 `ignorable`，活跃会话无法设置 | 层的"当前选择"不能靠插件自有事件持久化，必须可派生 |

**结论（R3 的硬约束）**：`VibeStack-{能力组}-{名称}` 只能落地为 **`vibestack-<group>-<name>`**。
显示层（插件自己的菜单/设置页/文档）可以用 `VibeStack · <group> · <name>`，但 DSH 的命令列表、技能目录、输入框补全里必然是 DSH 语法允许的那个字符串。

---

## 4. R1：删除 OpenCode

### 4.1 删除

| 路径 | 动作 |
| --- | --- |
| `plugins/opencode/`（`plugin.json`、`index.ts`、`index.test.ts`、`skills/vibestack/SKILL.md`） | 整目录删除 |
| `plugins/README.md` §2 的 opencode 示例、§6 OpenCode 映射表、§9 `cd plugins/opencode && bun test`、§10 末尾「当前适配器：`opencode`」 | 改写 |
| `README.md` 安装段、项目部署段、Agent 插件段、CLI 段、开发段 | 全部改为 DSH（`dsh plugin --profile desktop add <path>`） |
| `AGENTS.md` 规则 3 / 8 / 47、测试段 `cd plugins/opencode && bun test` | 改写；「OpenCode 插件使用 config hook」整条删除 |
| `docs/architecture.md` §7 与 §7 的 OpenCode 适配小节 | 改为 DSH 适配小节（或直接指向本文） |
| CLI `vibe-stack plugin install <agent>` | 退场：DSH 由 `dsh plugin add` 安装，复制式安装没有目标；保留 `plugin list` / `plugin status` 做适配器自省，或整体移除 |
| `.github` 中引用 opencode 的 CI 步骤（如有） | 删除 |

### 4.2 能力组内容清理

- `compatibility: opencode`（`markitdown`、`video-transcribe-*`、`start-work` 等 4 处）→ 删除该字段（当前 resolver 只禁止 `metadata`，其他字段被忽略）；如要保留语义，改成 `compatibility: dsh`。
- `data-forge/SKILL.md` 中「通常由 OpenCode 插件自动加载」→ 改为「由 DSH 插件挂载」。
- `multi-agent-collaboration/agents/sisyphus.md` 的「OpenCode AI 编排器」→ 改为「AI 编排器」（人设文本，不影响解析）。
- `photoshop/references/方案.md` 是历史参考资料，**不改**；但在文件头标注「历史方案，工具名已过时」。

### 4.3 需要一并定的边界

- `stack.json` 的 `agents: ["opencode"]` 字段：只有 DSH 后它没有含义。方案：标记为**已废弃**，resolver 继续接受但忽略，文档写明；下一版 stack schema 再删。
- `plugins/dsh/plugin.json` 没有 `install` 字段（DSH 不需要复制安装）：保留清单，用于 `vibe-stack plugin list/status` 自省。

### 4.4 实施记录（2026-11-07）

| 项 | 结果 |
| --- | --- |
| `plugins/opencode/` | 已删除；`plugins/` 只剩 `dsh` |
| `vibe-stack plugin install` | 已退场；`plugin list/status` 保留为自省 |
| `plugins/README.md` / 根 `README.md` / `AGENTS.md` / `docs/architecture.md` | 全部改写为 DSH |
| `compatibility: opencode` | 4 处已删除（`markitdown`、`start-work`、`video-transcribe-fast/full`） |
| `data-forge` / `sisyphus` / `photoshop-generate` | 文案改为 DSH 或中性表述 |
| `photoshop/references/方案.md` | 文件头已标注历史资料，内容未改 |
| 仓库测试 | 移除 OpenCode 测试；新增 DSH 适配器清单/状态测试 |

> 工具包 `tools/data-forge/0.2.1/.gitignore` 是已发布版本内的历史注释，按版本不可变规则
> 未修改；全仓 grep 检查时可把它与 `docs/`、`photoshop/references/` 一并视为历史资料。

---

## 5. R2：命令 = 快捷提示词

### 5.1 两种命令的语义区分

| | DSH 原生命令 | VibeStack 命令（本次语义） |
| --- | --- | --- |
| 注册者 | 插件 `ctx.commands.register()` | 本插件按能力组批量注册 |
| 形式 | `/{name} [args]` | `/vibestack-<group>-<name> [args]` |
| 行为 | 执行宿主逻辑（切人设、改模型、开面板…） | **把命令文件正文渲染成一段提示词，作为用户回合投给会话** |
| 等价物 | 程序入口 | OpenCode 的 command：用户的"快捷提示词" |
| 共存 | 两者都在 `/` 补全里；前缀不同，互不遮蔽 | 同左 |

### 5.2 命令文件格式

沿用现有 frontmatter，只增加 `model`：

```markdown
---
name: auto-git-commit
description: commit 当前项目变更（含 submodules 支持）
model: fast            # 可选：模型中间层 id（见 §7）
agent: Athena          # 可选：保留字段，本适配器不消费（见 §5.5）
---

根据当前项目的 Git 变更，写出规范的 commit message 并提交，**不推送**到远程。
参数：$ARGUMENTS
```

- 正文 = 模板；支持 `$ARGUMENTS` 与 `$1`..`$9`。
- 明确**不支持** `` !`cmd` `` 与 `@file`（当前实现如此）：DSH 侧没有"命令预展开"阶段，展开会变成插件偷偷执行 shell/读文件，破坏"插件只做映射"的边界。需要外部信息时，让模型在回合内用工具读取。
- 命令名在能力组中可以任意写法，插件侧会规范化（§6）。

### 5.3 执行路径

```
用户输入 /vibestack-core-auto-git-commit 修改登录页
  → DSH 命令执行器记录 command/run，调用 handler
  → handler：
      1. 校验"该命令属于当前项目"（§8.2 P1-3）
      2. 若声明了 model：sessionController.selectModel({sessionId, ...layer})
      3. 渲染模板（$ARGUMENTS / $1..$9）
      4. agent.followup(createUserMessage(text))
      5. 返回 { kind: 'success', text: 'VibeStack: 已发送 …' }
  → 会话开始一个新回合，模型看到的就是这段提示词
```

- **用 `followup()` 而不是 `steer()`**：`followup` 排队"下一个回合"并唤醒驱动器；`steer` 提交"下一步输入"。快捷提示词是用户想开一个新回合，语义应是 `followup`（DSH 官方文档亦如此区分）。
- 命令参数原样保留（引号、换行、空格），渲染只做占位符替换。
- 返回值只给一行提示，不把模板回显进会话（避免重复 token）。

### 5.4 与 DSH 原生命令共存

- 全部能力组命令带 `vibestack-` 前缀，与内置（`/model`、`/permission`、`/compact`…）和其他插件的命令不可能撞名。
- 注册前用插件自己的已注册名集合去重（注册阶段没有可用的 Agent 句柄，不能调 `find`）；handler 内可用 `ctx.commands.find(agent, name)` 复核命中的是否仍是本插件注册的定义。注册失败只 warn 并**在设置页显示"未生效命令"**，不静默吞掉。
- 插件自己的管理命令（`/vibestack-agent`、`/vibestack-model`、`/vibestack-models`）同样带前缀；不带前缀的名字留给 DSH 与未来插件。

### 5.5 明确不做的

- **不消费 `agent:` 字段**：DSH 的"agent"= preset，会话进行中不可切换；VibeStack 的 Agent 只是人设注入，不是执行主体。命令里指定 agent 没有可靠语义，文档标注为保留字段（resolver 继续解析、插件忽略并 debug 日志）。
- 不执行 shell、不展开文件、不做模板条件/循环（保持"模板 + 参数"，避免变成通用脚本语言）。
- 不把命令内容写进系统提示词（只在调用时投递）。

---

## 6. R3：命名空间

### 6.1 生成规则

```
canonical = "vibestack-" + slug(group) + "-" + slug(name)
slug(x)   = lowercase(x) → 空格/下划线/非法字符 → "-" → 折叠连续 "-" → 去首尾 "-"
约束      = 匹配 /^[a-z][a-z0-9-]*$/，长度自设上限 48（原插件对命令名的 64 字符检查保留作为兜底）
```

- 例：`core` + `auto-git-commit` → `vibestack-core-auto-git-commit`；`multi-agent-collaboration` + `start-work` → `vibestack-multi-agent-collaboration-start-work`（过长时保留组名首段 + 短 hash：`vibestack-multi-…-3f2a`，见 §6.3）。
- 同一能力组内，命令与 skill 若规范化后同名：**命令优先**（DSH 先解析命令），skill 仍可被模型用 `skill` 工具加载；插件在加载时 warn 一次（`name-collision`）。
- 显示名：插件菜单、设置页、错误信息里用 `VibeStack · <group> · <name>`；DSH 的命令列表/技能目录无法显示别名，只能是 canonical。

### 6.2 为什么不能保留大写

见 §3：DSH 命令名与斜杠解析都是小写语法；skill 名是 kebab。`VibeStack-core-foo` 既注册不上，也解析不到。**这是 DSH 的硬约束，不是风格选择。**

### 6.3 冲突与截断

| 情况 | 处理 |
| --- | --- |
| slug 后与已注册名冲突（不同组、同名） | 追加 `-<6位hash>`；hash 输入 = `group + "/" + name` |
| 长度 > 48 | 组名保留前 12 字符 + `-` + 名称，超出再截断并加 hash |
| 规范化后为空（纯符号名） | 丢弃并 warn `name-unusable` |
| 与内置命令同名（去掉前缀后仍冲突） | 前缀已避免；若用户配置自定义前缀导致冲突，注册失败 → warn + 设置页可见 |

### 6.4 迁移

- 旧短名（`/caveman`、`/auto-git-commit`）**不再注册**。README 与插件 skill 里给出一张"旧名 → 新名"的对照和一句话迁移提示。
- 可选配置 `legacyAliases: false`（默认关）：开启时对每个命令额外尝试注册旧短名，**只在名字空闲时**注册，撞名即跳过并 warn。自用场景可开，但默认不制造冲突面。
- skill 的 `/name` 迁移同理：能力组 skill 的 model 目录名不变，但 DSH 侧名称变成 canonical；SKILL.md 里的自述（如「invokes /caveman」）需要改成新名。

### 6.5 失败码

| code | 含义 |
| --- | --- |
| `name-unusable` | 规范化后为空或非法 |
| `name-collision` | 同组命令/skill 同名（命令优先） |
| `command-register-failed` | DSH 注册抛错（保留原始 message） |
| `legacy-alias-skipped` | 旧短名已被占用 |

---

## 7. R4：模型中间层

### 7.1 数据模型

**层（layer）= 一个具名路由**，只存 DSH 能消费的三元组，不含凭据：

```jsonc
// ~/.config/vibestack/config.json（VibeStack 全局配置，schema_version 2）
{
  "schema_version": 2,
  "repository": "D:/workspace/VibeStack",
  "core": { "name": "core", "version": "0.1.0" },
  "models": {
    "default": "strong",              // 可选：VibeStack 会话首次挂载时的默认层
    "layers": [
      { "id": "fast",   "label": "快速",   "provider": "deepseek-account",
        "model": "deepseek-flash",   "reasoningEffort": "low",
        "description": "检索、改文件、跑测试" },
      { "id": "strong", "label": "深度",   "provider": "deepseek-account",
        "model": "deepseek-pro",     "reasoningEffort": "high",
        "description": "设计、评审、长链推理" }
    ]
  }
}
```

- `id`：`/^[a-z0-9][a-z0-9_-]*$/`，≤ 32，唯一；被 `model:` 字段引用。
- `provider` / `model`：DSH 的 provider id 与模型 id（`sessionController.modelCatalog()` 的取值）。
- `reasoningEffort`：可选；模型不发布该强度时忽略并 warn。
- **层是用户配置，不是能力组内容**：能力组只有 `model: <layer id>`，永远不出现 provider/model/温度。这样能力组保持可共享，模型路由留在本机（也保住 AGENTS 规则 11 的意图）。
- **通用回退层**：用户没有配置任何层时，服务提供内置 `flash`
  （`deepseek-account / deepseek-flash`，标签「DeepSeek Flash（通用）」）并设为默认；一旦用户
  配置了层，就不再注入该回退。

### 7.2 设置面板

- 客户端在 `settings.section` 注册一页「VibeStack · 模型层」：列表 + 新增/编辑/删除/设默认。
- 数据读写走 Host 注册的 exact Fetch 路由：
  - `GET /api/vibestack/models` → `{layers, default, warnings, catalog?}`（`catalog` 标记 available / unroutable）
  - `POST /api/vibestack/models` → 校验 + 原子写 `~/.config/vibestack/config.json`
- **不接管 DSH 的模型设置页**，也不写 `cordis.patch.yml`：那属于用户 profile，插件改它会扩大爆炸半径；VibeStack 已有自己的全局配置约定（`~/.config/vibestack/config.json`）。
- 写入前校验：id 语法/唯一、provider/model 非空、`default` 必须指向已有层。provider/model 是否在 catalog 内由 `ctx.vibestack.catalog()` 诊断（离线/账号退登时不阻止保存）。

### 7.3 会话模型选择位（composer）

需求：VibeStack 模式下，右下角模型选择改为"层"的选择。

| 方案 | 做法 | 评价 |
| --- | --- | --- |
| **A（默认 `replace`）** | 在 `conversation.input.model`（single）用 priority -1 注册；VibeStack 会话显示层，其它会话回退实时原生目录（`directory.store.groups`） | 满足“右下角模型位改为层选择”；组件在其它模式仍提供原生模型选择 |
| **B（兼容 `additive`）** | 不遮蔽：在 `conversation.input.left` 加层控件；内置模型选择位保留 | 零遮蔽风险，但左下角会多出一个控件 |
| 配置 | `modelSelector` 取 `replace` 或 `additive`，默认 `replace`；切换需重启后生效 | 可运维 |

> DSH 的 `single` 槽位允许“不同 priority 遮蔽”，但注册本身是全局的。`replace` 组件
> 在非 VibeStack 会话渲染原生目录，因此默认启用；`additive` 仅作为兼容回退。
> **左下角始终保留 Agent 选择**，模型层不再放在左侧。

方案 A 的边界（写进实现约束）：

1. **不重造模型列表**：路由仍走 `ctx.modelDirectories.directoryFor(sessionId).select({provider, model, reasoningEffort})`；层的 `provider/model` 只是预置。
2. 菜单内容 = 层列表 + 分隔线 + 「跟随 DSH 模型」分组；「跟随」分组直接展开目录快照里的原生 provider/model 列表（`directory.store.getSnapshot().groups`），选中同样只调用 `.select`，**不自己维护模型目录**。
3. **当前层不单独持久化**：由会话当前路由反查——命中某层就显示该层，未命中显示「未映射 · <provider/model>」。这样 `/model` 手动切换、DSH 默认模型、恢复会话都不会出现两份真相。
4. 空白会话首次挂载时，若配置了 `models.default` 则应用一次（可通过 `default: null` 关闭）。
5. 子 Agent 会话不渲染（与内置行为一致）；`replace` 只在普通会话生效。
6. 键盘/可达性：至少支持 ↑/↓、Enter、Escape、焦点归还；不承诺模糊搜索（层通常 < 10 个）。

### 7.4 三处引用：agent / skill / command

resolve v2 为三者输出 `model`（可空字符串=未指定）。生效时机：

| 来源 | 谁触发 | 生效方式 | 何时生效 |
| --- | --- | --- | --- |
| **Agent（人设）** | 用户在 Agent 菜单选择 → `/vibestack-agent <name>` handler | handler 内 `sessionController.selectModel` | 下一请求起（人设段在下一步注入） |
| **Command** | 用户输入 `/vibestack-…` → handler | handler 内先选模型再 `followup` | 新回合的第一个请求 |
| **Skill（用户 `/` 调用）** | `dsh-tool-skill` 的手势监听把 skill 内容注入该步骤 | 本插件的 `agent/pre-step` 扫描本步用户消息里的 `/vibestack-…`，查到该 skill 的层后 `selectModel` | 尽可能同回合；受监听顺序影响时下一回合生效（文档如实写） |
| **Skill（模型调用 `skill` 工具）** | 模型 | **不切换**（工具执行中换路由无定义语义） | 仅作为 skill 正文里的一句提示（可选），不改变会话 |

**已实施**：三类来源都通过 `applyModelFor()` 调用 `sessionController.selectModel`；失败只
`warn`，不阻断提示词投递或人设切换。空白 VibeStack 会话首次 pre-step 还会应用一次
`models.default`（已有模型选择的会话不覆盖）。

原则：**层只影响路由，不影响工具、权限、沙箱**；切换失败不阻断提示词投递（命令照常发送，附一条 warn）。

### 7.5 与 DSH 原生模型能力的一致性

- `/model` 仍然可用（原生命令未移除）；手动切到某路由后，层选择器会显示匹配的层或「未映射」。
- 层的应用等价于用户自己点模型菜单：同一个 `selectModel`，同一份会话投影，不额外写状态。
- 不拦截、不包装 DSH 的模型请求；不实现自己的 provider 目录。

### 7.6 给 HNFlow（及其他插件）的接口

根级 `vibestack-core` 行注册一个 Cordis service：

```js
// 实际实现：ctx.provide('vibestack', service)（Core 行）
{
  apiVersion: 2,
  listLayers(),        // [{id,label,provider,model,reasoningEffort?,description?}]
  resolveLayer(id),    // 层对象或 undefined（不 throw）
  defaultLayer(),      // id 或 null
  hasModel(name),      // boolean
  reload(),            // 配置文件变更后重读（设置页 POST 后调用）
  catalog(signal),     // 可选：用 ctx.llm 标记 available / unroutable
}
```

- `ctx.get('vibestack')` 可选依赖；HNFlow 强依赖时在启动检查 `apiVersion >= 2`，缺失即拒绝发布/运行带 `model` 的流程。
- 服务只暴露**解析结果**，不暴露文件路径与写方法；写只经设置页路由（内部符号 seam）。
- 版本门槛：`engines.dsh` 保持 `>=0.2.1-0 <0.3.0`；插件 `version` 升到 `0.4.0`（模型层与命名空间累积变更）。

### 7.7 失败与降级

| 情况 | 行为 |
| --- | --- |
| `model:` 引用了未定义的层 | 应用时 warn `layer-unknown`；`vibestack-layer` 列表不显示该层；命令/人设照常工作（不切模型） |
| 层存在但 provider/model 不在 catalog | `catalog()` 标记 `unroutable`；实际 `selectModel` 失败时返回 `layer-unroutable` 并 warn |
| 账号退登 / 凭据缺失 | 保留层定义；不删配置；选择失败只告警 |
| `/model` 手动切到未映射路由 | 右下角模型位显示「未映射」，不强行套层 |
| 设置页写入失败 | 返回 `{ok:false, code, warnings}`；不部分写入（临时文件 + 原子替换） |
| DSH 槽位变更导致 `replace` 行为变化 | 当前只用 `additive`，不遮蔽原生模型选择 |

### 7.8 安全与隐私

- 层定义**只含** provider / model / reasoningEffort / 展示文案；凭据始终在 DSH 的 credentials/账户体系里。
- 不把层写进能力组、不写进项目 `.vibestack/`、不写进会话日志。
- 设置页路由与 DSH 的 fetch 路由一样受 Host/Origin 与浏览器凭据校验（`ctx.connection.fetch`）。

---

## 8. 现状审计

### 8.1 已符合 DSH 规范（保留）

| 项 | 依据 |
| --- | --- |
| preset 作用域内注册、卸载自动清理 | 全部走 `ctx.inject` / `ctx.effect` / `ctx.on` |
| 失败开放（CLI 缺失、坏 JSON、超时只告警） | `lib/resolve.js`、`index.js` 的 warn 包裹 |
| 只消费 `resolve`，不自解析能力组 | `lib/resolve.js` 是唯一边界 |
| 不写自定义会话事件；人设选择借 `command/run` | `lib/agents.js` 注释与投影实现 |
| 不修改项目/能力组/Agent 主配置 | 只读 resolve |
| 客户端 bundle 手写、零构建、只用 react/react-dom | `client.js` |
| `engines.dsh` / `peerDependencies` 已声明 | `package.json` |

### 8.2 问题与修改方案

> 优先级：P1 = 会造成错误或需求不可实现；P2 = 规范偏差或重复劳动。

| 编号 | 问题 | 证据 | 修改方案 |
| --- | --- | --- | --- |
| P1-1 | 命令/skill 未命名空间化 | `lib/commands.js` 直接用 resolve 的 `name`；`lib/skills.js` 直接用能力组 skill 名 | 按 §6 生成 canonical 名；命令注册与 skill 候选名都用 canonical；DSH 侧不再出现裸名 |
| P1-2 | 命令 handler 用 `steer()` | `index.js` `syncCommands` | 改为 `followup()`；`steer` 只保留给"在当前步骤插入提醒"的内部用途 |
| P1-3 | 命令 handler 不校验"命令属于当前项目"，存在跨项目泄漏 | `state.commands` 只增不减；handler 用当前 cwd 的 plan 渲染模板，但没校验该命令是否在**当前** plan 里 | handler 先取当前 project 的 plan，确认 canonical 名存在；不存在则返回 `{kind:'error', text:'该命令不属于当前项目'}` 并且不投递；项目切换时把已注册但当前不存在的命令在设置页标灰（DSH 不支持按会话卸载命令） |
| P1-4 | 没有导出 `Config` schema | `index.js` 只用 `rawConfig`；`lib/config.js` 手写合并 | 导出 `Config`（`@deepseek-ai/schemastery` 的 `z.object(...)`），字段覆盖 §9.3；保留 `resolveConfig()` 做防御性默认值（兼容老 profile） |
| P1-5 | 没有 host service，HNFlow 无法消费层 | 当前只有 preset 行 + `host:false` 的 UI 行 | 新增根级 `vibestack-core` 行注册 `ctx.vibestack`（§9）；preset 行改为消费该服务 |
| P1-6 | skill 名在 DSH 里无法带大写前缀 | §3 skill 语法 | 同 P1-1；文档与 skill 自述同步改 |
| P2-1 | 复制了 `createUserMessage` | `lib/messages.js` 用 `randomUUID` 重造 | 改为从 `@deepseek-ai/dsh-llm` 取 `createUserMessage`（HNFlow 已有 `loadHarnessModule` 先例）；测试里注入 fake |
| P2-2 | 自行实现命令名语法并静默丢弃 | `lib/commands.js` `validCommandName` 过滤，无告警 | 保留"预校验"（避免 DSH 抛错打断整批注册），但丢弃必须 warn + 计数，设置页可见 |
| P2-3 | 插件自带 skill 用正则解析 frontmatter | `lib/skills.js` `readSkillFile` | 可接受（只解析自己仓库内的文件）；加注释说明"不用于能力组"，避免被误用 |
| P2-4 | 人设选择靠 `command/run` 承载 | `lib/agents.js` | **保留**（DSH 不允许自定义事件）；在文档里明确这是刻意设计，并补一条测试断言"插件不追加任何自有事件" |
| P2-5 | 客户端手写菜单/定位/键盘 | `client.js` | 可接受（原生 Menu 未对第三方导出菜单容器）；但**模型层选择器不重写模型列表**，只调用 `modelDirectories`（§7.3） |
| P2-6 | 计划缓存只对 `stack.json` mtime 敏感 | `lib/plans.js` `stackStamp` | 已知限制：改能力组内容后需等 `stack.json` 变更或重启；文档写明；可选增强为对 `resolve.fingerprint` 采样（新增配置 `fingerprintTtlMs`） |
| P2-7 | 每个 pre-step 都做注入/同步判断 | `index.js` `prepare` | 现状有 digest 短路，成本可接受；新增的命名空间与层解析复用同一份 plan 缓存，不额外起子进程 |
| P2-8 | `plugin.json` 的 `install` 字段与 DSH 无关 | `plugins/dsh/plugin.json` 无 install，CLI 的 install 却仍在 | §4 的 CLI 退场一并解决 |
| P2-9 | skill rank 硬编码 250 | `lib/skills.js` `SKILL_RANK` | 提为配置 `skillRank`（默认 250），便于与用户自定义 skill 根排序 |
| P2-10 | resolver 不校验命令名语法 | `resolve.py` 只校验非空 | 在 resolver 增加 `name` 语法与长度校验（warn 并跳过），避免坏名字穿过到 adapter |

### 8.3 本次已处理（R1、R7–R10 相关）

| 条目 | 处理结果 |
| --- | --- |
| P1-1 / P1-6 命名空间化 | 新增 `lib/names.js`；命令注册名、skill 候选名统一为 `vibestack-<group>-<name>`；超长名截断 + 6 位 hash |
| P1-2 `steer()` | 命令 handler 改为 `agent.followup()`；仅当宿主没有 `followup` 时才回退 `steer` |
| P1-3 跨项目泄漏 | handler 每次执行前重新 `resolve` 当前工作区，按 canonical 名在**当前**计划中查找；不存在返回 `不属于当前工作区`，不投递 |
| P2-2 坏名静默丢弃 | `commandEntries` / `skillCandidates` 接收 warnings 收集器，非法名与同名冲突写入宿主日志（去重） |
| P2-9 skill rank | 提为配置 `skillRank`（默认 250） |
| R7 Core 常驻 | resolve 新增 `--mode vibestack`、`schema_version 2` 与 `mode` 字段；插件默认 `resolveMode: vibestack`，`planUsable()` 接受 Core-only 计划 |
| R8 group-forge | Core 移除 6 个 `custom-*` 技能；新领域组 `group-forge` 增加 `custom-group`、规则、`Hephaestus` Agent 与 `group-new` / `group-validate` 命令 |
| R9 并集列表 | 名册每行带 `group`（projection v3）；Agent 菜单显示来源组；命令、技能按并集发布 |
| R10 子会话并集 | 子 Agent 会话沿用同一 preset 与 `agent/pre-step`，按同一份 Core + 工作区计划生成名册；新增回归测试 |
| P2-8 `plugin install` | CLI 的 `plugin install` 退场；`plugin list/status` 仅做自省；OpenCode 适配器删除 |
| P1-5 根级服务 | `vibestack-core` 行用 `ctx.provide('vibestack', service)` 注册模型层服务；preset 行通过 `ctx.get('vibestack')` 消费 |
| P2-1 `createUserMessage` | 优先通过 `loadHarnessModule('@deepseek-ai/dsh-llm')` 使用 harness 工厂；不可用时回退本地实现（测试路径） |
| P1-4 `Config` schema | 动态加载 `@deepseek-ai/schemastery` 并导出可选 `Config`；普通 Node 测试/降级组合下 schema 缺失，继续用 `resolveConfig()` |
| 模型层 | `lib/layers.js` / `lib/service.js` / `lib/models-route.js`；设置页；`vibestack-layer` 命令；agent / command / skill 三处应用；默认层 |
| 模型层 UI | 默认 `modelSelector: replace`：右下角 `conversation.input.model` 替换为层选择，非 VibeStack 会话回退原生目录；左下角只保留 Agent |

未处理（仍待后续里程碑）：GUI 手工验收（设置页、`replace` 模型位、`◈` 控件）。

### 8.4 不建议改的

- 人设段注入方式、rules 注入、MCP 动态挂载、client bundle 形态：都与 DSH 当前能力匹配，改动只增加风险。
- 不引入 `typert` Remote：设置页用 exact Fetch 路由已足够，且与现有做法一致（HNFlow 同样理由）。

---

## 9. 架构调整

### 9.1 行结构：core + preset + ui

已实现「根级 core 行 + 根级 client 行 + preset 行」：

```
根级（全局，任何会话都挂载）
├─ vibestack-core   host=true   服务 ctx.vibestack / 设置页后端路由 / 层文件读取
└─ vibestack-ui     host=false  客户端：Agent 菜单、模型层选择器、设置页

preset-vibestack（模式）
└─ vibestack        host=true   resolve、rules、skills、commands、MCP、人设段
                              通过 ctx.get('vibestack') 读层
```

- `vibestack-core` 与 `vibestack-ui` 是同一个包的两个行（沿用当前「同一包多行」的做法）；
  `role` 配置区分 `core` / `preset` / `ui`。
- 没有 core 行（老 profile）时：preset 行降级为"无层"模式（命令/人设的 `model` 被忽略并
  warn `layers-unavailable`），不阻塞会话。
- `cordis.patch.yml` 仍只 `insert`，不改任何现有行。
- Core 行用 `ctx.provide('vibestack', service)` 注册普通服务对象（不需要继承 Cordis
  `Service` 类），生命周期随 root fiber。
- R7 的 Core 常驻仍由 resolve 的 `--mode vibestack` 实现；core 行只负责模型层，不改变
  R7–R10 的并集规则。

### 9.2 服务契约

```js
// 只读面（对 HNFlow 与其他插件）
ctx.vibestack = {
  apiVersion: 2,
  listLayers(): Layer[],
  resolveLayer(id: string): Layer | undefined,
  defaultLayer(): string | null,
  hasModel(name: string): boolean,
  reload(): Promise<void>,
}
// Layer = { id, label, provider, model, reasoningEffort?, description? }
```

- **不暴露**文件路径、写方法、凭据。
- 设置页写入后调用 `reload()`；文件被外部改动时按 mtime 惰性重读。

### 9.3 配置 schema（新增字段）

| 字段 | 默认 | 含义 |
| --- | --- | --- |
| `resolveMode` | `'vibestack'` | **已实现**：`vibestack` Core 常驻；`project` 退回旧行为 |
| `namePrefix` | `'vibestack'` | **已实现**：命名空间前缀（改名需自行承担冲突） |
| `maxCommandNameLength` | `48` | **已实现**：超长截断 + hash |
| `skillRank` | `250` | **已实现**：skill 候选 rank |
| `role` | `'preset'` | **已实现**：`core` / `preset` / `ui` |
| `modelsFile` | `''` | **core 行**：层定义文件；空则用全局配置 `~/.config/vibestack/config.json` 的 `models` 段 |
| `modelSelector` | `'replace'` | **core 行**：`replace` 右下角原生模型位替换为层选择（非 VibeStack 回退原生目录）；`additive` 保留原生位并加左侧控件 |
| `applyModelOnCommand` | `true` | **已实现**：命令声明 `model` 时切换会话模型 |
| `applyModelOnAgent` | `true` | **已实现**：切换人设时应用其层 |
| `applyModelOnSkill` | `true` | **已实现**：用户 `/skill` 调用时应用其层（同回合尽力而为） |
| `applyDefaultLayer` | `true` | **已实现**：空白会话首次 pre-step 应用 `models.default` |
| `legacyAliases` | `false` | 仅当旧短名空闲时额外注册（后续） |

（`Config` 用 schemastery 定义，非法值回落默认；现有 `host/command/timeoutMs/rules/skills/commands/agents/mcp/maxRulesBytes/defaultAgent` 保持不变。）

### 9.4 目录变化

```text
plugins/dsh/
├─ index.js            # 三种角色：core / preset / ui
├─ lib/
│  ├─ service.js       # 新增：VibeStackService（层）
│  ├─ layers.js        # 新增：层加载/校验/原子写
│  ├─ names.js         # 新增：命名空间规范化/去重
│  ├─ models-route.js  # 新增：GET/POST /api/vibestack/models
│  ├─ commands.js      # 改：canonical 名、告警、followup
│  ├─ agents.js        # 改：投影里带 layer；选择时应用
│  ├─ skills.js        # 改：canonical 名 + model 透传
│  ├─ resolve.js       # 改：schema_version 2、model 字段
│  ├─ plan.js          # 新增：planUsable（active 与 vibestack 模式）
│  ├─ config.js        # 改：配置合并 + role/模型层字段
│  └─ …
├─ client.js           # 改：Agent 菜单 + 模型层选择器 + 设置页
└─ skills/vibestack/   # 改：新命名、层用法、迁移说明
```

---

## 10. resolve API v2

### 10.1 变更（只做加法）

| 字段 | v1 | v2 |
| --- | --- | --- |
| `schema_version` | 1 | 2 |
| `mode` | — | `project` / `vibestack`（M7 已实现） |
| `active` | 是否有 stack | `vibestack` 模式下始终 `true`（M7 已实现） |
| `agents.*.model` | — | 可选 string（层 id，已实现） |
| `commands.*.model` | — | 可选 string（已实现） |
| `skills[].model` | — | 可选 string（已实现） |
| `skills[].description` | 已有 | 保持 |
| 校验 | 命令名只校验非空 | 增加命令名语法/长度校验（warn 跳过）；`model` 只校验语法，不校验"层是否存在"（层在用户配置里，resolver 看不到） |

> v2 的 `mode` 字段用于 R7；`model` 字段已由 resolver 输出，并由插件的模型层服务消费。

### 10.2 兼容

- 只有一种形状：`schema_version` 恒为 `2`，插件校验 `== 2`，不兼容时只加载默认技能。
- 没有版本协商参数；旧 `--api-version` 与 v1 形状已删除，旧内容通过改写迁移。
- `docs/resolve-api.md` 与 `plugins/README.md` 的注入计划示例保持同步，含模块字段与 `names` 映射。

### 10.3 能力组侧规则

- `model` 值必须是**层 id 语法**（`^[a-z0-9][a-z0-9_-]*$`）；resolver 校验语法并 warn，不解析语义。
- 能力组**不得**出现 provider/model/温度/权限（保持 AGENTS 规则 11）。
- 同名命令/skill 的 `model` 以最后加载者为准（与现有覆盖规则一致）。

---

## 11. 文件与数据布局

```text
~/.config/vibestack/
├─ config.json          # 既有全局配置 + 新增 models 段（schema_version 2）
└─ models.json          # 可选：层定义独立文件（modelsFile 指向时）

<project>/.vibestack/   # 不变
├─ stack.json
└─ lock.json

plugins/dsh/            # 本插件（不变 + 新增文件）
```

- 层文件写入：临时文件 + fsync + 原子替换；失败不破坏旧文件。
- 不写 `~/.dsh/`（除 DSH 自身需要），不写项目目录。

---

## 12. 里程碑

本次已实施（2026-11-07）：

| 里程碑 | 范围 | 验收 |
| --- | --- | --- |
| **M7** Core 常驻 + 并集 | resolve `--mode vibestack` / v2 `mode`；插件 `resolveMode`；`planUsable`；命名空间命令与技能；跨工作区校验；roster `group` | 无 stack 的目录仍有 Core；Agent / 命令 / 技能为 Core + 工作区并集；旧短名不再注册 |
| **M8** group-forge 拆组 | 6 个 `custom-*` 移出 Core；新增 `custom-group`、规则、`Hephaestus`、2 个命令；仓库 `stack.json` 激活 | `vibe-stack resolve --mode vibestack` 在仓库根目录无告警；Core 不含 `custom-*` |
| **M9** 子会话并集 | 同一 preset 下的子会话按同一份计划生成名册；不同 cwd 按子目录解析 | 父/子会话同 cwd 名册一致；子会话不写自有事件 |
| **M10** OpenCode 退场 | 删除 `plugins/opencode/`；CLI `plugin install` 退场；README / AGENTS / architecture / plugins README 改写；能力组文案清理 | `plugins/` 只剩 `dsh`；除历史资料外无 OpenCode 引用 |
| **M11** 模型层核心 + 模型位替换 | core 行 `ctx.vibestack`；层配置/原子写；设置页 GET/POST；`vibestack-layer`；Agent/命令/技能应用；右下角模型位替换（非 VibeStack 回退原生目录） | `resolveLayer('strong')` 可读；无层时内置 `flash`；三处来源均有测试 |

后续里程碑（模型中间层等，仍未实施）：

| 里程碑 | 范围 | 验收 |
| --- | --- | --- |
| **M0** 事实探针（0.5–1 天） | ① `conversation.input.model` 能否被第三方单例注册覆盖/共存；② `sessionController.selectModel` 在命令 handler 中对"随后 `followup` 的回合"是否生效；③ 用户 `/skill` 触发的 pre-step 中 `selectModel` 是否影响同回合；④ 设置页 Fetch 路由读写 | 四项有结论；③ 若只能下次回合生效，文档与实现按"次回合"写死 |
| **M1** resolve v2 剩余字段 | 已在 M11 完成（`model` 字段）；v1 形状与 `--api-version` 已删除 | `resolve --json` 输出唯一 v2 形状且有 `model` |
| **M2** 命名空间 + 命令语义 | `lib/names.js`、命令注册、skill 改名、`followup`、跨项目校验、失败码（已在 M7 完成） | 旧短名不再注册；两个能力组的同名命令不冲突；命令在正确项目才执行 |
| **M3** 模型层核心 | 已在 M11 实现（schemastery `Config` 仍待） | `ctx.get('vibestack').resolveLayer('strong')` 可读；坏配置不拖垮会话 |
| **M4** 会话选择器 | `additive` 默认；`replace` 可选遮蔽（priority -1，非 VibeStack 回退原生目录） | VibeStack 会话显示层名；切换后实际请求路由改变；切到其他模式仍有原生模型选择 |
| **M5** 三处引用生效 | 已在 M11 实现 | 三种来源各有一条端到端验证；未定义层只 warn 不中断 |
| **M6** 收尾 | skill 文本、README、plugins/README、architecture、AGENTS 同步；测试全绿 | `node test/*.test.js` 全绿；手工验收桌面版 + web profile |

---

## 13. 测试策略

1. **纯函数**：命名规范化（大小写/符号/超长/hash）、层校验、模板渲染、配置合并、resolve v1/v2 兼容。
2. **注册集成（内存 ctx）**：命令注册成功/重名/非法名/跨项目；skill 候选名与 model 透传；`followup` 被调用一次且文本正确。
3. **Core 常驻与并集**：无 stack 只含 Core；有 stack 时 Core + groups + extends；roster 带 `group`；技能/命令 canonical；跨工作区命令拒绝。
4. **子会话**：同一 cwd 父/子名册一致；不同 cwd 只含 Core；子会话不追加自有事件。
5. **服务**：`resolveLayer` / `reload` / 坏文件保留旧快照；设置页路由的 GET/POST、原子写、非法输入；`catalog()` 的 available/unroutable。
6. **客户端**：右下角模型位的层派生（命中/未映射）、只在 vibestack preset 出现层列表、其它模式回退原生目录；左侧只保留 Agent。
7. **回归**：现有 `plugin.test.js` 的"不写自有事件"断言；Agent 选择投影；MCP 同步；repair 脚本；group-forge 仓库级测试。
8. **手工**：桌面版与 web profile 各一遍：无 stack 目录进入 VibeStack 模式、Agent 菜单并集、`/vibestack-core-*` 与 `/vibestack-group-forge-*`、子会话名册。

---

## 14. 风险与开放问题

| 风险 | 影响 | 缓解 |
| --- | --- | --- |
| DSH rc 的槽位/服务签名变化 | 模型选择器或命令注册失效 | 探针脚本纳入回归；`replace` 失败回落 `additive`；`engines.dsh` 绑定次版本 |
| 遮蔽 `conversation.input.model` 与内置行为分叉 | 键盘/搜索/推理强度体验退化 | 当前用 `additive` 增量控件，不遮蔽；完整 `replace` 待解决“仅 VibeStack 会话遮蔽”后启用 |
| 全局 `single` 槽位无法按会话选择性遮蔽 | 根级 UI 行注册会同时影响标准模式 | 默认 `replace`；组件对非 VibeStack 会话渲染原生模型目录，`additive` 可回退 |
| 设置页写入与用户手动编辑并发 | 配置被覆盖 | 原子替换 + 写入前重读合并 `models` 段；其它段保留 |
| `models.default` 覆盖用户已有模型选择 | 新会话路由意外改变 | 仅首次 pre-step 且 `modelSelection` 投影为空时应用；`applyDefaultLayer: false` 可关闭 |
| 命名空间破坏旧习惯 | 用户输入旧名无效 | 迁移表 + `legacyAliases`（默认关） |
| 层 id 被能力组引用但本机没定义 | 命令/人设静默不切模型 | 明确 warn + 设置页"缺失层"列表；HNFlow 侧发布时 fail-loud |
| 同回合应用模型的时序不确定 | skill 层可能延后一回合 | M0 结论写入文档；UI 标注"从下一回合生效" |
| 命令跨项目泄漏修复不彻底 | 在 A 项目能看到 B 项目命令 | 注册无法按项目卸载 → handler 强校验 + 设置页标灰；文档说明这是 DSH 命令注册的边界 |
| 删除 OpenCode 遗漏文档 | 用户照旧文档误操作 | §4 清单逐项勾选；全仓 grep 门禁 |
| Core 常驻把所有 Core 规则/MCP 带进每个工作区 | 无 stack 的目录也会注入较长规则、挂载 Core MCP | `resolveMode: project` 可退回；`rules`/`mcp` 可单独关闭；Core 内容保持精简 |
| `group-forge` 未激活 | 用户找不到 `custom-*` 技能 | 文档与插件 skill 明确指引；VibeStack 仓库自身 `stack.json` 已激活 |
| 命令/技能改名破坏旧习惯 | 旧 `/caveman`、`/auto-git-commit` 失效 | 附录 C 迁移表；`legacyAliases` 仍保留为后续可选项 |
| 子会话 cwd 与父会话不同 | 子会话名册与父会话不同的并集 | 按“当前工作区”语义接受；文档写明；测试覆盖同一 cwd 与不同 cwd |
| 旧 CLI 不支持 `--mode` | 插件解析失败、会话无注入 | 失败开放 + 日志提示升级；`resolveMode` 可临时退回 `project` |

**开放问题（M0 回答）**：① 单例槽位覆盖的准确语义；② `selectModel` 与 `followup` 的时序；③ `/skill` 手势与 `selectModel` 的时序；④ 设置页 Fetch 路由在桌面版是否需要额外鉴权头（现有 HNFlow 路由可作参照）。

---

## 15. 决策记录

| 编号 | 问题 | 结论 |
| --- | --- | --- |
| D1 | 层定义存哪 | VibeStack 全局配置（`~/.config/vibestack/config.json` 的 `models` 段），不进能力组、不进项目 |
| D2 | 层里能放什么 | 只放 provider/model/reasoningEffort/展示文案；凭据归 DSH |
| D3 | 会话选择器如何实现 | 默认 `replace`：优先遮蔽 `conversation.input.model`，非 VibeStack 会话回退原生目录；左侧只保留 Agent；`additive` 为兼容回退 |
| D4 | 当前层如何持久化 | 不持久化，按会话当前路由反查；避免两份真相 |
| D5 | 命令名格式 | `vibestack-<group>-<name>` 小写 kebab；大写形式不可注册（DSH 语法） |
| D6 | 命令投递方式 | `followup()`（下一个回合），不用 `steer()` |
| D7 | 是否兼容旧短名 | 默认不注册；`legacyAliases` 可选且只在空闲时注册 |
| D8 | `agent:` 字段 | 保留解析、不消费（DSH 会话内不能切 preset） |
| D9 | HNFlow 如何拿层 | 根级 `ctx.vibestack` 服务，`apiVersion >= 2`；单向依赖 |
| D10 | OpenCode 适配器 | 删除；`plugins/` 只保留 `dsh`；`plugin install` CLI 退场 |
| D11 | 是否走官方审核 | 否，只自用；但技术契约（命令/技能语法、事件、生命周期）必须遵守 |
| D12 | Core 何时加载 | `project` 模式保持历史语义；`vibestack` 模式无条件加载 Core |
| D13 | `custom-*` 放哪 | 移入领域组 `group-forge`，并补 `custom-group`、规则、Agent 与命令 |
| D14 | 并集如何避免冲突 | 命令/技能命名空间化 `vibestack-<group>-<name>`；同名 Agent 后加载覆盖；命令优先于同名技能 |
| D15 | R10 是否新增委派工具 | 否；子 Agent 会话继承同一 preset 与同一份计划，按子会话 cwd 解析 |

---

## 16. R7：Core 是特殊能力组

### 16.1 语义

| 模式 | 触发者 | 无 `.vibestack/stack.json` 时 |
| --- | --- | --- |
| `project` | 其他适配器、脚本、默认 `vibe-stack resolve` | `active=false`，不加载 Core |
| `vibestack` | DSH 的 VibeStack 会话 | `active=true`，只含 Core；有 stack 时再并上领域组 |

Core 的版本来源：stack 的 `core` 优先；没有 stack（或 stack 未写 `core`）时用全局配置
`~/.config/vibestack/config.json` 的 `core`，再退回 `core@0.1.0`。配置的 Core 版本不存在
时，`vibestack` 模式回退到仓库中最新可用的 Core 并记一条 warning——Core 常驻不允许被
一个过期的版本引用打断。这样同一个 VibeStack 会话在任意工作区都有同一套基底规则、
Agent、命令、技能与 MCP。

### 16.2 resolve 契约

```bash
vibe-stack resolve --json --mode vibestack --project <cwd>
```

- `schema_version` 升到 `2`，新增 `mode: "project" | "vibestack"`。
- `mode=vibestack` 且无 stack 时，resolver 合成一个 `core=<全局 core>`、`groups=[]` 的
  临时 stack；不写项目文件，不创建 `.vibestack/`。
- `active` 在 `vibestack` 模式下始终为 `true`；`core` 一定非空（Core 缺失时记 warning）。
- 有 stack 时，领域组仍按 `groups` + `extends` 加载；不会因为“Core 常驻”而默认激活任何
  领域组。
- `fingerprint` 纳入 `mode`，模式切换会导致指纹变化。

### 16.3 插件行为

- 配置新增 `resolveMode`，默认 `vibestack`；显式设为 `project` 可退回旧行为。
- `lib/plan.js#planUsable()` 的判断顺序：`active === true` → `mode === 'vibestack'` →
  `core` 非空。`prepare`、人设段、Agent 选择命令、技能提供者都走这一判断。
- 旧 CLI 不认 `--mode` 时解析失败，插件失败开放（不注入、不阻断会话）并在日志提示升级；
  这比“悄悄退回无 Core”更可诊断。
- `PlanCache` 仍以 `.vibestack/stack.json` 的 `mtime:size` 为失效键；无 stack 的 Core-only
  计划会一直复用，改 Core 内容后需改 stack 或重启（已知限制，见 §8.2 P2-6）。

### 16.4 验收

1. 任意临时目录（无 `.vibestack/`）进入 VibeStack 模式：规则、Agent 菜单、Core 命令、
   Core 技能都出现。
2. 有 stack 且 `groups` 为空：只多出 Core，不出现任何领域组。
3. `--mode project` 对同一目录仍返回 `active=false`。
4. 旧 CLI / 坏 JSON / 超时：会话可继续，只有日志告警。

---

## 17. R8：`group-forge` 能力组

### 17.1 为什么拆

`custom-rule`、`custom-agent`、`custom-command`、`custom-skill`、`custom-tool`、
`custom-mcp` 是“制作能力组”的能力，不是每个会话都需要。放在 Core 会让所有 VibeStack
会话都看到这些技能，也会让 Core 的职责从“常驻基底”膨胀成“开发工具箱”。因此拆成领域组
`group-forge`，按项目激活。

### 17.2 内容

```text
capability-groups/domain/group-forge/0.1.0/
├── group.json
├── rules/group-authoring.md
├── agents/hephaestus.md
├── commands/group-new.md
├── commands/group-validate.md
└── skills/
    ├── custom-group/SKILL.md      # 新增：组这一层的制作指南
    ├── custom-agent/SKILL.md      # 从 Core 移入
    ├── custom-command/SKILL.md
    ├── custom-mcp/SKILL.md
    ├── custom-rule/SKILL.md
    ├── custom-skill/SKILL.md
    └── custom-tool/SKILL.md
```

- `custom-group` 补齐组级知识：Core/领域差异、目录边界、`group.json` 字段、GUID/版本、
  `extends`、激活与校验、常见错误。
- `Hephaestus`（`mode: all`）是能力组开发人设，负责“先定位、再写、写完验证”。
- `group-new` / `group-validate` 是命令模板；在 DSH 中分别发布为
  `/vibestack-group-forge-group-new` 与 `/vibestack-group-forge-group-validate`。
- 规则 `group-authoring` 只在 `group-forge` 激活时注入，约束目录、版本、校验与交付。

### 17.3 激活与版本

- `group-forge` 是领域组，不默认激活；本仓库自己的 `.vibestack/stack.json` 已加入
  `group-forge@0.1.0`，便于在仓库内开发能力组。
- 新组仍按领域组规则：`capability-groups/domain/<name>/<version>/`，`guid` 跨版本不变，
  已发布版本目录不修改。
- Core 不再包含任何 `custom-*` 技能；`capability-groups/core/0.1.0/skills/` 只保留
  `caveman`、`git-master`、`markitdown`、`to-html`。

### 17.4 验收

1. `vibe-stack info group-forge` 显示 7 个技能、1 个 Agent、2 个命令。
2. 未激活时，VibeStack 会话看不到 `custom-*` 技能；激活后技能名以
   `vibestack-group-forge-custom-*` 出现。
3. `vibe-stack resolve --mode vibestack` 在仓库根目录的输出含 `Hephaestus`、
   `group-new`、`group-validate`，且 `warnings` 为空。

---

## 18. R9：Agent / 命令 / 技能 = Core + 工作区并集

### 18.1 并集定义

对一次 VibeStack 会话：

```text
并集 = Core
     + stack.groups 中列出的领域组
     + 每个组的 extends 依赖（递归、按组名去重）
```

（VibeStack 模式下 Core 恒定存在；`project` 模式无 stack 时并集为空。）

并集是**按内容类型分别计算的**：Agent 取每个组的 `agents/`，命令取 `commands/`，技能取
`skills/`。每条内容在 resolve 输出里带 `group`，插件用它做命名空间和来源展示。

### 18.2 Agent 列表（左下角）

- 名册（roster）= 并集中的**全部** Agent，包括 `mode: subagent`；这样父/子会话都持有
  完整并集。
- 左下角人设菜单只显示 `mode != "subagent"` 的 Agent；`subagent`-only Agent 保留在名册中
  供子任务引用，投影层也不允许把它们选为人设。
- 默认选中 `Athena`（Core 常驻，因此默认总存在）；`defaultAgent` 可覆盖。
- 菜单每行显示 `Agent 名 + 来源组`；选择通过 `/vibestack-agent <name>` 写入
  `command/run`，投影跨重启保留。
- 同名 Agent 按加载顺序后加载覆盖；被覆盖的行只显示最终来源组。
- 名册随注入消息的 `source.roster` 发布；`roster` 增量包含 `group`，projection 版本升到 4
  （新增修复记录与首条名册前的选择）。切换人设不会重新注入规则。
- 模式选中时立即 `prime`：解析工作区并注册命令，但**不写会话日志**。DSH 的存储格式要求
  第一条 `system/message` 是受保护的 surface 头；在它之前追加任何 surface 事件都会让
  会话重启后报 `system/message requires a protected first surface head`。空白会话的
  Agent 菜单由根级只读路由 `GET /api/vibestack/roster?sessionId=...` 提供，首个
  `agent/pre-step` 再把同一条注入消息发布到 surface（按 digest/roster key 去重）。旧 CLI
  不支持 `--mode` 时解析失败，需 `uv tool install --force` 升级到 0.5.0+。

### 18.3 命令列表

- 发布名：`canonical = <namePrefix>-<slug(group)>-<slug(name)>`，默认
  `vibestack-<group>-<name>`；超过 `maxCommandNameLength`（默认 48）时截断并追加 6 位 hash。
- 注册：`ctx.commands.register({ name: canonical, ... })`。DSH 命令名只接受小写语法，
  因此不能用 `VibeStack-...` 或大写组名。
- 执行：
  1. 用当前会话 cwd 重新取计划（有缓存）；
  2. 在当前计划的 canonical 集合里找该命令；
  3. 找不到 → `{kind:'error', text:'不属于当前工作区'}`，不投递；
  4. 找到 → 渲染 `$ARGUMENTS` / `$1..$9`，用 `agent.followup()` 投递普通用户回合。
- 因此：Core 命令在任何 VibeStack 会话可执行；领域组命令只在当前工作区激活该组时可执行。
  DSH 不能按项目卸载命令，所以注册是全局的，校验放在 handler。
- 同名命令/技能：命令优先（DSH 先解析命令）；技能仍可被模型用 `skill` 工具加载，加载时
  warn 一次 `name-collision`。

### 18.4 技能列表

- 发布名：与命令相同的 canonical 规则；skill 语法是 kebab，canonical 满足。
- 技能目录仍指向能力组中的原路径；插件只读 `SKILL.md` 正文并剥离 frontmatter。
- 用户 `/vibestack-<group>-<name>` 与模型 `skill` 工具都使用 canonical 名。
- 同名技能按 canonical 去重；同一组内命令与技能同名时命令优先并告警。
- 插件自带的 `vibestack` 指引技能不加能力组前缀，保持稳定。

### 18.5 合并不变量

| 类型 | 规则 |
| --- | --- |
| 规则 | 追加，按路径去重 |
| 技能 | 追加，按 canonical 去重 |
| Agent | 同名后加载覆盖 |
| 命令 | 同名 canonical 后加载覆盖（通常只在同组同名时发生） |
| MCP | 同名 key 后加载覆盖 |

`source`、`group` 只用于诊断、命名空间和 UI，不写进 Agent 主配置。

### 18.6 验收

1. 只有 Core 的目录：菜单只有 Core Agent；命令只有 `vibestack-core-*`；技能只有
   Core 技能。
2. 激活 `group-forge` 后：菜单多出 `Hephaestus`，命令多出 `vibestack-group-forge-*`，
   技能多出 `vibestack-group-forge-custom-*`。
3. 在未激活 `group-forge` 的工作区执行 `vibestack-group-forge-group-new`：返回错误，
   不投递提示词。
4. 两个组有同名命令： canonical 不同，均能注册；不互相覆盖。
5. 旧短名（`/caveman`、`/auto-git-commit`）不再注册。

---

## 19. R10：子 Agent 会话的名册

### 19.1 机制

DSH 的 subagent（spawn / fork）子会话默认继承父会话的 preset；本插件挂在
`preset-vibestack` 内，因此子会话同样执行 `agent/pre-step`：

1. 子会话按自己的 cwd 取 `vibe-stack resolve --mode vibestack` 计划；
2. 用同一套 `planUsable` / `agentList` / `personaAgents` 生成名册；
3. 把名册放进注入消息 `source.roster`；子会话的人设菜单与父会话一致；
4. 子会话的 `systemPrompt` 人设段、命令注册、技能提供者也读同一份计划。

因此“会话自动指定 subagent 任务”时，子会话的 Agent / 命令 / 技能列表是
**Core + 子会话工作区并集**：名册包含全部 Agent（含 `mode: subagent`），人设菜单只展示
primary/all，命令与技能是同一份 canonical 并集。不需要额外工具或动态 preset。

### 19.2 cwd 规则

- subagent 未指定 `cwd`：继承父会话目录，名册与父会话完全相同。
- subagent 指定了 `cwd`：按该目录解析；Core 仍常驻，领域组取该目录的 `groups`。
- 这是“当前工作区”的自然语义；文档与 UI 不承诺子会话与父会话永远同名册。

### 19.3 不做的

- 不注册 `vibestack_subagent` 之类的委派工具；DSH 原生 `subagent` / `subagent_fork`
  保持原样。
- 不把 VibeStack Agent 动态发布成 DSH preset；Agent 仍是会话人设，不是 preset。
- 不向子会话写自定义事件；名册仍随 `user/message.source` 传递。

### 19.4 验收

1. 同一 cwd 的父/子会话：`source.roster.agents` 完全一致（含 `group`）。
2. 子会话切人设只影响子会话；不影响父会话投影。
3. 子会话 `cwd` 指向未激活领域组的目录：名册只有 Core。
4. `plugin.test.js` 断言子会话名册、投影状态与“不追加自有事件”。

---

## 20. 本次实施与验证

| 区域 | 变更 |
| --- | --- |
| resolver | `schema_version 2`、`mode`、`--mode vibestack`、Core 合成、fingerprint 纳入 mode |
| group-forge | 新领域组；6 个 `custom-*` 从 Core 移入；新增 `custom-group`、规则、Agent、2 个命令 |
| 插件 | `resolveMode` / `namePrefix` / `maxCommandNameLength` / `skillRank`；`lib/names.js`、`lib/plan.js`；canonical 命令与技能；`followup`；当前工作区校验；roster `group`（projection v3） |
| 客户端 | 左下角 Agent 菜单显示 primary/all Agent 与来源组；右下角模型位替换为层选择（非 VibeStack 回退原生）；设置页「VibeStack 模型层」 |
| 模型层 | `lib/layers.js`、`lib/service.js`、`lib/models-route.js`；`vibestack-core` 行 `ctx.provide`；GET/POST `/api/vibestack/models`；`vibestack-layer` 命令；Agent/命令/技能/默认层应用 |
| 文档 | 本文件、`AGENTS.md`、根 `README.md`、`plugins/README.md`、`plugins/dsh/README.md`、`docs/resolve-api.md`、`docs/architecture.md`、插件自带 skill |
| OpenCode 退场 | `plugins/opencode/` 删除；CLI `plugin install` 移除；`plugin list/status` 保留自省；能力组文案清理 |
| 测试 | Python `tests/test_resolve.py`、`tests/test_cli.py`、`tests/test_group_forge.py`、`tests/test_plugin.py`；Node `test/names.test.js`、`test/plan.test.js`、`test/commands.test.js`、`test/skills.test.js`、`test/agents.test.js`、`test/resolve.test.js`、`test/plugin.test.js`、`test/layers.test.js`、`test/service.test.js`、`test/models-route.test.js`、`test/core.test.js` |

验证命令：

```bash
uv run pytest -q
node plugins/dsh/test/agents.test.js
node plugins/dsh/test/plugin.test.js
# 其余 DSH 测试文件逐个运行，见 plugins/dsh/README.md
```

真实 CLI 验收：

```bash
vibe-stack resolve --json --mode vibestack --project .
# core 非空、mode=vibestack、agents 含 Athena/Hermes/Hephaestus、
# commands 含 auto-git-commit/group-new/group-validate、
# skills 含 caveman/custom-group/custom-tool、warnings 为空
```

---

## 附录 A：DSH 0.2.1-rc.5 事实清单

| 事实 | 来源 |
| --- | --- |
| 命令名 `/^[a-z][a-z0-9_-]*$/`；`/name` 解析同语法；重名抛错 | `@deepseek-ai/dsh-commands` 源码 |
| 命令 handler 收到 `{commandId, agent, rawInput/args, attachments}`；返回 `{kind: 'success' 或 'error', text}` | 同上 |
| `followup()` 排队下一回合并唤醒；`steer()` 提交下一步输入 | `@deepseek-ai/dsh-agent` README |
| skill 名 kebab `/^[a-z0-9]+(?:-[a-z0-9]+)*$/`；非法名加载返回 undefined | `@deepseek-ai/dsh-skill` 源码 |
| 用户 `/name` 调 skill 是用户文本 token 扫描（pre-step），不是命令 | `@deepseek-ai/dsh-tool-skill` README |
| 模型选择是会话级；`ctx.modelDirectories.directoryFor(id).select()`；子 Agent 会话不公开 | `@deepseek-ai/dsh-client-ui-model-selection` README/源码 |
| Host 可写会话模型：`sessionController.selectModel({sessionId, provider, model, reasoningEffort?})`；`modelCatalog()` | Host `sessionController` 契约 |
| composer 模型位：`conversation.input.model`（single，`shadows-shipped-ui`）+ `.label`（只读展示） | client Slots 目录 |
| 设置页入口：`settings.section`（list） | client Slots 目录 |
| exact Fetch 路由：`GET/HEAD/POST` + `buffered` body | `HostConnectionFetch` 契约 |
| 不能写自定义会话事件（未知类型不可读） | 既有踩坑记录 |
| 插件 Config 用 schemastery `z.object` 导出 `Config` | `dsh-tool-subagent` 等包约定 |

## 附录 B：OpenCode 引用清单（已执行，2026-11-07）

| 文件 | 行/段 | 动作 |
| --- | --- | --- |
| `plugins/opencode/**` | 全部 | 删除 |
| `AGENTS.md` | 3、8、47、57 | 改写/删除 |
| `README.md` | 安装、项目部署、Agent 插件、CLI、开发 | 重写为 DSH |
| `plugins/README.md` | §2、§6、§7、§9、§10 | 示例换 `dsh`；删 OpenCode 映射表；安装段改 `dsh plugin add` |
| `docs/architecture.md` | §7 与 OpenCode 适配 | 改为 DSH 适配 |
| `capability-groups/**/SKILL.md` | `compatibility: opencode`（4 处） | 删字段或改 `dsh` |
| `data-forge/SKILL.md` | 「OpenCode 插件自动加载」 | 改「DSH 插件挂载」 |
| `sisyphus.md` | 「OpenCode AI 编排器」 | 改「AI 编排器」 |
| `photoshop/references/方案.md` | 全文 | 标注历史资料，不改内容 |
| CLI `plugin install` / `plugin status` 文档 | §7 | 收敛为自省或不出现 |

执行结果：以上条目均已处理；`photoshop/references/方案.md` 与 `docs/` 中的 OpenCode 字样属于
历史资料。`tools/data-forge/0.2.1/.gitignore` 的注释按“已发布版本不可修改”保留。

## 附录 C：命名对照

| 旧 | 新（DSH 实际） | 显示 |
| --- | --- | --- |
| `/caveman` | `/vibestack-core-caveman` | VibeStack · core · caveman |
| `/auto-git-commit` | `/vibestack-core-auto-git-commit` | VibeStack · core · auto-git-commit |
| `/photoshop-generate` | `/vibestack-photoshop-photoshop-generate` | VibeStack · photoshop · photoshop-generate |
| `/group-new`（group-forge） | `/vibestack-group-forge-group-new` | VibeStack · group-forge · group-new |
| `/group-validate`（group-forge） | `/vibestack-group-forge-group-validate` | VibeStack · group-forge · group-validate |
| skill `caveman` | `vibestack-core-caveman` | 同上 |
| skill `custom-group` | `vibestack-group-forge-custom-group` | VibeStack · group-forge · custom-group |
| skill `custom-agent` 等 | `vibestack-group-forge-custom-*` | VibeStack · group-forge · custom-* |
