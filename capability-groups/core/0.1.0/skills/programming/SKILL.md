---
name: programming
description: "对.py、.pyi、.rs、.ts、.tsx、.mts、.cts、.go 文件的任何工作都必须使用。一种理念：严格类型、现代技术栈（Pydantic v2 / serde+thiserror / Zod / gin+sqlc+pgx+slog）、现代工具链（基于 UV 的 pyright+ruff / cargo+clippy+miri / Bun+Biome+tsc / gofumpt+golangci-lint v2+nilaway+go-race）、解析而非验证、详尽匹配、类型化错误、无 any/unwrap/panic、250 LOC 上限、TDD、消费者路由日志记录。路由到 references/{python,rust,typescript,rust-ub,go}/ + references/logging.md。触发条件：编写/编辑 Python/Rust/TypeScript/Go 代码、新项目、gin 服务器、bubbletea TUI、CJK IME、connect-go RPC、sqlc pgx、品牌化 ID、详尽匹配、不安全的 Rust、miri、超大文件、重构、TDD、端到端测试、日志记录、日志级别、结构化日志记录、可观测性、竞技场、分配器、bumpalo、常量函数、常量泛型、编译时、零分配、位域、repr、scopeguard、errdefer、类 Zig、零拷贝、紧凑结构体。"
---

# 编程规范技能

## 一、核心定位

本规范适用于 Python / Rust / TypeScript / Go 四种语言，遵循「少写代码、类型严格、架构克制、测试先行」的核心原则。**所有代码（包括一次性脚本）都必须遵循完整规范**。

## 二、前置流程：语言准入（写代码前强制完成）

1. 根据文件后缀或需求确定开发语言。

2. **必须先读完对应语言的参考文档，再开始写代码**：

    - Python：先读 `references/python/README.md`，再按需加载细分文档

    - Rust：先读 `references/rust/README.md`；涉及 `unsafe`、FFI、自定义无锁原语时，必须额外读取 `references/rust-ub/` 全套文档

    - TypeScript：先读 `references/typescript/README.md`

    - Go：先读 `references/go/README.md`

3. 结合通用原则 \+ 对应语言的强制规则编写代码。

## 三、通用核心原则（全语言通用）

以下是所有规范的底层公理：

1. **能不写就不写**。优先复用现有代码、标准库、已有依赖，最后再写最少的可用代码。修复问题要根治根因，不要只补表面症状。

2. **类型系统就是校验系统**。让非法状态在类型层面无法存在，编译器 / 类型检查是成本最低的测试。

3. **边界解析，而非处处校验**。不可信输入只在入口处解析为带类型的值；内部代码只接收类型化数据，不重复校验。

4. **一个名字对应一个语义**。比如用户 ID 不能直接用字符串 / 数字，要用 NewType / 新类型结构体 / 品牌类型做语义隔离，避免不同概念混用。

5. **永远穷尽匹配分支**。枚举 / 联合类型必须使用穷尽匹配，禁止用 `if/elif/else` 区分带标签的变体。

6. **信任框架契约，只在边界校验**。类型已保证非空就不要做空检查，不要用 `unwrap`/`!` 等绕过类型契约，不写无意义的防御代码。

7. **测试驱动开发**。没有失败的测试，就不写生产代码。

## 四、TDD 开发规范（强制）

### 开发流程（顺序不可颠倒）

1. **红**：先写失败的测试，用「给定 / 当 / 那么」结构描述行为，运行确认失败原因正确（不是拼写、导入错误）。

2. **绿**：写最少的代码让测试通过，不要提前追加额外功能。

3. **重构**：测试通过后大胆重构，测试是安全网；如果测试难以支撑重构，先优化测试。

### 测试金字塔

|层级|数量|作用|速度要求|
|---|---|---|---|
|单元测试|多|覆盖所有输入场景（正常 / 边界 / 错误路径）|单条 \< 10ms|
|集成测试|中|真实对接下游（数据库、队列、HTTP），使用容器化真实服务|单条 \< 1s|
|端到端测试|少|每个用户可见场景一个，从真实入口驱动，断言可观测结果|秒级，仅在 CI 运行|

### 测试核心要求

- 所有测试必须遵循「给定 / 当 / 那么」结构，单个测试只测一个动作。

- 尽量少用 mock，优先级：真实对象 \> 内存假实现 \> 容器化真实服务 \> 网络层假实现 \> mock。

- 测试必须准确、高效、确定、隔离：只断言契约，不耦合格式细节；单元测试全量本地运行 \< 30s；禁止用 `sleep` 等待，注入时钟、使用事件通知；每个测试独立启停，互不影响。

## 五、跨语言通用铁则

