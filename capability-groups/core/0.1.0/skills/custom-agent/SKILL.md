---
name: custom-agent
description: 创建 OpenCode 智能体（Agent）的制作规范和完整指南
license: MIT
compatibility: opencode
metadata:
  audience: contributors
  category: configuration
---

# Custom Agent — 智能体制作指南

指导你创建和管理 OpenCode 智能体（Agent）。智能体是针对特定任务配置的专门 AI 助手，拥有自定义提示词、模型和工具访问权限。

---

## 1. 智能体类型

OpenCode 中有两种智能体类型：

| 类型 | 说明 | 切换方式 |
|------|------|----------|
| **主代理 (Primary)** | 用户直接交互的主要助手 | Tab 键或 `switch_agent` 快捷键 |
| **子代理 (Subagent)** | 主代理调用或通过 `@` 提及的专业助手 | 自动调用或 `@agent-name` 手动调用 |

---

## 2. 部署位置

### 确定添加内容的位置

当用户描述添加内容时，按以下规则确定存放位置的层级：

- **"添加常驻内容"** 或类似描述 → `capability-groups/core/0.1.0/` 目录（全局常驻配置）
- **"为 xxx domain" / "xxx 领域" / "为 xxx 添加内容"** 或类似描述 → `capability-groups/<group>/<version>/` 目录（领域专属配置）
- **"为当前项目添加内容"** 或类似描述 → `.opencode/` 目录（项目专属配置）
- **"为本地用户配置" / "为本地用户"** 或类似描述 → `~/.config/opencode/` 目录（用户本地配置）
- **未明确指明位置** → **必须询问用户**具体的添加位置，绝对不允许擅自做决策

### 2.1 核心智能体（全局可用）

放置在 `capability-groups/core/0.1.0/agents/` 目录下。

```
capability-groups/core/0.1.0/agents/
  └── <agent-name>.md      # 全局智能体定义
```

### 2.2 领域智能体（领域专属）

放置在 `capability-groups/<group>/<version>/agents/` 目录下。

```
capability-groups/<group>/<version>/
  agents/
    ├── <domain>.md                  # 主领域智能体
    ├── <domain>-assistant.md        # 辅助子代理
    └── <domain>-specialist.md       # 专业技能代理
```

### 2.3 项目智能体（项目专属）

放置在 `.opencode/agents/` 目录下。
```
.opencode/agents/
  └── <agent-name>.md      # 项目智能体定义
```
---

## 3. 智能体定义方式

文件名即为智能体名称。例如 `hermes.md` 创建名为 `hermes` 的智能体。

放置位置：
- 全局：`~/.config/opencode/agents/`
- 项目级：`.opencode/agents/`

```markdown
---
description: 简短描述智能体的功能和用途（必填）
mode: primary|subagent|all
model: provider/model-id
temperature: 0.1
tools:
  write: true|false
  edit: true|false
  bash: true|false
permission:
  edit: deny|ask|allow
  bash: allow|ask|deny
  task: allow|ask|deny
color: "#HEX"|theme-color
hidden: true|false
---

# 智能体名称 — 角色描述

你是 **AgentName**，...（具体系统提示词）
```
---

## 4. 配置选项详解

### 4.1 必需字段

| 字段 | 说明 | 示例 |
|------|------|------|
| `description` | 智能体功能描述（**必填**） | "Reviews code for best practices" |
| `mode` | 模式：`primary` / `subagent` / `all` | `subagent` |
| `name` | 名称（在 frontmatter 中指定，与文件名一致） | `code-reviewer` |

### 4.2 可选字段

| 字段 | 说明 | 默认值 |
|------|------|--------|
| `model` | 覆盖模型，格式 `provider/model-id` | 主代理用全局模型，子代理用调用方模型 |
| `temperature` | 响应随机性 (0.0-1.0) | 模型默认（通常为 0） |
| `top_p` | 替代温度的多样性控制 | 模型默认 |
| `steps` | 最大代理迭代次数（原 `maxSteps` 已弃用） | 无限制 |
| `prompt` | 系统提示词文件路径，格式 `{file:./path/to/prompt.txt}` | 无 |
| `tools` | 工具启用/禁用控制 | 全部启用 |
| `permission` | 权限控制（`ask` / `allow` / `deny`） | 全局权限 |
| `hidden` | 从 `@` 自动补全隐藏（仅 subagent） | `false` |
| `color` | UI 颜色，十六进制或主题色 | 默认 |
| `disable` | 禁用智能体 | `false` |

