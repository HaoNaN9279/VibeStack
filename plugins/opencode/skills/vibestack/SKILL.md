---
name: vibestack
description: 使用 VibeStack 能力组、项目 .vibestack 配置和 vibe-stack CLI。需要激活、停用、排查或扩展能力组时加载。
---

# VibeStack

VibeStack 用能力组（capability group）组织 Agent 配置。OpenCode 插件启动时调用
`vibe-stack resolve --json`，再把返回的注入计划映射到 Agent 配置；插件不自行
解析能力组。

## 加载顺序

1. Core 能力组
2. `.vibestack/stack.json` 中 `groups` 数组顺序
3. `extends` 依赖先于依赖者
4. 同名 Agent / 命令 / MCP 后加载者覆盖
5. 规则、技能路径追加

项目没有 `.vibestack/stack.json` 时，Core 不加载。

## 项目配置

```json
{
  "schema_version": 1,
  "core": { "name": "core", "version": "0.1.0" },
  "agents": ["opencode"],
  "groups": [
    { "name": "data-forge", "version": "1.0.0" },
    { "name": "blender", "version": "1.0.0" }
  ]
}
```

不要手动复制规则、技能或 Agent 到 `.opencode/`。改 `stack.json` 后重启 Agent。

## 常用命令

```bash
vibe-stack init                       # 创建 .vibestack/stack.json
vibe-stack list                       # 列出能力组
vibe-stack status                     # 查看当前项目激活项
vibe-stack info <group>               # 查看能力组详情
vibe-stack activate <group>[@version]
vibe-stack deactivate <group>
vibe-stack sync                       # 严格校验并重写 .vibestack/lock.json
vibe-stack resolve --json             # 输出只读注入计划，供插件消费
vibe-stack tool list
vibe-stack tool run <tool> -- <args>
vibe-stack tool serve <tool>          # MCP stdio
vibe-stack plugin install opencode
vibe-stack plugin status opencode
```

## 工具

能力组的 `tools` 字段引用工具包，例如：

```text
tool:<guid>@v0.2.1
```

不要依赖工具目录的绝对路径。统一通过 `vibe-stack tool run` 或
`vibe-stack tool serve` 调用。首次运行自动执行 `uv sync`。

## 扩展能力组

- Core 组：`capability-groups/core/<version>/group.json`
- 领域能力组：`capability-groups/domain/<name>/<version>/group.json`
- 内容目录：`rules/`、`agents/`、`commands/`、`skills/`、`references/`
- 工具包：`tools/<name>/<version>/tool.json`
- Agent 适配器：`plugins/<agent>/`
- 版本目录发布后不可修改；升级新建版本目录，`guid` 不变

## 排查

```bash
vibe-stack status
vibe-stack sync
vibe-stack resolve --json
cat .vibestack/lock.json
```

`lock.json` 记录解析后的能力组路径、依赖和工具引用。插件告警通常表示：
`vibe-stack` 未安装或超时、API schema 不兼容、仓库路径未配置、组版本不存在、
工具包缺失或 JSON 损坏。

插件通过 `vibe-stack resolve --json` 获取注入计划；不要要求插件重新实现组发现、
版本选择或 frontmatter 解析。
