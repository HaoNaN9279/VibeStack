# DataForge 使用规则

- 工具入口统一为 `vibe-stack`，不要依赖仓库绝对路径。
- 启动 MCP：`vibe-stack tool serve data-forge`
- 执行模块：`vibe-stack tool exec data-forge -- python -m <module> [args]`
- 首次使用自动执行 `uv sync`；失败时手动运行 `uv sync --project tools/data-forge/0.2.1`。
- 能力组只保存规则与技能文本，工具代码位于仓库 `tools/data-forge/0.2.1/`。
