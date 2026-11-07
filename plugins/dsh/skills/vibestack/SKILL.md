---
name: vibestack
description: 使用 VibeStack 能力组、项目 .vibestack 配置与 vibe-stack CLI。在 VibeStack 模式中需要激活、排查或扩展能力组，或需要了解当前 Agent 人设时加载。
---

# VibeStack

VibeStack 用能力组（capability group）组织 Agent 配置。进入 DeepSeek Harness 的
**VibeStack 模式**后，插件调用 `vibe-stack resolve --json --mode vibestack`，把返回的
注入计划映射到本会话：规则、技能、命令、MCP 与 Agent 人设。插件不扫描能力组、不选版本、
不解析 frontmatter。

## 加载顺序

1. Core 能力组（**VibeStack 模式下始终加载**，与项目是否有 `.vibestack/stack.json` 无关）
2. `.vibestack/stack.json` 中 `groups` 数组顺序
3. `extends` 依赖先于依赖者
4. 同名 Agent / 命令 / MCP 后加载者覆盖
5. 规则、技能路径追加

因此 VibeStack 会话里的 Agent、命令、技能列表始终是 **Core + 当前工作区并集**。
项目没有 `.vibestack/stack.json` 时只有 Core；子目录会话按子目录解析，通常也只有 Core。

## Agent 人设

会话输入区左下的 **Agent** 菜单切换本会话人设，列出 **Core 的 Agent + 当前工作区依赖
的能力组 Agent 并集**（`mode: subagent` 的 Agent 只在名册/子任务中，不进入人设菜单），
并标注来源组。默认选择 `Athena`。也可以用命令：

```text
/vibestack-agent          # 列出可选 Agent
/vibestack-agent athena   # 切换人设
```

人设只改变系统提示词，不限制工具，也不改变其它工作模式。子 Agent 会话继承同一 preset，
按同一份 Core + 工作区并集生成名册。

## 项目配置

```json
{
  "schema_version": 1,
  "core": { "name": "core", "version": "0.1.0" },
  "agents": ["dsh"],
  "groups": [
    { "name": "data-forge", "version": "1.0.0" }
  ]
}
```

改 `stack.json` 后无需重启：下一次请求会重新解析。不要手动复制规则、技能或 Agent。

## 常用命令

```bash
vibe-stack status                 # 查看当前项目激活项
vibe-stack list                   # 列出能力组
vibe-stack activate <group>[@version]
vibe-stack deactivate <group>
vibe-stack sync                   # 严格校验并写 .vibestack/lock.json
vibe-stack resolve --json         # 只读注入计划，供插件消费
vibe-stack tool list
vibe-stack tool run <tool> -- <args>
vibe-stack tool serve <tool>      # MCP stdio
```

能力组命令与技能统一发布为 `vibestack-<group>-<name>`：

- `/vibestack-core-auto-git-commit`
- `/vibestack-group-forge-group-new`

命令模板支持 `$ARGUMENTS`、`$1`..`$9`；`` !`cmd` `` 与 `@file` 在 DeepSeek Harness 中
不展开。Core 命令在任何 VibeStack 会话可执行；领域组命令只有在当前工作区激活了该组时
才执行，否则返回“不属于当前工作区”。

## 模型层

能力组 Agent / 命令 / 技能可以写可选的 `model: <layer>`。层是本机配置
（`~/.config/vibestack/config.json` 的 `models` 段），不含凭据；设置页
「VibeStack 模型层」可增删改，输入框左下的 `◈` 菜单切换当前会话的层。
`/vibestack-layer` 可列出层，`/vibestack-layer strong` 直接切换。层只影响会话路由，
不改变工具、权限或沙箱；未定义层只告警，不阻断提示词。

## 开发能力组

需要创建或修改能力组时，加载 `group-forge` 能力组的 `custom-group` 技能（以及
`custom-agent` / `custom-command` / `custom-rule` / `custom-skill` / `custom-tool` /
`custom-mcp`）。该组是领域组，默认不激活；在 VibeStack 仓库根目录的
`.vibestack/stack.json` 中加入 `group-forge` 即可。

## 工具

能力组通过统一工具 ID 引用工具包：

```text
tool:<guid>@v<version>
```

不要依赖工具目录的绝对路径。MCP 工具包会以 `mcp__vibe_<group>_<server>__<tool>`
出现在工具列表中；在云端/桌面模式下这些服务器随会话启动。

## 扩展能力组

- Core：`capability-groups/core/<version>/group.json`
- 领域：`capability-groups/domain/<name>/<version>/group.json`
- 内容目录：`rules/`、`agents/`、`commands/`、`skills/`、`references/`
- 工具包：`tools/<name>/<version>/tool.json`
- 版本目录发布后不可修改；升级新建版本目录，`guid` 不变

## 排查

```bash
vibe-stack status
vibe-stack sync
vibe-stack resolve --json --mode vibestack
cat .vibestack/lock.json
```

插件告警写在宿主日志（`vibestack:` 前缀），常见原因：`vibe-stack` 未安装或不在
`PATH`、解析超时（`VIBESTACK_RESOLVE_TIMEOUT_MS`）、schema 版本不兼容、仓库路径未
配置、组版本不存在、工具包缺失。当前目录不是项目根时 Core 仍然生效，只是没有领域组。
