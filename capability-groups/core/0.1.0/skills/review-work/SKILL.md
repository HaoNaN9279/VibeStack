---
name: review-work
description: "实现后审查编排器。并行启动多个审查子智能体（目标验证、代码审查、安全审计、上下文挖掘），全部通过才算通过。PR 交接前或用户要求审查已完成工作时必须使用。触发词：'review work', 'review my work', 'review changes', 'QA my work', 'verify implementation', 'check my work', 'validate changes', 'post-implementation review'"
---

# 审查工作 - 并行审查编排器

并行启动多个专门子智能体，从各个角度审查已完成的工作。全部通过才算通过，任何一个失败则审查失败。

| # | 智能体 | 类型 | 角色 | 重点 |
|---|--------|------|------|------|
| 1 | 目标验证 | Oracle | 是否按要求实现了？ | 主要 |
| 2 | 代码审查 | Oracle | 代码写得好吗？ | 主要 |
| 3 | 安全审计 | Oracle | 安全吗？ | 辅助 |
| 4 | 上下文挖掘 | 自主 | 遗漏了什么上下文？ | 主要 |

---

## 阶段 0：收集审查上下文

启动前收集以下信息。优先从对话历史提取，只在确实缺失时才询问。

- **目标**：原始目标。从用户请求中提取。
- **约束**：规则、要求或限制（技术栈、性能目标、API 契约等）。
- **背景**：为何需要这项工作（业务上下文、关联系统、过往决策）。
- **变更文件**：通过 `git diff --name-only HEAD~1` 自动获取。
- **差异**：通过 `git diff HEAD~1` 自动获取。
- **文件内容**：读取每个变更文件的完整内容（Oracle 不能读取文件，需将完整上下文放入提示）。
- **运行命令**：如何启动应用。检查 `package.json`、`Makefile`、`docker-compose.yml`。

---

## 阶段 1：启动审查智能体

在一个回合内启动全部智能体。每个使用 `run_in_background=true`。不串行启动，不在启动间等待。

**Oracle 智能体**：所有内容放入提示中（不能读取文件或运行命令）。包含差异、文件内容和所有上下文。

**自主智能体**：可读取文件、运行命令、使用工具。给目标和指引，而非原始数据。

---

### 智能体 1：目标与约束验证（Oracle）- 主要

回答："是否完全按要求在约束内完成了工作？"

```
task(
  subagent_type="oracle",
  run_in_background=true,
  description="验证实现是否满足原始目标和约束",
  prompt="""
<review_type>目标与约束验证</review_type>

<original_goal>{目标}</original_goal>
<constraints>{约束}</constraints>
<background>{背景}</background>
<changed_files>{变更文件列表}</changed_files>
<file_contents>{每个变更文件的完整内容}</file_contents>
<diff>{Git 差异}</diff>

判断实现是否正确、完整地满足了目标。

检查清单：

1. **目标完整性**：将目标分解为每个子需求（显式 + 隐含），标记 已达成/缺失/部分。
2. **约束合规**：逐条检查，用代码证据验证。违反任一约束 = FAIL。
3. **过度工程**：是否添加了未要求的内容（不必要的抽象、额外功能、过早优化）。
4. **边界情况**：至少思考 5 个边界场景。
5. **行为正确性**：走读代码逻辑，3 个以上典型场景是否表现正确。

输出格式：
<verdict>PASS 或 FAIL</verdict>
<confidence>HIGH / MEDIUM / LOW</confidence>
<summary>1-3 句总体评估</summary>
<findings>
  - [PASS/FAIL/WARN] 类型: 描述
  - 文件: 路径（行号范围）
  - 证据: 具体代码或逻辑引用
</findings>
<blocking_issues>必须修复的问题。PASS 则为空。</blocking_issues>
"""
)
```

---

### 智能体 2：代码质量审查（Oracle）- 主要

回答："代码是否编写良好、可维护且与代码库一致？"

