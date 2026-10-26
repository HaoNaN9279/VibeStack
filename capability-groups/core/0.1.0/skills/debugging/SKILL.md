---
name: debugging
description: "必须用于跨任何语言或二进制文件的任何实际运行时调试——崩溃、无声失败、错误响应、进程卡住、内存泄漏、异步行为异常、无法解释的计时、逆向工程。运行一个基于假设的循环：形成≥3个假设，并行调查，在2轮失败后从正交角度生成预言机，确认根本原因，用失败的测试锁定，进行最小化修复，通过实际使用系统进行QA，清理工件。实际的操作方法在`references/`中——请阅读它们。触发词：'debug this'、'why is X not working'、'hanging'、'attach a debugger'、'reverse engineer'、'pwndbg'、'gdb'、'lldb'、'node inspect'、'tsx debug'、'pdb'、'dlv'、'delve'、'rust-gdb'、'set a breakpoint'、'context window exploded'、'why is the response empty'、'attach the debugger'、'debug it'、'why is this happening'、'trace this bug'、'reproduce and fix'、'silent failure'、'HTTP 200 but empty'、'why did it stop'、'inspect the binary'、'reverse engineering'、'playwright'。"
---

# 调试技能（debugging）

## 技能说明

适用场景：所有语言 / 二进制程序的运行时调试，包括崩溃、静默失败、输出异常、进程卡死、内存泄漏、异步行为异常、不明时序问题、逆向工程等。

核心方法：采用假设驱动的排查循环 —— 提出至少 3 个正交假设，并行验证；连续 2 轮排查失败后启动多视角专家分析；确认根因后编写失败测试用例，执行最小化修复，通过真实运行验证，最后清理所有调试产物。

所有具体操作方法存放在 `references/` 目录中，必须查阅对应文件再操作。

## 核心原则

1. **运行时事实优先于代码阅读**：所有 bug 原因的判断必须基于实际观测到的运行状态，不能仅凭读代码推测。

2. **全程无残留**：调试产生的所有临时文件都要记录，并在任务结束前全部清理。

## 强制阅读规则

- 本文件仅为索引目录，90% 的实操知识在 `references/` 目录下。未阅读对应参考文件前，不要执行调试操作。

- 门禁规则：执行某一领域的调试命令前，必须已阅读该领域的参考文件。

---

### 运行时参考（挂载调试前必须阅读）

|运行环境|必读参考文件|关键原因|
|---|---|---|
|Python（CPython、pytest、asyncio、Django、FastAPI）|`references/runtimes/python.md`|pdb/ipdb/debugpy/pytest \-\-pdb 挂载逻辑不同；异步代码断点需特殊处理；`poetry run` 等封装会吞掉调试参数|
|Node\.js/tsx /ts\-node/ Bun / Deno（源码运行）|`references/runtimes/node.md`|tsx 配合 `node inspect` 存在静默的源码映射失效问题，行号断点不会触发|
|Rust（cargo、tokio、panic）|`references/runtimes/rust.md`|Release 构建会剥离符号；Tokio 任务需用 `tokio-console`；多数场景下 `dbg!` 宏效率更高|
|Go（goroutine、dlv、pprof、竞态检测）|`references/runtimes/go.md`|goroutine 泄漏和被恢复的 panic 默认无感知；dlv 有固定端口约定；`go test -race` 应优先执行|
|原生二进制 / 剥离符号的 C/C\+\+ / 无源码|`references/runtimes/native-binary.md`|排查流程有特定逻辑；macOS 存在 SIP / Mach\-O /lldb 专属特性|
|打包应用二进制（Bun SEA、Node SEA、Deno compile、pkg、nexe、Electron、Tauri、PyInstaller）|`references/runtimes/bundled-js-binary.md`|外观是 Mach\-O/ELF，但高层源码可通过对应打包工具提取；不同打包格式提取方式差异大|

> 快速区分原生与打包二进制：`file` 命令对两者都会显示为 Mach\-O/ELF。可通过 `du -h`（50MB 以上大概率为打包版）\+ `strings -n 12` 搜索打包特征关键字判断，命中则走打包二进制流程。
> 
> 

---

### 专业工具（对应场景必须使用）

