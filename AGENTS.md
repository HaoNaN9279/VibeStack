# VibeStack — Agent 工作规范

## 定位

面向多种 AI Agent 工具的能力组与工具包仓库。Python 3.11+，CLI 入口 `vibe-stack`。

## 布局

```text
capability-groups/core/<version>/          # 常驻能力组
capability-groups/domain/<name>/<version>/ # 领域能力组
<project>/.vibestack/groups/<name>/       # 项目独有能力组（无版本目录）
tools/<name>/<version>/                    # 工具包
plugins/<agent>/                           # Agent 插件适配器
src/vibe_stack/                            # Python 核心
tests/                                     # pytest
```

## 硬性规则

1. 能力组不包含 `mcp/`、`tools/`、`pyproject.toml` 或工具源码。
2. MCP 是工具包的一种 `provider`，不单独放在能力组里。
3. 项目部署只写 `.vibestack/`，不复制、不链接内容到 `.dsh/` 等 Agent 私有目录。
4. Core 的加载规则按 resolve 模式区分：`project` 模式只在项目存在 `.vibestack/stack.json` 时加载；`vibestack` 模式（DSH VibeStack 会话）**无条件加载**，即使目录不是项目根。
5. Domain 能力组只在 `.vibestack/stack.json` 的 `groups` 中列出时加载，不默认激活。
6. 加载顺序：Core → `groups` 数组顺序 → `extends` 依赖优先。
7. 同名 Agent / 命令 / MCP：后加载覆盖；规则和技能路径追加。
8. 插件不得修改 Agent 的主配置文件或用户 profile 组合（DSH 的 `cordis.patch.yml` 只由插件自己的 bundle 提供）。
9. 已发布版本目录不可修改；升级新增版本目录，`guid` 不变。
10. 工具统一通过 `vibe-stack tool ...` 调用，不写死绝对路径。
11. 能力组 Agent / 命令 / 技能只允许声明可选的 `model: <layer id>`（平台默认层 `fast` / `standard` / `strong` / `vision`）；provider、具体模型名、temperature、permission、reasoningEffort 等宿主参数不得进入能力组。
12. 插件通过 `vibe-stack resolve --json [--mode vibestack]` 获取注入计划，通过 `vibe-stack models catalog --json` 获取模型层目录；不自行解析能力组目录、版本、`extends` 或 frontmatter。
13. DSH 能力组命令与技能统一为 `vibestack-<group>-<name>`；会话的 Agent / 命令 / 技能列表是 Core + 当前工作区并集，子 Agent 会话沿用同一规则。

## Python 规范

- `from __future__ import annotations`
- 所有函数完整类型注解
- 路径使用 `pathlib.Path`
- 数据模型用 dataclass
- 自定义异常继承 `VibeStackError`
- 仅标准库运行时依赖
- 测试文件 `tests/test_*.py`

## 插件规范

- 每个 Agent 一个目录：`plugins/<agent>/`
- `plugin.json` 描述入口与能力；DSH 适配器不声明复制式安装目标
- 当前唯一适配器是 `plugins/dsh/`；安装由 `dsh plugin add` 完成
- 插件只消费 `vibe-stack resolve --json` 与 `vibe-stack models catalog --json`，只做目标 Agent 映射
- 插件无第三方依赖，失败不得阻断 Agent 启动
- 插件只在本目录内新增文件，不改能力组、工具包或用户 profile

## 测试

```bash
uv sync
uv run pytest -q
node plugins/dsh/test/agents.test.js
node plugins/dsh/test/plugin.test.js
# 其余 DSH 测试文件逐个运行，见 plugins/dsh/README.md
```



## 提交

- 只提交预期文件
- 迁移工具来自 GitHub 时记录 `source.url` 和 `source.commit`
- 不提交模型权重、`.venv`、构建产物
