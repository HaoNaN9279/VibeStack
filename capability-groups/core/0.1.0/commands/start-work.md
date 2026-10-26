---
description: 从 Prometheus 计划启动 Atlas 工作会话
agent: Atlas
---

# `/start-work` — 启动 Atlas 执行工作计划

根据 Prometheus 生成的计划文件，启动 Atlas agent 执行具体开发工作，并跟踪任务进度。

---

### Step 1: 查找计划文件

扫描 `.opencode/jobs/` 目录，查找最新的 Prometheus 计划文件。

```bash
ls .opencode/jobs/
```

计划文件以 `.md` 格式存储，文件名代表任务名称（例如 `refactor-auth.md`、`add-user-api.md`）。

如果 `.opencode/jobs/` 目录不存在或为空，提示用户先通过 Prometheus agent 生成计划。

---

### Step 2: 加载 Atlas

从计划文件名中提取任务名称，启动 Atlas agent 并传入计划文件路径：

```
任务: 执行计划文件 .opencode/jobs/<日期时间（精确到秒）>_<任务名称>/plan.md
计划路径: .opencode/jobs/<日期时间（精确到秒）>_<任务名称>/boulder.md
```

Atlas 会读取计划文件中的目标和步骤，开始逐项执行。

---

### Step 3: 任务跟踪

Atlas 在执行过程中使用 `.opencode/jobs/<日期时间（精确到秒）>_<任务名称>/boulder.json` 跟踪进度，记录每个步骤的完成状态和产出物。

Atlas 应周期性更新 boulder.json 以反映：
- 当前步骤的执行状态（`pending` / `in_progress` / `completed` / `failed`）
- 已完成的产出物路径
- 遇到的阻塞项和解决方案

---

### Step 4: 验证

Atlas 完成所有步骤后，执行最终验证：

1. 确认每个步骤的产出物是否存在且正确
2. 运行相关测试验证功能完整性
3. 更新 `.opencode/jobs/<日期时间（精确到秒）>_<任务名称>/boulder.json` 标记为 `completed`
4. 向用户报告执行结果摘要

---

## 参考

- **Prometheus agent** — 负责需求分析和计划生成，产出 `.opencode/jobs/` 下的计划文件
- **Atlas agent** — 负责根据计划执行具体开发工作，使用 boulder.json 跟踪进度

## 注意事项

- 确保在执行前计划文件已生成且内容完整
- 执行过程中如遇阻塞，Atlas 应尝试自主解决，无法解决时报告用户
- boulder.json 是任务进度的唯一真实来源，Atlas 应保持其及时更新
