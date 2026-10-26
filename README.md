# VibeStack

HNFlow 能力组与工具包仓库。

## 目录结构

```text
VibeStack/
├── capability-groups/
│   └── <group-name>/
│       └── <version>/
│           ├── group.json
│           ├── rules/
│           ├── agents/
│           ├── skills/
│           └── ...
└── tools/
    └── <tool-name>/
        └── <version>/
            ├── tool.json
            └── ...
```

## 能力组

每个能力组使用 `<group-name>/<version>/group.json` 定义，`group.json` 字段：

```json
{
  "guid": "32 位小写十六进制 ID",
  "name": "group-name",
  "version": "0.1.0",
  "description": "能力组说明",
  "permissions": ["fs"],
  "extends": [],
  "tools": ["builtin:read_file"],
  "tool_permissions": {
    "builtin:read_file": ["fs"]
  }
}
```

- `guid` 在能力组的所有版本中保持不变。
- `name`、`version` 必须与目录名一致。
- `extends` 引用其他能力组名称。
- 其他文件按目录分类：`rules/`、`agents/`、`skills/`、`references/`、`templates/`、`assets/`、`evals/`。

## 工具包

工具包位于 `tools/<tool-name>/<version>/`，由 `tool.json` 定义：

```json
{
  "schema_version": 1,
  "guid": "32 位小写十六进制 ID",
  "name": "tool-name",
  "tool_name": "tool_name",
  "version": "0.1.0",
  "description": "工具说明",
  "provider": "python",
  "entrypoint": "tool.py:build_tool",
  "permissions": [],
  "idempotent": true
}
```

能力组通过统一工具 ID 引用工具：

```text
tool:<guid>@v<version>
mcp:<server>:<tool>
builtin:<name>
sandbox:<name>
app:<name>
```

## 版本规则

- 已发布版本目录不可修改。
- 升级能力组或工具时新增版本目录。
- `guid` 不随版本变化。
