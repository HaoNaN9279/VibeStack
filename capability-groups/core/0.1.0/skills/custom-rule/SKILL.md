---
name: custom-rule
description: 当用户需要创建或管理 OpenCode 规则文件（rules）时使用
license: MIT
compatibility: opencode
metadata:
  audience: contributors
  category: configuration
---

# Custom Rule — 规则制作指南

指导你创建和管理 OpenCode 规则文件。规则为 AI 智能体提供自定义指令，所有规则通过单独的 `.md` 文件定义。

---

## 1. 部署位置

### 确定添加内容的位置

当用户描述添加内容时，按以下规则确定存放位置的层级：

- **"添加常驻内容"** 或类似描述 → `capability-groups/core/0.1.0/` 目录（全局常驻配置）
- **"为 xxx domain" / "xxx 领域" / "为 xxx 添加内容"** 或类似描述 → `capability-groups/<group>/<version>/` 目录（领域专属配置）
- **"为当前项目添加内容"** 或类似描述 → `.opencode/` 目录（项目专属配置）
- **"为本地用户配置" / "为本地用户"** 或类似描述 → `~/.config/opencode/` 目录（用户本地配置）
- **未明确指明位置** → **必须询问用户**具体的添加位置，绝对不允许擅自做决策

### 1.1 核心规则（全局生效）

放置在 `capability-groups/core/0.1.0/rules/` 目录下。

```
capability-groups/core/0.1.0/rules/
  ├── 00-global.md          # 适用于所有会话的全局规则
  └── <category>-<name>.md  # 其他全局规则
```

### 1.2 领域规则（领域专属）

放置在 `capability-groups/<group>/<version>/rules/` 目录下。

```
capability-groups/<group>/<version>/
  rules/
    <domain>.md
```

### 1.3 项目规则（项目专属）
放置在 `.opencode/rules/` 目录下。
```
.opencode/rules/
  ├── <name>.md
```

---

## 2. 规则文件格式规范

使用独立 `.md` 文件，格式要求：

- **文件名**：使用 `<name>.md` 
- **内容**：第一行为 `# 规则标题`，后续为具体规则内容
- **语言**：使用简体中文，专有名词保留原文
- **结构建议**：按主题分节，使用 `##` 二级标题

### 3. 引用外部文件

在 AGENTS.md 中通过 `@` 引用外部规则文件：

```markdown
对于 TypeScript 代码风格和最佳实践：@docs/typescript-guidelines.md
对于 React 组件架构：@docs/react-patterns.md
```

AI 智能体会在需要时按需读取这些文件。

---

## 4. 规则内容写作指南

### 4.1 规则结构模板

```markdown
# [规则类别]

简明描述这些规则的适用范围和目的。

## [具体主题 1]
- 规则点 1
- 规则点 2
- 规则点 3

## [具体主题 2]
- 规则点 1
- 规则点 2
```

### 4.2 写作原则

- **指令明确**：每条规则必须是可执行的指令，而非泛泛而谈
- **示例驱动**：复杂规则附带代码示例
- **负面清单**：明确禁止的行为用 "绝不" 强调
- **避免冗余**：不在多个规则文件中重复相同内容
- **版本相关**：涉及版本限制时标注版本号

### 4.3 规则类型建议

| 规则类型 | 放置位置 | 示例 |
|----------|----------|------|
| 全局行为规范 | `capability-groups/core/0.1.0/rules/00-global.md` | 沟通风格、安全策略 |
| 编码规范 | `capability-groups/core/0.1.0/rules/01-coding.md` | TypeScript 规范、命名约定 |
| 领域特定规则 | `capability-groups/<group>/<version>/rules/<name>.md` | Unity API 使用规范 |
| 工作流规则 | `capability-groups/core/0.1.0/rules/02-workflow.md` | Git 流程、PR 规范 |

---

## 5. 添加新规则的完整流程

```bash
# 1. 确定规则作用范围
# 全局规则 → capability-groups/core/0.1.0/rules/
# 领域规则 → capability-groups/<group>/<version>/rules/
# 项目规则 → .opencode/rules/

# 2. 创建规则文件
echo "## My New Rule" > capability-groups/core/0.1.0/rules/03-my-rule.md
```

---

## 6. 最佳实践

- **规则文件保持专注**：每个文件只关注一个主题领域
- **定期审查**：移除过时规则，更新版本依赖
- **配合 skill 使用**：复杂的行为指南建议封装为 skill，规则只做通用约束
