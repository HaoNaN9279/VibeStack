# VibeStack × DeepSeek Harness

把 VibeStack 能力组接入 DeepSeek Harness 的插件。它新增一个 **VibeStack 工作模式**
（agent preset），不修改标准、创造、PTC、极简等现有模式；规则、技能、命令、MCP 与
Agent 人设只在进入该模式的会话里生效。

- 只消费 `vibe-stack resolve --json --project <cwd>`，不扫描能力组、不选版本、不解析
  frontmatter。
- 只在本目录内新增文件，不改 `.vibestack/`、能力组或工具包。
- 安装完全由 DSH 负责（本地目录 `link:`），不上架 npm，不走插件市场。
- 失败开放：CLI 缺失、超时、JSON 损坏、schema 不兼容都只写日志，不阻断会话。

## 安装

需要：`vibe-stack` 已安装并在 `PATH`（`uv tool install --from <repo> vibe-stack`），
DSH 桌面版 0.2.x。

装进桌面版正在使用的 profile（先完全退出桌面版，再执行）：

```bash
dsh plugin --profile desktop add "D:/workspace/VibeStack/plugins/dsh"
```

只想先试一下，可以基于官方 web 模板建一个独立 profile：

```bash
dsh --profile vstest --from-default-profile web --dump-config > /dev/null
dsh plugin --profile vstest add "D:/workspace/VibeStack/plugins/dsh"
dsh --profile vstest --port 8799 --no-open
```

> 直接 `dsh plugin --profile <新名字> add ...` 只会初始化一个 base-only profile：没有
> Web UI，也没有 `agentPresets` 注册表，此时本插件的 preset 行会停在
> `pending (waiting for service: agentPresets)`。请先按上面的方式建好 web/desktop
> profile 再安装。

安装时 pnpm 会提示 `linked in dependency will not resolve the peer dependencies`：
本插件只把 `@deepseek-ai/dsh-mcp-client` 声明为可选 peer，解析不到时 MCP 能力降级为
一条告警，其余能力不受影响。

`vibe-stack plugin install dsh` 不适用：本适配器没有声明 `install` 字段，安装动作由
`dsh plugin add` 完成（`vibe-stack plugin list` 仍能发现它）。

卸载：

```bash
dsh plugin --profile desktop remove dsh-vibestack
```

## 使用

1. 会话模式选择器里选 **VibeStack**（新会话默认仍是标准模式）。
2. 首次请求时插件解析当前会话目录的 `.vibestack/stack.json`，注入规则、技能、命令与
   MCP，并把项目里的 Agent 列表写入会话。
3. 输入区左下的 **Agent** 菜单切换本会话人设：默认选择 Core 的 `Athena`；没有可选
   Agent 时保持未选择。选择会持久化在会话里。
4. 也可以直接运行命令：

```text
/vibestack-agent           # 列出可选 Agent 与当前选择
/vibestack-agent athena    # 切换人设
```

人设只改变系统提示词（追加该 Agent 的 `system`），不限制工具，也不改变其它模式。

## 能力映射

| VibeStack 计划 | DSH 机制 | 作用域 |
|---|---|---|
| `rules` | `agent/pre-step` 注入持久 `<system-reminder>` 用户消息 | 仅 VibeStack 模式 |
| `skills` | `ctx.skills.registerProvider('vibestack')` + 自带 `vibestack` 技能 | 该 agent |
| `commands` | `ctx.commands.register()`，模板渲染后 `agent.steer()` | 该 agent |
| `mcp` | 每台服务器动态挂载 `@deepseek-ai/dsh-mcp-client` 子插件 | 该 agent |
| `agents` | 会话投影 + 输入区 Agent 菜单 + 系统提示词段落 | 该会话 |

命令模板支持 `$ARGUMENTS`、`$1`..`$9`；`` !`cmd` `` 与 `@file` 不展开。

## 配置

在 profile 的 `cordis.patch.yml` 里按行 id 覆盖（`config` 是整体替换，需写全字段）：

