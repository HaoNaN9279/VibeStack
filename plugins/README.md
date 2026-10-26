# Agent plugins

Agent 插件统一放在 `plugins/<agent>/`。

```text
plugins/<agent>/
├── plugin.json        # 适配器清单
├── index.ts           # 入口
├── index.test.ts      # 可选测试
└── skills/            # 可选默认技能
```

`plugin.json`：

```json
{
  "schema_version": 1,
  "name": "opencode",
  "agent": "opencode",
  "version": "0.1.0",
  "entrypoint": "index.ts",
  "install": {
    "kind": "copy",
    "target": "~/.config/opencode/plugins/vibestack.ts",
    "skills_target": "~/.config/opencode/plugins/vibestack-skills"
  },
  "capabilities": ["rules", "agents", "commands", "skills", "mcp", "tools"]
}
```

规则：

- 插件只读取能力组和工具包，不复制内容到项目。
- 安装只复制插件文件，不修改 Agent 主配置。
- 插件读取项目 `.vibestack/stack.json`，无文件时不加载 Core。
- 默认技能用于指导 Agent 使用 VibeStack。
- 新 Agent 新增同级目录，不改能力组和工具包。

安装：

```bash
vibe-stack plugin install <agent>
vibe-stack plugin status <agent>
```

当前适配器：`opencode`。