|规则|Python|Rust|TypeScript|Go|
|---|---|---|---|---|
|默认不可变|冻结数据类 / Pydantic frozen|默认 `let`，仅明确需要时用 `mut`|字段 `readonly`，数组只读|值类型、非导出字段，无必要不加修改方法|
|语义化基础类型|`NewType`|newtype 元组结构体|品牌类型|命名类型 \+ 智能构造函数|
|穷尽匹配|`match` \+ `assert_never`|`match`（编译器强制）|`switch` \+ `assertNever`|密封接口 \+ 类型开关 \+ 穷尽检查 linter|
|禁止无类型绕过|公开签名无 `Any`、无强制类型转换、无 `# type: ignore`|业务代码无 `unwrap`/`expect`、无 `as` 强转、不无理由屏蔽警告|无 `any`、无 `as`（除 `as const`/`satisfies`）、无 `!`、无 `@ts-ignore`|域签名无空接口、不忽略错误、不无理由 `nolint`|
|结构化错误|带类型的异常数据类|库用 `thiserror`，应用用 `anyhow`\+ 上下文|带字段的 `Error` 子类|哨兵错误 \+ 结构体错误 \+ `%w` 包装，用 `errors.Is/As` 判断|
|仅边界捕获异常|只捕获明确异常，`main` 中才广谱捕获 \+ 日志重抛|用 `?` 传播，库代码绝不 `panic`|`catch` 必须类型判断后重抛或转换，禁止空 `catch`|每个错误都检查，`panic` 仅用于 `main`/ 测试，统一错误出口|
|资源自动释放|`with` / `async with`|`Drop` / RAII 守卫|`using` / `await using`|获取后立即 `defer Close`，linter 强制检查|
|异步运行时|`anyio`（禁止裸 `asyncio`）|`tokio`|原生异步 \+ `AbortSignal` 结构化取消|`context.Context` 为首参 \+ `errgroup`，测试必开 `-race`|
|现代 HTTP 客户端|`httpx2`|`reqwest` \+ `rustls`|`ky` / `undici`，生产禁止裸 `fetch`|标准库 `net/http` \+ 重试库|
|不修改入参|入参只读，返回新值|`&mut` 仅用于明确修改场景|不重新赋值参数|不修改用值接收者，修改才用指针接收者|
|不做一次性封装|三行以内直接内联，出现第二次调用再抽象|同左|同左|同左|

## 六、推荐技术栈（2026 标准选型）

|领域|Python|Rust|TypeScript|Go|
|---|---|---|---|---|
|数据校验 / 边界解析|Pydantic v2|`serde` \+ `validator`|Zod v4|`validator` \+ `protovalidate` \+ 智能构造|
|值对象|冻结数据类|newtype / 普通结构体|`readonly` 类型别名|非导出字段结构体 \+ 构造函数|
|错误类型|结构化异常类|`thiserror` \+ `anyhow`|结构化 `Error` 子类|哨兵错误 \+ 结构体错误|
|Web 框架|FastAPI|`axum`|Hono \+ `hono-openapi`|`gin` / `chi` / `connect-go`|
|数据库|SQLAlchemy 2\.x 异步 \+ `asyncpg`|`sqlx`（编译期校验）|Drizzle|`sqlc` 代码生成 \+ `pgx` \+ `goose` 迁移|
|CLI|`typer` \+ `rich`|`clap` \+ `color-eyre` \+ `indicatif`|`@clack/prompts` \+ `commander`|`cobra` \+ `huh` \+ `slog`|
|日志 / 可观测|`structlog`（生产）/ `rich.logging`（开发）|`tracing` \+ `tracing-subscriber`|`pino`|标准库 `log/slog`（新代码禁止 `logrus`/`zap`）|
|测试|`pytest`|`cargo nextest` \+ `proptest` \+ `insta`|`bun test` / `vitest`|标准库 `testing` \+ `testify` \+ `goleak` \+ `testcontainers`|
|数据处理|`polars` \+ `duckdb` \+ `numpy`（禁止 pandas）|`polars-rs` / `arrow`|交由后端实现|`arrow-go` \+ DuckDB \+ `gonum`|
|LLM / Agent|`pydantic-ai`|调用 Python 子进程|Vercel AI SDK|直连 HTTP \+ Connect|
|TUI|`textual`|`ratatui`|`@clack/prompts` / `ink`|`bubbletea v2`（支持中文输入法）|
|环境配置|`pydantic-settings`|`figment` / `config`|`zod` \+ `process.env`|`caarlos0/env`|

## 七、现代工具链标准配置

