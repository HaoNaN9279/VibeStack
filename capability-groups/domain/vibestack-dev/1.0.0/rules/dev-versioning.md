---
name: dev-versioning
---

# 开发阶段：能力组不做版本管理

VibeStack 仓库处于开发阶段，能力组内容不按版本迭代管理。

- 所有内容更新（`group.json`、rules、agents、commands、skills）直接写入现有版本目录，当前为 `1.0.0`。
- 不新建版本目录，不改 `group.json` 的 `version`；`guid` 保持不变。
- `version` 必须与版本目录名一致。
- 只有用户明确宣布发布并要求升级版本时，才新建 `<new-version>/` 并迁移内容。
- 本规则优先于仓库 `AGENTS.md` 的「已发布版本目录不可修改」，发布后失效。