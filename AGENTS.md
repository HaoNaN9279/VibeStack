# VibeStack — Agent 工作规范

## 定位

面向多种 AI Agent 工具的能力组与工具包仓库。Python 3.11+，CLI 入口 `vibe-stack`。

## 布局

```text
capability-groups/core/<version>/          # 常驻能力组
capability-groups/domain/<name>/<version>/ # 领域能力组
  └── modules/<path>/                      # 可选模块（无独立版本目录）
<project>/.vibestack/groups/<name>/       # 项目独有能力组（无版本目录，同构支持 modules/）
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
6. 加载顺序：Core → `groups` 数组顺序 → `extends` 依赖优先 → 组内 `depends` 拓扑 + 路径字典序。
7. 同名 Agent / 命令 / MCP：后加载覆盖；规则和技能路径追加。只有同一个限定 id 重复（同组同模块同名同类）才报错：`resolve` 告警保留后者，`sync` / `validate` 失败。
8. 插件不得修改 Agent 的主配置文件或用户 profile 组合（DSH 的 `cordis.patch.yml` 只由插件自己的 bundle 提供）。
9. 已发布版本目录不可修改；升级新增版本目录，`guid` 不变。
10. 工具统一通过 `vibe-stack tool ...` 调用，不写死绝对路径。
11. 能力组 Agent / 命令 / 技能只允许声明可选的 `model: <layer id>`（平台默认层 `fast` / `standard` / `strong` / `vision`）；provider、具体模型名、temperature、permission、reasoningEffort 等宿主参数不得进入能力组。四层默认路由只放在项目 `.vibestack/models.json`，本机可在全局配置逐层覆盖。
12. 插件通过 `vibe-stack resolve --json [--mode vibestack]` 获取注入计划，通过 `vibe-stack models show --json` 获取模型层目录、生效绑定与默认层；不自行解析能力组目录、版本、`extends`、frontmatter 或项目模型文件优先级。
13. DSH 能力组命令与技能统一为 `vibestack-<group>[-<module-alias>]-<name>`；会话的 Agent / 命令 / 技能列表是 Core + 当前工作区并集，子 Agent 会话沿用同一规则。
14. 模块（`modules/<path>/`）随组版本发布，不单独建版本目录、不跨组引用；跨组复用走组的 `extends`。模块不写 `guid` / `version` / `permissions` / `model`。
15. 组根内容是全局默认，模块内容是局部覆盖；模块路径必须匹配 `^[a-z0-9]+(-[a-z0-9]+)*(/...)*$`，深度 ≤3，同组 `alias` 唯一。
16. 规则 frontmatter 除 `name` 外全部可选；`scope` 只用 `global` / `module` / `paths`，没有 `scope` 时按组根 `global`、模块 `paths` 或 `module` 推断。
17. `.vibestack/stack.json` 的 `schema_version` 必须为 `2`；不做旧格式兼容，旧内容通过改写迁移。
18. 能力组、工具包、插件与文档的任何内容都不写本地绝对路径；引用一律用组内/项目内相对路径，必须指向外部位置时用 `<project-root>`、`$HOME`、`%ProgramFiles%` 之类占位符，并说明由用户按自己的路径替换。

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
- 插件只消费 `vibe-stack resolve --json` 与 `vibe-stack models show --json`，只做目标 Agent 映射
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
