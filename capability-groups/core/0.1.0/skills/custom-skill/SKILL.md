---
name: custom-skill
description: 当用户需要创建或管理 OpenCode 技能（Skill）时使用
license: MIT
compatibility: opencode
metadata:
  audience: contributors
  category: configuration
---

# Custom Skill — 技能制作指南

指导你在 **opencode-vibe-stack** 项目中创建和管理 OpenCode 技能（Skill）。技能通过 `SKILL.md` 定义可复用的行为指令，智能体可通过原生的 `skill` 工具按需加载。

---

## 1. 技能概述

技能是封装在 `SKILL.md` 中的可复用指令集。与规则（自动加载）不同，技能通过 `skill` 工具**按需加载**——智能体可以查看可用技能列表，识别匹配的技能，并在需要时加载完整内容。

---

## 2. 在 vibe-stack 中的部署位置

### 确定添加内容的位置

当用户描述添加内容时，按以下规则确定存放位置的层级：

- **"添加常驻内容"** 或类似描述 → `capability-groups/core/0.1.0/` 目录（全局常驻配置）
- **"为 xxx domain" / "xxx 领域" / "为 xxx 添加内容"** 或类似描述 → `capability-groups/<group>/<version>/` 目录（领域专属配置）
- **"为当前项目添加内容"** 或类似描述 → `.opencode/` 目录（项目专属配置）
- **"为本地用户配置" / "为本地用户"** 或类似描述 → `~/.config/opencode/` 目录（用户本地配置）
- **未明确指明位置** → **必须询问用户**具体的添加位置，绝对不允许擅自做决策

### 2.1 核心技能（全局可用）

放置在 `capability-groups/core/0.1.0/skills/` 目录下。

```
capability-groups/core/0.1.0/skills/
  └── <skill-name>/
      └── SKILL.md
```

### 2.2 领域技能（领域专属）

放置在 `capability-groups/<group>/<version>/skills/` 目录下。

```
capability-groups/<group>/<version>/
  skills/
    └── <skill-name>/
        └── SKILL.md
```

---

## 3. SKILL.md 文件格式规范

### 3.1 目录结构

每个技能需要一个独立的目录，目录名即为技能名，目录内包含 `SKILL.md` 文件：

```
<skill-name>/
  └── SKILL.md
```

### 3.2 Frontmatter（必需）

每个 `SKILL.md` 必须以 YAML frontmatter 开头：

```yaml
---
name: skill-name           # 必填：技能名称，符合命名规范
description: 技能描述      # 必填：长度 1-1024 字符
license: MIT               # 可选
compatibility: opencode    # 可选
metadata:                  # 可选：字符串到字符串的映射
  audience: contributors
  category: domain-config
---
```

### 3.3 命名规范

`name` 必须满足以下条件：

- 长度为 1-64 个字符
- 仅包含小写字母和数字，可用单个连字符分隔
- 不以 `-` 开头或结尾
- 不包含连续的 `--`
- 与包含 `SKILL.md` 的目录名称一致

等效正则表达式：`^[a-z0-9]+(-[a-z0-9]+)*$`

### 3.4 描述规范

`description` 必须为 1-1024 个字符。描述句式应为“当用户需要...时使用”，不要只描述是什么。

好的描述示例：
```
当用户需要执行ComfyUI任务、图片缩放、图片格式转换、图片填充背景、图片去除背景、标注管理、LLM 生成图片描述时使用
```

差的描述示例：
```
A skill for releases
```
```
数据处理相关工具
```

---

## 4. 技能内容编写指南

### 4.1 内容结构模板

```markdown
# 技能标题 — 简短说明

技能的核心用途和适用场景的概述。

## 模板

（可选）角色扮演模板，定义 AI 在加载此技能后应扮演的角色。

## 核心工作流

列出加载此技能后应遵循的具体步骤和规则：

- 步骤 1：...
- 步骤 2：...
- 步骤 3：...

## 参数

（可选）定义此技能支持的用户参数：
- **param1**: 说明
- **param2**: 说明

## 使用时机

明确说明此技能应在何时加载使用。
```

### 4.2 写作原则

| 原则 | 说明 |
|------|------|
| **可操作性** | 每条指令必须是 AI 可执行的步骤 |
| **完整性** | 独立完整，不依赖其他技能或规则 |
| **前置条件** | 明确列出执行前需要满足的条件 |
| **边界清晰** | 明确说明技能做什么和不做什么 |
| **错误处理** | 包含常见错误场景的处理指引 |
| **示例驱动** | 使用具体示例说明预期行为 |

### 4.3 能力组技能引用工具

> **适用于能力组技能（`capability-groups/<group>/<version>/skills/`）。**

能力组内**禁止存放工具代码**：不得出现 `tools/` 目录、`pyproject.toml` 或工具源码。
工具统一放在仓库根部 `tools/<name>/<version>/`。

引用步骤：

1. 在能力组 `group.json` 的 `tools` 字段声明工具 ID
2. `SKILL.md` 只写工具名与调用方式，不写仓库绝对路径

```json
{
  "name": "data-forge",
  "tools": ["tool:<guid>@v0.2.1"]
}
```

```markdown
工具代码位于 `tools/data-forge/0.2.1/`。

调用：vibe-stack tool run <tool> -- <args>
MCP：vibe-stack tool serve <tool>
```

**编写技能时的检查清单**：

- [ ] 能力组内没有 `tools/` 目录、`pyproject.toml` 或工具源码
- [ ] `group.json` 的 `tools` 已声明所用工具 ID
- [ ] `SKILL.md` 不含硬编码的绝对路径

---

## 7. 创建技能的标准流程

```bash
# 1. 确定技能放置位置
# 全局技能 → capability-groups/core/0.1.0/skills/<skill-name>/SKILL.md
# 领域技能 → capability-groups/<group>/<version>/skills/<skill-name>/SKILL.md
# 项目技能 → .opencode/skills/<skill-name>/SKILL.md

# 2. 创建技能目录和文件
mkdir -p capability-groups/core/0.1.0/skills/my-skill
touch capability-groups/core/0.1.0/skills/my-skill/SKILL.md

# 3. 编写 frontmatter
# name: my-skill（目录名一致）
# description: 清晰具体的描述（1-1024 字符）

# 4. 编写技能内容
# - 角色定义
# - 核心工作流
# - 参数说明
# - 使用时机
```

---

## 8. 设计原则与最佳实践

- **命名即标识**：技能名称是唯一标识，一旦确定不宜更改
- **描述即广告**：`description` 是智能体判断是否加载的依据，必须精准
- **自包含**：一个技能应独立完整，不依赖其他技能
- **按需加载**：不要用技能替代规则——规则是自动注入的，技能是按需加载的
- **参数化设计**：支持通过 `name()` 的参数传递上下文信息
- **适度粒度**：太粗（覆盖多个领域）或太细（每个函数一个技能）都不好
- **版本兼容**：在 `compatibility` 中标注兼容的 OpenCode 版本
- **用规则约束行为，用技能传授知识**：规则告诉 AI 不该做什么，技能告诉 AI 该怎么做
- **使用简体中文**：description与提示词都应使用简体中文，保持与用户沟通一致
- **尽量精简**：避免冗余和复杂的描述，保持技能内容简洁明了