### 4.3 工具控制

```yaml
tools:
  write: false          # 禁用文件写入
  edit: false           # 禁用文件编辑
  bash: false           # 禁用 shell 命令
  skill: false          # 禁用技能加载
  mymcp_*: false        # 禁用特定 MCP 工具（支持 glob）
```

### 4.4 权限控制

```yaml
permission:
  edit: deny            # deny：完全禁止；ask：需确认；allow：自动允许
  bash:
    "*": ask            # 所有 bash 命令默认需确认
    "git status": allow # 特定命令自动允许
    "git push": deny    # 特定命令禁止
  task:
    "*": deny           # 禁止调用所有子代理
    "orchestrator-*": allow  # 仅允许特定子代理
  skill:
    "internal-*": deny  # 对特定技能设置权限
```

**规则按顺序评估，最后匹配的规则优先。**

### 4.5 提示词（Prompt）配置

提示词文件可引用外部文件：

```json
{
  "agent": {
    "review": {
      "prompt": "{file:./prompts/code-review.txt}"
    }
  }
}
```

路径相对于配置文件位置。

---

## 5. 智能体制作完整示例

### 5.1 核心智能体示例（`capability-groups/core/0.1.0/agents/hermes.md`）

```markdown
---
description: 快速、简洁的问答礼宾服务。只读文件系统、Git 状态、网络搜索、文档阅读。从不修改任何内容。
mode: primary
model: opencode/deepseek-v4-flash-free
name: Hermes
color: "#6366F1"
temperature: 0.1
permission:
    edit: deny
    write: deny
    bash: ask
    task: deny
---

# Hermes — 迅捷信使

你是 **Hermes**，一个只读问答礼宾。你观察、搜索、阅读并回复。从不修改任何内容。

## 核心原则

1. **速度优先于深度** — 直接回答问题
2. **只读** — 没有任何写入/编辑权限
3. **一问一答** — 不要超出所问范围

## 你的能力

- 文件系统（只读）：读取、grep、ast-grep、LSP 诊断
- Git 状态：status、log、diff、branch（只读）
- 网络搜索与文档：Exa 搜索、网页抓取、Context7、GitHub 代码搜索
```

### 5.2 领域子代理示例（`capability-groups/data-forge/1.0.0/agents/data-forge.md`）

```markdown
---
description: Data Forge 领域智能体，专注于 AI 训练数据处理
mode: subagent
tools:
  bash: false
---

# Data Forge 智能体

## Spark 优化器
分析 Spark 作业并建议性能优化方案
```

---

## 6. 创建智能体的标准流程

```bash
# 1. 或手动创建 Markdown 文件
# 确定位置：capability-groups/core/0.1.0/agents/（全局）或 capability-groups/<group>/<version>/agents/（领域） 或 .opencode/agents/（项目）

# 2. 编写 frontmatter
# description 必填，mode 必填

# 3. 编写系统提示词
# 明确角色定位、核心原则、能力范围、禁止事项

# 4. 测试
# 在主会话中通过 @agent-name 调用测试
```

---

## 7. 智能体设计原则

- **单一职责**：每个智能体专注于一个特定领域或任务
- **明确边界**：在提示词中清晰定义 "做什么" 和 "不做什么"
- **工具最小化**：只授予完成任务所需的最少工具权限
- **描述精准**：`description` 字段是智能体被选择调用的依据，必须准确反映其能力
- **参考现有模式**：创建新智能体前，先阅读 `capability-groups/core/0.1.0/agents/hermes.md` 了解项目风格
- **子代理隐藏原则**：仅供程序调用的内部子代理设置 `hidden: true`
- **使用简体中文**：智能体的提示词和描述应使用简体中文，确保与用户沟通一致

### 命名约定

- 文件名使用 kebab-case：`my-special-agent.md`
- 名称使用小写字母和连字符
