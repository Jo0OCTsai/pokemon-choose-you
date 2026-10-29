# dsh-plugin/ 插件包约定（host + client + helper）

> dsh（DeepSeek Harness）Cordis 插件形态：宿主半边 `src/host/`（Node）+ 客户端半边 `src/client/`（React，
> sidebar main 全局面板载体——原 `plugins.detail.section` 槽已摘除，插件私有配置经 pluginConfig
> Context 线入背包分区行、背包为唯一编辑面）+ 桌宠 `helper/`（Electron sidecar 子包，workspace member
> `pokemon-choose-you-helper`）。模块挂点职责见各子目录 README.md；设计与决策见 `specs/dsh-plugin/` 与
> `docs/decisions/0001|0002`。

## 不变量与红线

- **业务核心零 dsh 依赖**：`domain/ radio/ judge/ anonymize/ dispatch/ storage/ reminder/` 是纯逻辑 + SQL 原语，
  不 import 任何 dsh/Cordis 平台面；平台面（timer/agents+sessions 会话面/worktrees/SSH/slots/terminal）只允许在
  适配层（`dsh/`（含 sshScope 唯一 dsh-ssh 触碰点 + probeDsh 探测 + tlsStack/broker* BoringSSL
  宿主过渡传输）、`broker/`（brokerMain——dist/broker.mjs 入口，系统 Node 子进程侧零 dsh 宿主依赖）、
  `index.ts` 装配、tools 注册面、pet/dispatch 适配缝）触碰——RC 期破坏性变更被限制在薄适配层。**`remote/` 整体也零 dsh import**：
  远端能力经 `remote/sshScope.ts` 的平台中立 `SshScope` 接口注入（实现在 `dsh/sshScope.ts`，按
  spike 结论双 label isolate 装配——specs/dsh-plugin-full-parity/spike-dsh-ssh.md）。
- **storage 是全插件唯一握连接的模块**：连接生命周期（WAL + busy_timeout=5000）、guarded 迁移**封顶
  minSchema**（`contracts/PROTOCOL.md` §1；「把库版本推到更高」只由主应用执行）、`BEGIN IMMEDIATE`
  事务助手。其他模块不得自开连接。
- **写路径铁律**：全部写操作 = 单条 `BEGIN IMMEDIATE` 短事务 + CAS（WHERE 守卫、affected rows 判定）；
  禁止长事务、禁止事务内子进程调用/await（ADR-0001）。
- **domain 与 Rust 逐 `contracts/PROTOCOL.md` 对齐（FR-X3）**：行为以 `contracts/fixtures/` 锁定的代码
  行为为准；发现与 AD 文字矩阵差异时 TS 对齐实际行为，并在代码注释标注差异点（见 PROTOCOL §5「代码优先
  行为发现」清单，如 conn 层不设状态迁移守卫、停用维度建标签放行）——不要"顺手修正"为文档语义。
- **执行世界单源 = agent 绑定部署（2026-10-19 裁决）**：`AgentConfig.deployment`（`ai_agents` JSON 内
  dsh 扩展字段，存部署 alias；Rust serde 未知字段容忍）驱动派发本地/远端，路由级 deployment 已移除；
  存在性校验在命令层（domain 不反向依赖 `remote/`），alias 改名级联改写 `ai_agents`（`confirmAliasRefs`）；
  生效引用 `ref = target = alias`，hostKey 归一 `ssh:<alias>`；**工作目录随执行世界（2026-10-21 扩展）**：
  部署绑定路由的 workdir 缺省层 = 实体登记工作区压过 `agent.workdir`（本机路径语义——`routeWorkdir`
  层级：路由表/tag meta 恒先 → 实体 workdir → agent.workdir；判定侧同口径 `remoteJudgeExecutorFor`）；
  `agent.remote`（SSH host/端口表单）保留为桌面共享面，不驱动插件派发。
