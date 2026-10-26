---
name: custom-tool
description: 当用户需要创建或管理 VibeStack 工具包时使用
license: MIT
compatibility: opencode
metadata:
  audience: contributors
  category: configuration
---

# Custom Tool — 工具包制作指南

工具包是可执行能力的唯一载体。能力组只声明引用，不包含工具代码。

## 1. 目录

```text
tools/<name>/<version>/
├── tool.json
├── pyproject.toml          # Python 工具
├── src/                    # 可选
├── tests/                  # 可选
└── README.md
```

## 2. tool.json

```json
{
  "schema_version": 1,
  "guid": "32位小写hex",
  "name": "video-transcribe",
  "tool_name": "video_transcribe",
  "version": "0.1.0",
  "description": "视频转写工具",
  "provider": "python",
  "entrypoint": "video_transcribe:main",
  "permissions": ["fs", "exec", "net"],
  "idempotent": false,
  "source": { "type": "local" },
  "run": {
    "kind": "uv",
    "command": "video-transcribe"
  },
  "mcp": null
}
```

字段：

| 字段 | 说明 |
|---|---|
| `guid` | 32 位小写十六进制，所有版本保持不变 |
| `name` / `version` | 必须与目录名一致 |
| `provider` | `python`、`mcp`、`builtin`、`sandbox`、`app` |
| `entrypoint` | Python 入口，格式 `<module>:<attr>` |
| `permissions` | `fs`、`net`、`exec`、`secrets` 的子集 |
| `run` | Python 工具的运行配置：`kind: uv`、`command`、`serve_command` |
| `mcp` | 可选 MCP 配置；插件据此注入 MCP |
| `source` | `local` 或 `git`（含 `url`、`commit`、`tag`） |

## 3. 能力组引用

```json
{
  "tools": ["tool:<guid>@v0.1.0"],
  "tool_permissions": {
    "tool:<guid>@v0.1.0": ["fs", "exec", "net"]
  }
}
```

## 4. 运行

```bash
vibe-stack tool list
vibe-stack tool run <tool> -- <args>
vibe-stack tool serve <tool>
vibe-stack tool exec <tool> -- python -m <module>
```

首次运行自动执行 `uv sync --project <tool-dir>`。

## 5. 规则

- 不在能力组内放 `pyproject.toml`、`tools/` 或工具源码。
- 不写死仓库绝对路径；统一通过 `vibe-stack` 调用。
- GitHub 来源的工具重新部署时记录 `source.url`、`source.commit`、`source.tag`。
- 已发布版本目录不可修改；升级新增版本目录。
- 不把模型权重、构建产物、`.venv` 提交到仓库。