```
task(
  subagent_type="oracle",
  run_in_background=true,
  description="审查代码质量、模式和架构",
  prompt="""
<review_type>代码质量审查</review_type>

<changed_files>{变更文件列表}</changed_files>
<file_contents>{变更文件及相邻文件的完整内容}</file_contents>
<diff>{差异}</diff>
<background>{背景}</background>

标准："我会无评论地批准此 PR 吗？"

审查维度：

1. **正确性**：逻辑错误、空值处理、竞态条件、资源泄漏、未处理的 Promise 拒绝。
2. **模式一致性**：是否遵循现有模式？引入新模式而已有现成模式 = 问题。
3. **命名与可读性**：变量/函数/类型命名清晰？无需解释即可理解？
4. **错误处理**：错误被妥善捕获、记录和传播？无空 catch 块？无吞没错误？
5. **类型安全**：是否有 `as any`、`@ts-ignore`？泛型使用正确？类型收窄正确？
6. **性能**：N+1 查询？不必要重渲染？热路径上阻塞 I/O？内存泄漏？无界增长？
7. **抽象层次**：适量抽象。无复制粘贴重复，也无过早过度抽象。
8. **测试**：新行为有测试覆盖？测试有意义而非凑覆盖率？测试名描述场景？
9. **API 设计**：公共接口干净、与现有 API 一致？破坏性变更已标记？
10. **技术债务**：是否引入新债？造成难以变更的耦合？

严重级别：
- **CRITICAL**：将在生产环境导致 Bug、数据丢失或崩溃
- **MAJOR**：显著质量问题，合入前应修复
- **MINOR**：值得改进但不阻塞
- **NITPICK**：风格偏好，可选

输出格式：
<verdict>PASS 或 FAIL</verdict>
<confidence>HIGH / MEDIUM / LOW</confidence>
<summary>1-3 句总体评估</summary>
<findings>
  - [CRITICAL/MAJOR/MINOR/NITPICK] 类别: 描述
  - 文件: 路径（行号）
  - 现状: 当前做法
  - 建议: 改进方案
</findings>
<blocking_issues>仅 CRITICAL 和 MAJOR。PASS 则为空。</blocking_issues>
"""
)
```

---

### 智能体 3：安全审查（Oracle）- 辅助

回答："这些变更是否存在安全漏洞？"

```
task(
  subagent_type="oracle",
  run_in_background=true,
  description="实现变更的安全审查",
  prompt="""
<review_type>安全审查（辅助）</review_type>

<changed_files>{变更文件列表}</changed_files>
<file_contents>{变更文件完整内容}</file_contents>
<diff>{差异}</diff>

仅审查安全漏洞和反模式。忽略代码风格、命名、架构——除非直接造成安全风险。

安全检查清单：

1. **输入验证**：用户输入已消毒？SQL 注入、XSS、命令注入、SSRF 向量？
2. **认证与授权**：必要处有认证检查？每个操作有授权验证？权限提升路径？
3. **密钥与凭证**：代码或配置中有硬编码密钥、API 令牌？日志中有密钥？
4. **数据暴露**：日志中有敏感数据？错误信息含 PII？API 响应过度暴露？
5. **依赖**：新增依赖？已知 CVE？可疑或不必要包？
6. **加密**：算法正确？无自定义加密？安全随机数？密钥管理得当？
7. **文件与路径**：路径遍历？不安全文件操作？符号链接跟随？
8. **网络**：CORS 配置正确？速率限制？TLS 强制？证书验证？
9. **错误泄漏**：用户看到堆栈跟踪？错误响应含内部细节？
10. **供应链**：锁文件一致更新？依赖版本锁定？

输出格式：
<verdict>PASS 或 FAIL</verdict>
<severity>CRITICAL / HIGH / MEDIUM / LOW / NONE</severity>
<summary>1-3 句总体评估</summary>
<findings>
  - [CRITICAL/HIGH/MEDIUM/LOW] 类别: 描述
  - 文件: 路径（行号）
  - 风险: 攻击者可做什么？
  - 修复: 具体方案
</findings>
<blocking_issues>仅 CRITICAL 和 HIGH。PASS 则为空。</blocking_issues>
"""
)
```

---

### 智能体 4：上下文挖掘（自主）- 主要

回答："我们是否遗漏了应指导实现的上下文？"