- **常驻隧道与 pk 通道（ADR-0003 + ADR-0006）**：`remote/tunnelSupervisor.ts`（零 dsh import）+ `remote/tunnelLock.ts`（与桌面 `tunnel_lock.rs` 同锁协议：`<appHome>/tunnels/<部署id>` 目录锁 + PID 探活）维持任一宿主驻留期的隧道；`remote/pkLocal.ts` 把 `dist/pk.mjs` 落位 `~/.choose-you/bin/pk`（Windows `pk.cmd`，sha256 漂移覆盖）；`dsh/pkSetup.ts` spawn `pk remote setup`。装配在 `dsh/hostEntry.ts`（服务注入命令面 `tunnels`/`pkSetup`，部署写命令 resync）。
- **pk TS 实现与 CLI 信封契约（ADR-0006）**：`src/pk/` 是全量 pk 命令面的 TS 实现（数据面复用 `host/domain` + `host/storage`；remote 家族自持 ssh 编排），构建为单文件 `dist/pk.mjs`（node shebang）。**硬约束：pk 依赖图零 dsh 平台面模块**（`dsh/`、`radio/`、`dispatch/`、`remote/`、`pet/`、`src/client/`）——`__tests__/pk-cli-envelope.spec.ts` 的 metafile guard 机器检。双实现一致性 = contracts `cli_envelope` 组（Rust oracle 生成 fixtures / TS 回放字段树比对，归一化占位符双侧同构）；`doctor`/`remote setup`/`__ssh_entry` 不入信封组，由 `__tests__/pk-remote.spec.ts` 假程序注入锁结构。
- **`agent_sessions.session_id` 的 `pty:` 标记**：远端交互派发把 dsh-ssh PTY 句柄落该列（同任务重派写回同一 PTY），
  必须经 `dispatch/sessionsReplay.ts` 的 `ptySessionRef()` 加前缀——它不是 agent 会话 id，回放路由见前缀走
  picker 分支（不组 `--resume <句柄>`），重派经 `ptyHandleOf()` 剥前缀；桌面 Rust 账本无此形态。
- **coverage 口径**：`vite.config.ts` thresholds 四维 85 只统计 `src/host/**`（business core）；
  client 组件不入口径但**进质量棘轮**（复杂度/覆盖率地板按服务全量）。**不要把 vite.config.ts 改名为
  vitest.config.ts**（会脱离棘轮发现面）。
- **helper 独立子包**：不依赖 dsh 运行时，由插件 `pet/` spawn；测试三形态（Electron 真窗体 / headless
  `HELPER_HEADLESS=1`（CI 无显示环境）/ 生产 `dist/main.js`）；桥协议单源 = `helper/README.md`
  §桥协议（stdio JSON 行），host 侧 `pet/bridge.ts` 与 helper 两侧同步改。
- **i18n 三语键集相等**：主应用字典经 `@app-i18n` alias 直引 `src/i18n/*.ts` TS 源（A16 零拷贝），
  `dsh.*` 增量键三语字典在 `src/client/i18n/`；`__tests__/client/i18n.spec.ts` 断言三语 merged 键集
  完全相等（缺键即红，NFR-7）。
- **测试用真实临时 SQLite**：契约回放与 domain 原语测试在真实临时库文件上执行（不用内存 mock 替代
  WAL/事务语义）；外部依赖（lark-cli/agent CLI/子进程）走 fake 脚本替身。
- **TODO 纪律**：源码内不落 TODO 字面量（全仓棘轮 hygiene 基线 = 0），待办写各模块 README.md（.md
  不入卫生扫描口径）。

## 命令速查（stack.json `pokemon-choose-you-dsh` 服务单源）

- lint：`pnpm --filter dsh-plugin lint`（eslint + prettier + tsc --noEmit 分脚本）
- 测试：`pnpm --filter dsh-plugin test`（vitest 全量，含契约回放与组件测试）
- helper：`pnpm --filter pokemon-choose-you-helper test|build|dev`（dev 需本机 electron；CI 跳过二进制下载）
- 契约夹具重生成：见 `contracts/AGENTS.md`
