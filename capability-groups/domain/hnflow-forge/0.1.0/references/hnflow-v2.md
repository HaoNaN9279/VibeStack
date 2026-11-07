# HNFlow 定义速查（dsh-hnflow 0.6.0 / schemaVersion 2）

来源：`D:\workspace\HNFlow\plugins\dsh`（`lib/flow/*`、`lib/tools.js`、`lib/author.js`、`lib/commands.js`、`lib/scheduler.js`）。插件升级时同步本文件。

## 定义外壳

`{ schemaVersion: 2, flow: { id, name, description?, tags? }, input?, nodes[], edges[] }`

## 六种节点

| 类型 | 执行者 | 必填 | 产出（下游可见的 output） |
| --- | --- | --- | --- |
| `agent` | preset 子 Agent | `preset`、`instruction`、`output` | 自己声明的 `output` |
| `judge` | 另一个 preset 子 Agent | `preset`、`instruction`、`criteria` | 固定：`verdict`、`reasons`、`conditions?` |
| `merge` | 插件（确定性） | `output`，且 `from[]` 或 `set{}` 非空 | 自己声明的 `output` |
| `gate` | 人 | 无（`title`/`detail` 建议写） | 固定：`decision`、`reason?`、`decidedAt?` |
| `request` | 人 + 验收 | `deliverable`、`whyHuman` | `deliverable` 的实际交付物 |
| `verify` | 插件（+ 可选 judge） | `against`（指向 `request`） | 固定：`accepted`、`violations`、`judged?` |

## 边

```jsonc
{ "id": "e1", "from": "a", "to": "b",
  "when": { "kind": "status", "is": "done" },
  "accepts": { "type": "object", "properties": {…} },
  "onFail": { "kind": "block" } }
```

求值（`scheduler.js`）：

| kind | 成立条件 |
| --- | --- |
| `always` | 总是 |
| `status` | 上游 `status === is`（`done` / `failed` / `skipped`） |
| `verdict` | 上游 `done` 且 `verdict === is`（`accept` / `reject` / `needs_more`） |
| `gate` | 上游 `done` 且 `output.decision === is`（`approved` / `rejected` / `modified`） |
| `artifact.accepted` | 上游 `done` 且 `output.accepted === is` |

`onFail`：`block`（默认）/ `skip` / `fallback`（需 `node`）。

## 子 Agent 信封

```jsonc
{ "status": "done", "output": {…}, "evidence": ["…"] }
{ "status": "needs_human", "needsHuman": { "reason": "capability_gap|real_world_judgement|authority|ambiguous_intent|asset_unavailable", "deliverable": {…}, "whyHuman": "…" } }
{ "status": "failed", "error": { "code": "…", "message": "…" } }
```

`needs_human` 只在节点 `allowHuman: true` 时被接受；插件创建交付请求，人提交后继续**同一节点**。子 Agent 限制：`maxDepth 0`（不能再委派）、不能向用户提问、不能执行需审批操作。

## schema 子集

`type`、`properties`、`required`、`additionalProperties`（布尔）、`items`、`enum`、`const`、`oneOf`。顶层必须 `type: "object"`；同 schema 禁 `type` + `oneOf`；越界 → `schema-unsupported`。

## instruction 模板

`{{input.<字段>}}`、`{{nodes.<节点id>.output.<字段>}}`、`{{flow.name}}`。未命中 → 空串；上游产物超 8000 字符截断。

## 工具面

`hnflow`（15 动作）：`list_flows`、`list_library`、`describe_flow`、`run`、`status`、`list_runs`、`cancel`、`resume`、`inbox`、`artifact`、`add_ref`、`remove_ref`、`rename_ref`、`pin`、`history`。

`hnflow_author`（7 动作，**无 publish**）：`schema`、`validate`、`create`、`draft`、`promote`、`delete`、`rename`。

工具只在 HNFlow 模式注册；`/hnflow ...` 命令在任意会话可用（作用于当前工作区）。

## 人的入口（工具没有）

| 动作 | 入口 |
| --- | --- |
| 发布已有库资产 | `/hnflow publish <流程>` → `confirm`，或页面按钮 |
| 回滚 | `/hnflow rollback <流程> rN confirm` |
| 门禁裁决 / 人工交付 | 页面收件箱 / 原生问题卡 |
| 旧格式导入 | `/hnflow import <名称> <工作区内文件>`（v2 定义原样通过，校验后落库 r1 并引用） |

## 作用域与存储

```text
$DSH_HOME/hnflow/library/<目录>/<name>.flow.json          资产（asset + definition）
$DSH_HOME/hnflow/library/.hnflow-revisions/<id>/rN.json    不可变快照 + lockfile
<workspace>/.hnflow/flows.json                            引用（可钉 revision）
<workspace>/.hnflow/overrides/<flowId>.flow.json          工作区草稿；local:true 且无引用 = 项目草稿
```

项目草稿：可运行、改名、删除、`promote`；**不能** publish / pin / rollback（报 `local-flow`）。库资产改动走 `draft` + 人发布。

## 执行语义

- `run` 立即返回 `runId`；不要轮询、不要在对话里模拟节点。
- `interrupted` 不会自动续跑，需显式 `resume`。
- 并发受宿主 `maxParallel`（默认 3）与 `maxActiveSubagents`（8）约束。
- 降级（fallback / arbitrate）会被标记，不静默通过；`verify` 的 `onInconclusive` 决定 judge 不确定时转门禁还是失败。
- token 用量归因到节点。

## 校验错误码

`definition-invalid`、`node-id-invalid`、`node-type-invalid`、`contract-unsatisfiable`、`input-unbound`、`gate-branches-incomplete`、`judge-same-as-producer`、`preset-not-allowed`、`preset-unknown`、`preset-broken`、`model-layer-unknown`、`model-layer-unroutable`、`cycle-unsupported`、`graph-shape-invalid`、`request-contract-missing`、`reject-policy-invalid`、`merge-map-invalid`、`schema-unsupported`、`schema-invalid`、`vibestack-unavailable`。

## 静态约束小结

单起点 + 单终点；无环；gate 有出边必须三分支齐全；judge preset ≠ 任一祖先 agent preset；`preset` 必须在 allowlist 且可解析；`model` 必须是可解析的层；非 agent/judge 不能写 preset；`merge.map` 的源必须是自己的 `from` 成员。
