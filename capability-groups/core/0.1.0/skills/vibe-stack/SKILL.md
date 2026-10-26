---
name: vibe-stack
description: 管理 VibeStack 能力组：查看、激活、停用、同步项目配置，以及运行能力组工具。
---

# VibeStack

VibeStack 用能力组组织 AI Agent 配置。OpenCode 插件读取项目 `.vibestack/stack.json`，启动时注入规则、Agent、命令、技能和 MCP。

## 前置条件

- `vibe-stack` CLI 在 PATH 中可用。
- 已运行 `vibe-stack plugin install opencode`（首次使用）。
- 项目含 `.vibestack/stack.json`。没有该文件时 Core 不加载。

## 加载顺序

1. Core 能力组
2. `.vibestack/stack.json` 的 `groups` 数组顺序
3. `extends` 依赖先于依赖者
4. 同名 Agent / 命令 / MCP 后加载者覆盖

## 常用命令

```bash
vibe-stack list                       # 列出能力组与工具
vibe-stack status                     # 查看当前项目
vibe-stack info <group>               # 查看组详情
vibe-stack init                       # 创建 .vibestack/stack.json
vibe-stack activate <group>[@version] # 激活
vibe-stack deactivate <group>         # 停用
vibe-stack sync                       # 校验并写 .vibestack/lock.json
```

激活只修改 `.vibestack/stack.json`，不复制或链接内容到 `.opencode/`。修改后重启 Agent。

## 工具

```bash
vibe-stack tool list
vibe-stack tool run <tool> -- <args>
vibe-stack tool serve <tool>          # MCP stdio
vibe-stack tool exec <tool> -- python -m <module>
```

不要在技能中写死仓库绝对路径。工具首次运行会自动执行 `uv sync`。

## 项目配置示例

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

## 排查

```bash
vibe-stack status
vibe-stack sync
cat .vibestack/lock.json
```

`lock.json` 记录解析后的组路径、依赖和工具引用。常见告警：仓库路径未配置、组版本不存在、工具包缺失、JSON 损坏。
