# VibeStack — Agent 工作规范

## 定位

面向多种 AI Agent 工具的能力组与工具包仓库。Python 3.11+，CLI 入口 `vibe-stack`。

## 布局

```text
capability-groups/<name>/<version>/   # 能力组
tools/<name>/<version>/               # 工具包
plugins/<agent>/                      # Agent 插件适配器
src/vibe_stack/                       # Python 核心
tests/                                # pytest
```

## 硬性规则

1. 能力组不包含 `mcp/`、`tools/`、`pyproject.toml` 或工具源码。
2. MCP 是工具包的一种 `provider`，不单独放在能力组里。
3. 项目部署只写 `.vibestack/`，不复制、不链接内容到 `.opencode/`。
4. Core 只在项目存在 `.vibestack/stack.json` 时加载。
5. 加载顺序：Core → `groups` 数组顺序 → `extends` 依赖优先。
6. 同名 Agent / 命令 / MCP：后加载覆盖；规则和技能路径追加。
7. 插件不得修改 Agent 的主配置文件（如 `~/.config/opencode/opencode.json`）。
8. 已发布版本目录不可修改；升级新增版本目录，`guid` 不变。
9. 工具统一通过 `vibe-stack tool ...` 调用，不写死绝对路径。
10. 模型参数（model、temperature、permission）不进入能力组 Agent 定义。

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
- `plugin.json` 描述入口、安装目标和能力
- OpenCode 插件使用 `config` hook 原地修改配置
- 插件无第三方依赖，失败不得阻断 Agent 启动
- 安装只复制文件到插件目录，不修改 Agent 配置

## 测试

```bash
uv sync
uv run pytest -q
cd plugins/opencode && bun test
```

## 提交

- 只提交预期文件
- 迁移工具来自 GitHub 时记录 `source.url` 和 `source.commit`
- 不提交模型权重、`.venv`、构建产物