|类别|Python|Rust|TypeScript|Go|
|---|---|---|---|---|
|包 / 项目管理|`uv`（禁止 pip/poetry/conda）|`cargo` \+ `nextest` \+ `machete` \+ `deny`|Bun（运行时 \+ 包管理），Node 场景用 pnpm|`go modules` \+ `go work`（monorepo）|
|类型检查|`basedpyright`，`typeCheckingMode = "all"`|编译器 `-D warnings` \+ clippy 严格模式|`tsc --noEmit`，开启 strict 全套严格规则|编译器 \+ `golangci-lint v2` \+ `nilaway`|
|格式化 \+ Lint|`ruff`，`select = ["ALL"]`|`clippy` \+ `rustfmt`|Biome（替代 ESLint \+ Prettier）|`gofumpt` \+ `goimports` \+ `golangci-lint v2`|
|测试运行|`pytest`|`cargo nextest`|`bun test` / `vitest`|`go test -race -shuffle=on -count=1` \+ `goleak`|
|未定义行为检查|\-|nightly `miri` 严格模式|\-|`nilaway` \+ `-race` \+ `goleak`|
|一次性脚本|PEP 723 内联元数据 \+ `uv run`|`rust-script` 内联 Cargo 配置|`bun run`|`//go:build ignore` \+ `go run`|

## 八、代码异味（触发自动审查）

1. **文件纯代码超过 250 行**：非空非注释行超过 250 行视为缺陷，必须按职责拆分；特殊情况（生成代码、不可分状态机）需标注 `SIZE_OK` 并说明理由。

2. **函数参数超过 3 个**：说明函数职责过多，应将相关参数封装为有业务含义的结构体；用字典 /kwargs 绕开同样违规。

3. **破坏性操作后冗余校验**：删除 / 清空 / 写入后立即查询确认，属于无意义防御代码。操作本身的契约就是正确性保证，若操作会静默失败，应修复操作本身。

4. **否定式命名**：变量 / 函数 / 标志用否定命名（如 `isNotValid`）会增加理解成本，应改为肯定形式并翻转分支逻辑；卫语句和过滤器场景除外。

## 九、日志规范

- 日志级别按「消费方」划分，而非凭主观判断严重程度。

- 日志打在决策点，不打在工具函数内部。

- 日志消息保持稳定，结构化数据放在字段中。

- **项目已有日志方案就沿用原有方案**，没有日志的项目不要擅自加日志。

- 新增 / 修改日志前必须读取 `references/logging.md`。

## 十、写完代码强制自检流程

每次写完 / 修改完代码，必须执行以下步骤：

1. **统计行数**：计算非空非注释代码行数，超过 250 行必须先重构再加代码。

2. **架构自检 11 项**，任意一项不通过必须修复：

    1. 单一职责：文件职责能否用一个短名词概括？需要用「和」描述就拆分。

    2. 边界纯净：输入是否在边界解析为类型值，有没有把无类型数据传入内部？

    3. 分支穷尽：有没有用 `if/else` 区分枚举类型，有没有漏掉穷尽断言？

    4. 类型绕过：有没有 `Any`、`unwrap`、强转、忽略警告等绕过类型系统的操作？

    5. 冗余防御：有没有对类型已保证的值做空检查、异常捕获等无意义防御？

    6. 一次性工具：有没有只为一个调用方写的、不会复用的函数 / 类？有就内联。

    7. 测试覆盖：新增的行为有没有对应的测试，回滚代码测试会不会失败？

    8. 参数膨胀：有没有参数超过 3 个的函数？有没有用字典偷运参数？

    9. 冗余校验：有没有破坏性操作后再查询确认的代码？

    10. 否定命名：有没有可以改成肯定形式的否定式命名？

    11. 日志合规：日志是否符合项目惯例与级别规则？

3. **触发专项重构的场景**：

    - 出现代码异味，或自检发现 2 项以上问题：加载 `refactor` 技能执行安全重构。

    - 接手 AI 生成的低质量代码：加载 `remove-ai-slops` 技能清理。

## 十一、各语言参考文档索引

- **Python**：先读 `references/python/README.md`，按需加载严格配置、类型模式、数据建模、错误处理、异步、HTTP 优化、数据处理、FastAPI 栈等细分文档。

- **Rust**：先读 `references/rust/README.md`，按需加载零成本安全、严格配置、类型状态、unsafe 规范、异步、并发、服务端栈等细分文档。涉及 `unsafe` 必须读取 `rust-ub` 全套。

- **TypeScript**：先读 `references/typescript/README.md`，按需加载严格配置、类型模式、数据建模、错误处理、项目初始化、后端栈等细分文档。

- **Go**：先读 `references/go/README.md`，按需加载库选型、严格 Lint 配置、项目初始化、类型模式、数据建模、错误处理、并发、后端栈、RPC、数据库、测试等细分文档。

> （注：部分内容可能由 AI 生成）