```yaml
- id: vibestack
  name: dsh-vibestack
  config:
    command: 'C:/Users/me/.local/bin/vibe-stack.exe'
    timeoutMs: 5000
    rules: true
    skills: true
    commands: true
    agents: true
    mcp: true
    maxRulesBytes: 65536
    defaultAgent: ''
```

| 字段 | 默认 | 含义 |
|---|---|---|
| `host` | `true` | `false` 时该行只提供客户端 UI（根级 `vibestack-ui` 行用） |
| `command` | `''` | `vibe-stack` 可执行文件；空则按 `VIBESTACK_CLI` → `vibe-stack.exe` → `vibe-stack` 查找 |
| `timeoutMs` | `5000` | 解析超时；`VIBESTACK_RESOLVE_TIMEOUT_MS` 优先 |
| `rules` | `true` | 注入规则 |
| `skills` | `true` | 暴露技能 |
| `commands` | `true` | 注册命令与 `/vibestack-agent` |
| `agents` | `true` | Agent 投影、菜单与人设段落 |
| `mcp` | `true` | 挂载 MCP 服务器 |
| `maxRulesBytes` | `65536` | 规则上下文上限 |
| `defaultAgent` | `''` | 默认 Agent 名；空则优先 `Athena` |

## 结构

```text
plugins/dsh/
├── plugin.json          # VibeStack 适配器清单
├── package.json         # DSH 组合包：dsh.bundle.patch + dsh.client
├── cordis.patch.yml     # 只 insert：根级 UI 行 + `preset-vibestack` 模式
├── index.js             # 宿主半（preset 作用域）
├── client.js            # 浏览器半（手写 bundle，仅 require react）
├── lib/                 # resolve / 缓存 / 规则 / 技能 / 命令 / 投影 / MCP
├── skills/vibestack/    # 插件自带技能
└── test/                # node:test
```

`cordis.patch.yml` 里 preset 的子插件清单镜像
`@deepseek-ai/dsh-web-app/presets/standard.patch.yml`（DSH 0.2.1-rc.3）。preset 没有继承
机制，DSH 升次要版本时需要同步这份清单。

## 验证

```bash
# 用 DSH 运行时的 node（沙箱内不能跑 `node --test <dir>`：子进程管道会被拦）
node test/agents.test.js && node test/config.test.js && node test/commands.test.js \
  && node test/mcp.test.js && node test/plans.test.js && node test/resolve.test.js \
  && node test/rules.test.js && node test/skills.test.js && node test/plugin.test.js
```

`plugin.test.js` 用内存版 Cordis 上下文跑完整链路：解析 → 规则注入去重 → Agent 投影 →
命令注册与执行 → 人设段落切换。

安装后检查：

```bash
dsh --profile <profile> --dump-config | grep -i -A2 vibestack
```

已在 DSH 0.2.1-rc.3 / Windows 上验证：

- `dsh plugin --profile <p> add <本地目录>` 建立 `link:` 依赖成功，`--dump-config`
  出现 `# == dsh-vibestack` 层与 `preset-vibestack` 行。
- 用官方 web 模板启动时，启动图包含 `{"id":"dsh-vibestack"}`，
  `/plugins/??dsh-vibestack/client.js` 返回 200，且没有未激活告警。
- `node test/*.test.js` 全绿。

## 排查

日志前缀 `vibestack:`，常见原因：

- `vibe-stack` 不在 `PATH`（桌面版从 GUI 启动时继承的环境可能没有 `~/.local/bin`），
  用 `command` 配置绝对路径。
- 会话目录不是项目根（必须含 `.vibestack/stack.json`）；子目录会话视为未激活。
- 解析超时：调大 `timeoutMs` 或 `VIBESTACK_RESOLVE_TIMEOUT_MS`。
- MCP 未出现：macOS/Windows 桌面版需要 `@deepseek-ai/dsh-mcp-client` 可被运行时解析；
  解析不到时插件只记一条告警并跳过，其它能力不受影响。
- Agent 菜单不出现：确认会话模式是 VibeStack，且项目至少激活了一个含 `agents/` 的
  能力组（Core 自带 `Athena`、`Hermes`）。
