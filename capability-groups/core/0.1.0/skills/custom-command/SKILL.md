---
name: custom-command
description: 当用户需要创建或管理 OpenCode 自定义命令（Command）时使用
license: MIT
compatibility: opencode
metadata:
  audience: contributors
  category: configuration
---

# Custom Command — 命令制作指南

指导你创建和管理 OpenCode 自定义命令。自定义命令通过斜杠 `/` 触发，执行预定义的提示词模板，用于处理重复性任务。

---

## 1. 命令概述

自定义命令是内置命令（如 `/init`、`/undo`、`/redo`、`/share`、`/help`）的补充。在 TUI 中输入 `/` 后跟命令名称即可触发。

---

## 2. 部署位置

### 确定添加内容的位置

当用户描述添加内容时，按以下规则确定存放位置的层级：

- **"添加常驻内容"** 或类似描述 → `capability-groups/core/0.1.0/` 目录（全局常驻配置）
- **"为 xxx domain" / "xxx 领域" / "为 xxx 添加内容"** 或类似描述 → `capability-groups/<group>/<version>/` 目录（领域专属配置）
- **"为当前项目添加内容"** 或类似描述 → `.opencode/` 目录（项目专属配置）
- **"为本地用户配置" / "为本地用户"** 或类似描述 → `~/.config/opencode/` 目录（用户本地配置）
- **未明确指明位置** → **必须询问用户**具体的添加位置，绝对不允许擅自做决策

### 2.1 核心命令（全局可用）

放置在 `capability-groups/core/0.1.0/commands/` 目录下。

```
capability-groups/core/0.1.0/commands/
  └── <command-name>.md      # 全局命令定义
```

### 2.2 领域命令（领域专属）

放置在 `capability-groups/<group>/<version>/commands/` 目录下。

```
capability-groups/<group>/<version>/
  commands/
    ├── <domain>-process.md    # 领域处理命令
    ├── <domain>-export.md     # 导出命令
    ├── <domain>-prompt.md     # 提示管理命令
    └── <domain>-utils.md      # 工具命令
```

### 2.3 项目命令（项目专属）
放置在 `.opencode/commands/` 目录下。
```
.opencode/commands/
  └── <command-name>.md      # 项目命令定义
```

---

## 3. 命令定义方式

文件名即为命令名称。例如 `test.md` 创建 `/test` 命令。

```markdown
---
description: 命令的简要描述（在 TUI 中显示）
agent: build|plan|<agent-name>      # 可选：指定执行代理
model: provider/model-id            # 可选：覆盖模型
subtask: true|false                 # 可选：强制作为子代理运行
---

这里是命令的提示词模板内容。支持：
- $ARGUMENTS — 所有参数
- $1, $2, $3 — 位置参数
- !`command` — shell 命令输出注入
- @filename — 文件引用
```

---

## 4. 提示词模板语法

### 4.1 参数绑定

```
$ARGUMENTS     # 所有参数的原始字符串
$1             # 第一个参数
$2             # 第二个参数
$3             # 第三个参数...以此类推
```

示例（`component.md`）：

```markdown
---
description: Create a new React component
---

Create a new React component named $ARGUMENTS with TypeScript support.
Include proper typing and basic structure.
```

使用方式：`/component Button` → `$ARGUMENTS` 替换为 `Button`

### 4.2 Shell 输出注入

使用 `!` + 反引号执行 shell 命令，输出注入到提示词中：

```markdown
---
description: Analyze test coverage
---

Here are the current test results:
!`npm test`

Based on these results, suggest improvements to increase coverage.
```

```markdown
---
description: Review recent changes
---

Recent git commits:
!`git log --oneline -10`

Review these changes and suggest any improvements.
```

命令在项目根目录执行，输出成为提示词的一部分。

### 4.3 文件引用

使用 `@` 后跟文件名引用文件内容：

```markdown
---
description: Review component
---

Review the component in @src/components/Button.tsx.
Check for performance issues and suggest improvements.
```

文件内容会自动包含在提示词中。

---

## 5. 配置选项详解

| 选项 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `template` / 内容 | string | **是** | 执行时发送给 LLM 的提示词 |
| `description` | string | 推荐 | 命令功能的简要描述，TUI 中显示 |
| `agent` | string | 否 | 指定执行命令的代理。subagent 默认触发子代理调用 |
| `subtask` | boolean | 否 | 强制触发子代理调用（即使 agent 配置为 primary） |
| `model` | string | 否 | 覆盖此命令的默认模型 |

---

## 6. 命令制作示例

### 6.1 完整领域命令示例（`capability-groups/data-forge/1.0.0/commands/data-forge-process.md`）

```markdown
---
description: Execute AI data processing pipelines: resize, remove-bg, batch
---

# `/data-forge-process` — Image Processing Pipeline

> 这是一份指导文档，指导 AI 智能体如何执行图像处理流水线。

## 1. Usage

```
/data-forge-process resize --input-dir <path> --output-dir <path> --width <px> --height <px>
/data-forge-process remove-bg --input-dir <path> --output-dir <path>
/data-forge-process batch --input-dir <path> --output-dir <path>
```

## 2. Parameters

| Parameter | Required | Description |
|---|---|---|
| `--input-dir` | Yes | Directory containing source images |
| `--output-dir` | Yes | Directory for output images |

## 3. Execution Steps

### 3.1 resize — Batch Image Resize

1. Validate input directory exists
2. Invoke resize tool with parameters
3. Report results

## 4. Notes

- No GPU execution — this command provides guidance only
- Pipeline stages are atomic
```

### 6.2 使用别名优化

为常用复杂命令创建短别名：

```markdown
---
description: 快捷别名 - data-forge process
---

/data-forge-process $ARGUMENTS
```

---

## 7. 命令设计原则

### 7.1 职责明确

每个命令应聚焦一个具体的操作领域：

| 好的命名 | 差的命名 | 原因 |
|----------|----------|------|
| `data-forge-process` | `data-forge` | 太宽泛，不知道做什么 |
| `test-run` | `run` | 可能与其他命令冲突 |
| `component-create` | `new` | 过于通用 |

### 7.2 提示词结构

命令的提示词应遵循：

1. **用途说明**：简短描述命令做什么
2. **使用方式**：展示语法和示例
3. **参数说明**：列出所有参数及其说明
4. **执行步骤**：分步指导 AI 如何执行
5. **注意事项**：边界情况、依赖关系、错误处理
6. **使用简体中文**：确保提示词使用简体中文，保持与用户沟通一致

### 7.3 良好实践

- **提供别名**：在说明中包含简短别名
- **参数验证**：提示 AI 先验证参数再执行
- **错误处理**：说明可能的错误及处理方式
- **输出格式**：定义标准化的输出报告格式
- **幂等性**：命令应可重复执行而不产生副作用

---

## 8. 创建命令的标准流程

```bash
# 1. 确定命令位置
# 全局命令 → capability-groups/core/0.1.0/commands/<name>.md
# 领域命令 → capability-groups/<group>/<version>/commands/<name>.md
# 项目命令 → .opencode/commands/<name>.md

# 2. 创建命令 Markdown 文件
echo "---\ndescription: My new command\n---\n\nExecute my command with \$ARGUMENTS" > capability-groups/core/0.1.0/commands/my-command.md

# 3. 编写详细的提示词模板

# 4. 测试
# 在 TUI 中输入 /my-command 测试

```
