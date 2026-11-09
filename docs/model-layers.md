# 模型层

模型层是 VibeStack 平台级的命名路由档位。能力组只引用层 id；层到具体模型的路由留在本机，由各 Agent 适配器绑定。这样同一份能力组可以在 DSH、HNFlow 或其他 Agent 上复用，不把 provider、模型名、凭据写进仓库。

## 1. 归属

| 内容 | 归属 |
|---|---|
| 层 id、名称、描述、排序、默认层 | Python Core（`src/vibe_stack/model_layers.py`） |
| 能力组的 `model` 校验 | Resolver |
| 层 → provider/model/reasoningEffort 绑定 | 本机全局配置，按 Agent 分域 |
| 把层应用到会话 | 各 Agent 插件 |
| DSH 用户自定义层 | 仅 DSH 本机配置；不进入共享内容 |

## 2. 默认层

| id | 名称 | 定位 |
|---|---|---|
| `fast` | 快速 | 检索、摘要、文档查找、简单编辑、格式转换 |
| `standard` | 标准 | 日常开发、命令执行、脚手架、普通问答；默认层 |
| `strong` | 深度 | 架构、规划、复杂调试、代码审查、疑难根因 |
| `vision` | 多模态 | 图像、截图、PDF 页面理解 |

DSH 当前默认绑定四层全部为 `deepseek-account / deepseek-flash`；用户可在设置页或 CLI 改绑定。

## 3. 能力组写法

Agent / 命令 / 技能 frontmatter 只允许可选的 `model`：

```yaml
---
name: Hermes
description: 快速问答与轻量任务执行。
mode: primary
model: fast
---
```

- `model` 可省略；省略表示继承会话当前模型路由，不主动切换。
- 值必须是上表中的平台层 id。
- 不得写 provider、具体模型名、`temperature`、`permission`、`reasoningEffort`。
- DSH 自定义层只在 DSH 本机可用，不能写进共享能力组或 HNFlow 流程。

## 4. resolve 输出

`vibe-stack resolve --json`（schema v2）新增：

```json
{
  "model_layers": [
    { "id": "fast", "label": "快速", "description": "...", "kind": "speed", "rank": 1 },
    { "id": "standard", "label": "标准", "description": "...", "kind": "balanced", "rank": 2 },
    { "id": "strong", "label": "深度", "description": "...", "kind": "reasoning", "rank": 3 },
    { "id": "vision", "label": "多模态", "description": "...", "kind": "multimodal", "rank": 4 }
  ],
  "model_default": "standard"
}
```

`--api-version 1` 不输出这两个字段。未知层写入 `warnings` 并省略该条目的 `model`。

## 5. 本机绑定

全局配置 `~/.config/vibestack/config.json`：

```json
{
  "models": {
    "default": "standard",
    "bindings": {
      "dsh": {
        "fast": { "provider": "deepseek-account", "model": "deepseek-flash" },
        "standard": { "provider": "deepseek-account", "model": "deepseek-flash" },
        "strong": { "provider": "deepseek-account", "model": "deepseek-flash" },
        "vision": { "provider": "deepseek-account", "model": "deepseek-flash" }
      }
    }
  }
}
```

- `bindings.<agent>` 的 `<agent>` 与 `plugins/<agent>/plugin.json` 的 `agent` 一致。
- `default` 是全局默认层。
- 未绑定的平台层仍会出现在目录中，但不能应用。
- 绑定文件由 CLI 与插件共同维护，写入必须原子替换；旧 `models.layers` 由 `vibe-stack models migrate` 迁移。

DSH 自定义层放在 `models.custom.dsh`，只能通过 DSH 设置页或插件读写；其他 Agent 与共享能力组不可见。

## 6. CLI

```bash
vibe-stack models catalog [--json]                 # 平台层目录，不需要项目
vibe-stack models show [--agent dsh] [--json]      # 目录 + 本机绑定
vibe-stack models bind <layer> --agent dsh --provider <p> --model <m> [--effort <e>]
vibe-stack models unbind <layer> --agent dsh
vibe-stack models default <layer|none>
vibe-stack models migrate [--agent dsh]
```

## 7. 适配器契约

新增 Agent 适配器时必须：

1. 从 `vibe-stack models catalog --json`（或 resolve 的 `model_layers`）读取层目录，不硬编码层 id、label、默认层。
2. 读取 `models.bindings.<agent>`，或通过 CLI 读写；不同宿主不得共用一份 provider/model 映射。
3. 未绑定层可以展示但不可应用；应用失败只告警，不阻断会话。
4. 能力组未指定 `model` 时不切换会话模型。
5. `plugin.json` 的 `capabilities` 声明 `models`；不支持时明确告警。
6. 不得把 provider/model/temperature/permission 写入能力组、项目或 `.vibestack/`。

## 8. 失败与迁移

| 情况 | 行为 |
|---|---|
| 层目录不可用 | 插件告警；会话照常启动；模型层功能禁用 |
| 层未绑定 | 列出并标记“未绑定”；应用时告警 `layer-unbound` |
| 绑定路由不在宿主目录 | 设置页/`catalog()` 标记不可路由；不自动改绑定 |
| 旧 `models.layers` | 读取兼容并告警；`vibe-stack models migrate` 转为 `bindings.dsh`，`flash` → `fast` |
| 能力组引用未知层 | resolver 告警并省略 `model`；不会运行到未定义层 |
