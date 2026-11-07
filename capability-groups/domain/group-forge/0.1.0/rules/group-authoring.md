---
name: group-authoring
---

# 能力组制作规则

本能力组用于开发 VibeStack 自身的能力组内容。以下规则只在本能力组激活时注入。

## 目录与边界

- Core：`capability-groups/core/<version>/`；领域：`capability-groups/domain/<name>/<version>/`。
- 能力组只放 `group.json`、`rules/`、`agents/`、`commands/`、`skills/`、`references/`。
- 不在能力组内创建 `mcp/`、`tools/`、`pyproject.toml` 或工具源码；工具放在仓库根部 `tools/<name>/<version>/`，由 `group.json` 的 `tools` 引用。
- 不把模型、温度、权限写进 Agent / 命令 / 技能定义。

## 版本与标识

- `group.json` 的 `name`、`version` 必须与目录名一致；`guid` 跨版本保持不变。
- 已发布版本目录不可修改；升级新建版本目录，并更新项目 `stack.json` 的引用版本。
- 新组的 `guid` 使用 32 位小写十六进制，且全仓唯一。
- 技能目录名、技能 `name`、`SKILL.md` 必须一致，且匹配 `^[a-z0-9]+(-[a-z0-9]+)*$`。

## 校验与交付

- 内容必须带 frontmatter：规则 `name`；Agent `name`/`description`/`mode`；命令 `name`/`description`；技能 `name`/`description`。
- 完成后运行 `vibe-stack resolve --json --project <project>`，确认新内容出现且无告警；必要时运行 `vibe-stack sync` 写 `lock.json`。
- 项目激活只改 `.vibestack/stack.json`；不把能力组内容复制到项目或 Agent 配置目录。
- 规则按加载顺序追加，同名 Agent / 命令 / MCP 后加载者覆盖；设计命名时优先避免跨组同名。

## 本能力组的定位

- `group-forge` 是领域能力组，不默认加载；需要在项目中显式激活。
- 它不包含任何常驻规则，只有开发能力组时才有意义。