|工具|适用场景|参考文件|
|---|---|---|
|Playwright CLI|浏览器端 Web UI 问题；需要点击 / 输入 / 导航的流程；本地正常、线上异常的浏览器兼容问题；浏览器类产品的最终验证必须使用 Playwright|`references/tools/playwright-cli.md`|
|Ghidra|无可靠源码的二进制程序；第三方闭库、恶意程序、文档与实际行为不符的依赖库、CTF、固件|`references/tools/ghidra.md`|
|pwndbg|所有原生二进制调试场景；是增强版 GDB，默认展示寄存器、栈、反汇编、堆等关键视图|`references/tools/pwndbg.md`|
|pwntools|需要与二进制 / 网络服务进行可复现交互的场景；构造 payload、漏洞利用自动化、fuzz 测试脚本、CTF 脚本|`references/tools/pwntools.md`|

---

### 调试阶段流程

进入每个阶段前必须阅读对应参考文件。

|阶段|说明|对应参考文件|
|---|---|---|
|0|环境评估：确认运行时、端口、符号、环境变量、监控进程|`references/methodology/00-setup.md`|
|1|建立调试日志：用 `.debug-journal.md` 记录所有临时产物，确保可完整回滚|`references/methodology/00-setup.md`|
|2|提出假设：至少 3 个不同维度的假设，每个都对应可验证的特征|`references/methodology/02-investigate.md`|
|3|并行排查：多子代理同步验证不同假设|`references/methodology/02-investigate.md`|
|4|三方专家会诊：连续 2 轮排查失败后，启动三个不同视角的分析并综合结论|`references/methodology/04-oracle-triple.md`|
|5|升级决策：仅当证据穷尽且涉及策略判断时，提交用户决策|`references/methodology/05-escalate.md`|
|6|根因确认：仅当 "修改疑似原因 → bug 随之开关" 时，才算确认根因|`references/methodology/06-fix.md`|
|7|测试驱动修复：先写失败用例，再做最小化修复，不扩大修复范围|`references/methodology/06-fix.md`|
|8|人工验证：实际运行系统（CLI 用 tmux、浏览器用 Playwright、API 用真实 curl、二进制用真实复现用例）|`references/methodology/08-qa.md`|
|9|清理产物：对照调试日志，撤销所有临时修改，确保 `git diff` 仅保留修复代码和测试|`references/methodology/09-cleanup.md`|
|10|最终校验：通过四项证据门槛后才算完成|`references/methodology/09-cleanup.md`|

### 跨领域方法参考

|场景|参考文件|
|---|---|
|无法实际运行（付费 API、网络受限、缺少硬件）但仍需运行时证据|`references/methodology/partial-runtime-evidence.md`|
|提取 / 审计 / 逆向任务收尾前的交叉校验|`references/methodology/partial-runtime-evidence.md#verification-oracle-pattern-for-non-debug-tasks`|

---

## 不可违背的安全规则

1. 运行时状态是唯一真相来源。没有观测数据支撑的假设只是猜测，不能基于猜测做修复。

2. 所有调试产物必须先记录再创建。

3. 修复必须配套 "先失败、后通过" 的测试用例，红→绿的转换是修复有效的证明。

4. 不能仅靠类型检查 / 编译通过就判定完成。类型只能捕获声明错误，只有真实运行用户场景才能捕获真实问题。

5. 运行时证据能回答的问题，绝不询问用户。升级决策仅用于真正的歧义场景。

6. 调试过程中禁止静默吞掉错误。如果系统本身会吞错误，这往往就是 bug 本身；调试时临时打开错误输出，清理时恢复。

7. 本技能内不执行 `git commit` 操作。提交由用户确认后在外部流程完成。

8. 挂载调试器前必须已阅读对应运行时参考文件。

---

## 执行步骤

1. 阅读用户的 bug 描述。

2. 识别运行时环境。

3. 打开并阅读对应 `references/runtimes/<runtime>.md`。

4. 识别适用的专业工具，打开并阅读对应 `references/tools/*.md`。

5. 打开 `references/methodology/00-setup.md`，从阶段 0 开始执行。

6. 按阶段循环推进，进入每个阶段前阅读对应方法参考。

> （注：部分内容可能由 AI 生成）