```
task(
  category="unspecified-high",
  run_in_background=true,
  description="挖掘所有可访问的上下文以寻找遗漏的需求",
  prompt="""
<review_type>上下文挖掘——遗漏的需求与背景</review_type>

<original_goal>{目标}</original_goal>
<constraints>{约束}</constraints>
<changed_files>{变更文件列表}</changed_files>
<background>{背景}</background>

搜索所有可访问的信息源，寻找应指导实现但可能被遗漏的上下文。

搜索来源：

1. **Git 历史**（必查）：
   - `git log --oneline -20 -- {每个变更文件}` — 近期变更及原因
   - `git blame {关键区域}` — 谁写了什么、何时
   - 查找被还原的提交、TODO/FIXME/HACK 注释

2. **GitHub**（如 `gh` CLI 可用）：
   - `gh issue list --search "{关键词}"` — 相关 issue
   - `gh pr list --search "{关键词}" --state all` — 相关 PR 及审查评论

3. **代码库交叉引用**（必查）：
   - 导入或引用变更模块的文件
   - 需因行为变更而更新的测试
   - 引用变更行为的文档
   - 需相应更新的配置文件
   - 同领域的相关功能

查找内容：
- issue/PR 中提到但实现遗漏的需求
- 过往决策解释了代码为何那样写——新变更是否尊重这些理由
- 受这些变更影响的关联系统或功能
- 前人警告（PR 审查评论、TODO、提交消息）
- 影响变更代码的迁移或弃用说明

输出格式：
<verdict>PASS 或 FAIL</verdict>
<confidence>HIGH / MEDIUM / LOW</confidence>
<summary>1-3 句总体评估</summary>
<sources_searched>
  - [SEARCHED/SKIPPED] 来源名——搜索了什么（或为何无法访问）
</sources_searched>
<discovered_context>
  每条发现：
  - 来源：何处找到
  - 发现：找到了什么
  - 相关性：与当前工作的关系
  - 影响：[BLOCKING / IMPORTANT / FYI]
</discovered_context>
<missed_requirements>实现应解决但未解决的需求。无则空。</missed_requirements>
<blocking_issues>仅 BLOCKING 项。PASS 则为空。</blocking_issues>
"""
)
```

---

## 阶段 2：等待与收集

所有智能体启动后，等待完成。独立保存每个通道的裁决。

| 智能体 | 裁决 |
|--------|------|
| 1. 目标验证 | pending / PASS / FAIL |
| 2. 代码质量 | pending / PASS / FAIL |
| 3. 安全审查 | pending / PASS / FAIL |
| 4. 上下文挖掘 | pending / PASS / FAIL |

在所有通道进入终态前，不交付最终报告。如某通道无响应，记录为 INCONCLUSIVE 并重试。重试仍无法完成，保留 INCONCLUSIVE 并输出汇总结果。

---

## 阶段 3：交付裁决

**裁决逻辑：**

- 全部 PASS → **审查通过**
- 任一 FAIL → **审查未通过**
- 有 INCONCLUSIVE 且无 FAIL → **审查无结论**

**最终报告格式：**

```markdown
# 审查工作 - 最终报告

## 总体裁决：通过 / 未通过 / 无结论

| # | 审查领域 | 智能体类型 | 裁决 | 置信度 |
|---|----------|------------|------|--------|
| 1 | 目标与约束验证 | Oracle | PASS/FAIL/INCONCLUSIVE | HIGH/MED/LOW |
| 2 | 代码质量 | Oracle | PASS/FAIL/INCONCLUSIVE | HIGH/MED/LOW |
| 3 | 安全审查（辅助） | Oracle | PASS/FAIL/INCONCLUSIVE | 严重级别 |
| 4 | 上下文挖掘 | 自主 | PASS/FAIL/INCONCLUSIVE | HIGH/MED/LOW |

## 阻塞性问题
[汇总自所有智能体——去重、按优先级排序]

## 关键发现
[所有智能体中最重要的问题，按主题分组]

## 建议
[未通过：明确修复内容及顺序]
[通过：非阻塞的改进建议]
```

未通过时——说清楚问题、文件、修复方案。通过时——简短扼要。
