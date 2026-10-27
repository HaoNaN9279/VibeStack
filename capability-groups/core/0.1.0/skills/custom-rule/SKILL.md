---
name: custom-rule
description: 当用户需要创建或管理 VibeStack 规则文件（rules）时使用
license: MIT
---

# Custom Rule — 规则制作指南

指导你创建和管理规则文件。规则为 AI 智能体提供常驻指令，全部通过独立 `.md` 文件定义。

---

## 1. 部署位置

### 确定添加内容的位置

- **"添加常驻内容"** 或类似描述 → `capability-groups/core/0.1.0/` 目录（全局常驻配置）
- **"为 xxx domain" / "xxx 领域" / "为 xxx 添加内容"** 或类似描述 → `capability-groups/<group>/<version>/` 目录（领域专属配置）
- **"为当前项目添加内容"** 或类似描述 → 在仓库新建或复用项目能力组，并在项目 `.vibestack/stack.json` 的 `groups` 中激活
- **未明确指明位置** → **必须询问用户**具体的添加位置，绝对不允许擅自做决策

VibeStack 不写入任何 Agent 的专有配置目录，也不复制或链接内容到这些目录。项目级内容只通过 `.vibestack/stack.json` 激活能力组生效。

### 1.1 核心规则（全局生效）

放置在 `capability-groups/core/0.1.0/rules/` 目录下。

```text
capability-groups/core/0.1.0/rules/
├── 00-global.md          # 适用于所有会话的全局规则
└── <category>-<name>.md  # 其他全局规则
```

### 1.2 领域规则（领域专属）

放置在 `capability-groups/<group>/<version>/rules/` 目录下。

```text
capability-groups/<group>/<version>/
rules/
└── <domain>.md
```

### 1.3 项目规则（项目专属）

在 `capability-groups/<group>/<version>/rules/` 中定义，然后在项目根目录激活能力组：

```bash
vibe-stack activate <group>
vibe-stack sync
```

---

## 2. 规则文件格式规范

每个规则文件必须以 YAML frontmatter 开头，frontmatter **必须包含** `name` 字段。

```markdown
---
name: global                    # 必填：规则标识，建议使用 kebab-case
---

# 规则标题

规则内容。
```

格式要求：

- **文件名**：使用 `<name>.md`，数字前缀控制加载顺序（如 `00-global.md`）
- **frontmatter**：位于文件开头，必须包含 `name`
- **内容**：frontmatter 之后以 `# 规则标题` 开头，后续为具体规则内容
- **语言**：使用简体中文，专有名词保留原文
- **结构建议**：按主题分节，使用 `##` 二级标题

---

## 3. 规则如何注入

适配器按能力组读取 `rules/` 目录：

1. 递归扫描组内 `rules/**/*.md`
2. 解析 frontmatter，缺少 `name` 的文件跳过并产生告警
3. 按路径排序后追加为目标 Agent 的常驻指令
4. 多个能力组的规则按加载顺序追加，不覆盖

因此：

- 规则文件必须位于能力组内，不要写入 Agent 的专有规则目录。
- 不需要通过 Agent 的规则引用机制手动挂载规则文件。
- 规则只增不减；同一主题的多条规则应放在同一文件，避免重复约束。

---

## 4. 规则内容写作指南

### 4.1 规则结构模板

```markdown
---
name: rule-category
---

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

```text
1. 确定规则作用范围：core 能力组、领域能力组，或项目能力组
2. 在能力组的 rules/ 下创建 <name>.md
3. 编写 YAML frontmatter，必须包含 name
4. 编写规则内容，使用数字前缀控制顺序
5. 若为项目能力组，执行 vibe-stack activate <group> 与 vibe-stack sync
6. 重启 Agent，规则随常驻指令自动加载
```

---

## 6. 最佳实践

- **规则文件保持专注**：每个文件只关注一个主题领域
- **定期审查**：移除过时规则，更新版本依赖
- **配合 skill 使用**：复杂的行为指南建议封装为 skill，规则只做通用约束
