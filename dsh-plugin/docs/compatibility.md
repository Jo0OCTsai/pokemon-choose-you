# dsh 兼容矩阵（FR-X7）

> 本文件是「依赖子系统 × 最低版本」兼容矩阵的家（AD §6 NFR-3 ③）。单测断言本矩阵
> 「探测键」列与 `src/host/index.ts` 的 `CAPABILITY_KEYS` 探测清单全集**双向相等**
> （矩阵与代码不一致即红）——矩阵行增删须同步探测清单；断言已挂入 CI plugin job
> （vitest 套件的一部分，`__tests__/compat.spec.ts`）。
>
> dsh 平台面 8 键的探测已实装（`src/host/dsh/probeDsh.ts`，任务 2.2）：结果进
> diagnosticsSnapshot 的 `capabilities` 段（**该字段 2026-10-21 接线落型**——此前仅
> `sshFamily` 投影可观测；真机八键实测记录见 A4）（`sshFamily` 字段 = `dsh-ssh` 条目的呈现
> 投影）；dsh-ssh 家族探测含本机闭包真实动态 import 断言（`__tests__/dsh-probe.spec.ts`）。
> dsh-ssh 家族实测记录见 `specs/dsh-plugin-full-parity/spike-dsh-ssh.md`（2026-10-17
> PASS 17/17：isolate 多实例装配 / terminal 作用域 / 构建产物解析锚点）。

## A1 实测记录：node:sqlite（2026-10-11，仓库工具链）

| 项 | 结论 |
| --- | --- |
| Node 版本 | v24.21.0（nvm；与 CI `setup-node` 同版本） |
| flag | 不需要任何实验旗标，`node:sqlite` 开箱可用 |
| warning | 无 ExperimentalWarning（`process.on("warning")` 探针未触发） |
| 冒烟 | `DatabaseSync(":memory:")` 顺序执行 `contracts/schema/001_v1.sql` + `002_dispatch_coord.sql` 成功：17 张表 = 16 业务表（001 的 15 张 + 002 的 `dispatch_slots`）+ `sqlite_sequence`；`chat_messages.judge_claimed_at` 列在位 |
| 内嵌 SQLite | 3.53.4（`process.versions.sqlite`） |

结论：仓库工具链（Node ≥ 24 基线）满足 A1 前置，驱动选型维持 `node:sqlite`（零原生依赖）。
**dsh 宿主实际运行时已于 2026-10-21 双形态实测**（web 宿主 = 系统 Node v24.21.0 运行库即证；
Electron 内嵌 Node 见 A4）——better-sqlite3 回落链（AD §2 A1）维持备案未启用。apply 期探测
`probeNodeSqlite` 仍在位（失败硬拒绝——NFR-3 不静默半工作）。

## A2 升级记录：dsh 0.2.0-rc.2 → 0.2.1-rc.2（2026-10-17）

| 项 | 结论 |
| --- | --- |
| 动因 | DSH 桌面版更新至 0.2.1-rc.2，peer 钉版 `0.2.0-rc.2` 不满足 → 插件被拒载 |
| 改动 | package.json peer/dev `dsh-client-connection`+`dsh-tools`、dependencies `dsh-typert-protocol` 统一钉 `0.2.1-rc.2`；插件版本 0.1.0 → 0.1.1 |
| dsh-tools diff | 删 `./invariant` 导出（插件未消费，typecheck 证实）；新增 `ptc-calls` 模块与 `locale/*.json` 出口；`cordis ~4.0.4` peer 检查在 0.2.1-rc.2 宿主仍通过（错误提示未点名） |
| 验证 | typecheck 平台类型面零新增错误（仅存用户 WIP 文件既有 3 错）；vitest 全量 128 文件 / 1238 测试绿；build 产物绿 |
| 事实边界 | worktrees/timer 携带等注入面事实沿 0.2.0-rc.2 核实记录，0.2.1-rc.2 未重测——运行时存在性探测兜底（缺失只呈现不阻断） |

## A3 实测记录：Electron 宿主 × dsh-ssh TLS-PSK 握手失败（2026-10-18）

| 项 | 结论 |
| --- | --- |
| 症状 | desktop profile（Electron 宿主）：部署就绪复核/建 dsh-ssh 家族连接即抛 `error:100000b1:SSL routines:OPENSSL_internal:NO_CIPHER_MATCH`（TLS-PSK 密码套件协商失败）→ 部署 `disconnected`，重连复核恒失败（开通向导四步可全过——前置步走 DirectSshScope 裸 ssh，不经家族传输） |
| 判别实验 | 同库（`~/.choose-you/data/`）同部署（pky-remote → devcontainer vscode@localhost:1022）同插件构建 0.1.1：纯 Node 宿主（`dsh --profile pky-test`，系统 Node v24.21.0，web 面板）重连即恢复 `ready`；Electron 宿主恒 SSL 失败——宿主形态是唯一变量 |
| 根因归类 | **直接复现（2026-10-18 PSK-TLS 探针）**：桌面宿主子进程 = Desktop 可执行体以 `ELECTRON_RUN_AS_NODE` 跑 Node bootstrap（app.asar 文档原文「the Desktop executable runs the Node bootstrap」；crash 日志 2026-10-17 佐证 host=ChildProcess）——该运行体 TLS 栈为 BoringSSL，`tls.createServer({ciphers:"PSK-AES128-GCM-SHA256", pskCallback})` 在 `createSecureContext` 即抛 `error:100000b1:SSL routines:OPENSSL_internal:NO_CIPHER_MATCH`（与产线 lastError 逐字节一致）；系统 Node（OpenSSL 3）同脚本握手成功。即 Electron 内嵌 Node 不支持 OpenSSL PSK 套件名，dsh-ssh 流安全（每流 TLS-PSK）在桌面宿主结构性失败 |
| 影响面 | desktop：远程复核/无头派发/远端交互（凡经家族连接）全部阻断，本机功能不受影响；headless/web profile（系统 Node 宿主）远程全通 |
| 绕过 | **过渡通道已实装（2026-10-18，插件 0.1.2）**：TLS 栈功能性探测（`dsh/tlsStack.ts`——`createSecureContext(PSK 套件)` try/catch）→ BoringSSL 宿主自动切 **broker 传输**（`dsh/brokerScope.ts` 派生系统 Node 子进程跑 `dist/broker.mjs`——裸 cordis 双 label 装配 + 同一 DshSshScope，stdio JSON 行桥协议 `dsh/brokerProtocol.ts`；Node 候选链 PATH → Homebrew → nvm 最新，GUI 宿主 PATH 缺 nvm 场景覆盖）。真机端到端已验（dist 产物连容器：connect 311/344ms + spawn/PTY 三原语/disconnect）。OpenSSL 宿主路径零变化（auto 探测短路回进程内）；`transport` 选项可锁 inprocess/broker（测试与诊断）。长期 = 上游反馈 + 家族升级复验（矩阵 dsh-ssh 行）。**上游修复方向实测收窄（2026-10-18 探针 v2）**：TLS 1.3 external PSK 经 Node `pskCallback` 在 Electron-as-Node 同样失败（服务端 `NO_CERTIFICATE_SET`——Node 回调未接 BoringSSL 的 1.3 external-PSK 通道），即 Electron 内嵌 Node 的 `node:tls` **整个 PSK 能力面缺席**（1.2 套件未实现 + 1.3 回调未接线）；上游兼容需放弃 TLS 握手式 PSK，改用既有每流预共享密钥直接做 AES-GCM 帧加密（`node:crypto` 原语在 BoringSSL 构建完整可用） |

## A4 实测记录：dsh 宿主平台表面八键 + Electron 内嵌 Node（2026-10-21）

> 环境：`dsh --profile pky-test`（web 宿主，系统 Node v24.21.0，插件 0.1.2 新包名重装）+
> Electron 44.7.0（`~/.dsh/electron/dist`，`ELECTRON_RUN_AS_NODE` 探针 = A3 实测的 desktop
> 宿主子进程同一运行体）。探测数据面 = `diagnosticsSnapshot.capabilities`（本轮接线落型——
> `remoteAssembly.remotePlatformOf` 保留 `probeDshCapabilities` 全量结果经 PluginDeps 穿线，
> 同 helperCaps/sshFamily「签名不变增量」），真机实测经 `/api/pky/call` 读取。

| 键 | 真机结论（web 宿主） |
| --- | --- |
| `dsh` | ok——ctx.isolate/plugin 表面在场（宿主进程内运行坐实） |
| `dsh-timer` | ok——ctx.interval/timer 在场；装配已消费（hostEntry inject timer + ctx.interval 驱动 poll/stateFeed/reminder/backup 四循环，宿主驻留期无异常） |
| `dsh-session` | ok——ctx.sessions 注入面在场（root 会话判定通道消费面，ADR-0004） |
| `dsh-worktrees` | 缺——宿主无 ctx.worktrees 注入面（派发工作树由插件 ShellRunner 自建，维持矩阵口径） |
| `dsh-ssh` | ok——动态 import 解析插件包闭包 0.1.6-alpha.1（A3 broker 过渡通道在 desktop 宿主，web 宿主进程内直连） |
| `dsh-storage` / `dsh-slots` | 宿主无对应表面——自持口径成立（storage 唯一握连接 / dispatch_slots 库内实现） |
| `dsh-terminal` | 缺——web 宿主无 spawnTerminal/ctx.terminals 表面（0.2.x 平台事实）；交互派发/回放经外部终端真窗口承接（2026-10-18/21 已真机验证） |

Electron 内嵌 Node（A1 宿主侧收口）：Node **24.21.0**（内嵌 SQLite **3.53.4**，无实验告警）——
契约 schema（001+002）内存库建齐 **17 表**、`chat_messages.judge_claimed_at` 列在位、
`PRAGMA user_version` 事务写读通过。**同运行体 TLS-PSK 探针复现 A3 失败签名**
（`NO_CIPHER_MATCH`——BoringSSL 构建），即 node:sqlite 与 TLS-PSK 为相互独立的能力面，均已实测定论。

另：pageOpen 推送流端点 `pky/pageOpenEvents`（SRC 流方法，2026-10-21 新增）经 gateway 在
`/api/remote.mux` WebSocket mux 上真实分发——浏览器页内手工开流收到首帧
`{"type":"item","value":{"type":"ready"}}`（真机闭环证据，见 acceptance-report §4 条目 4）。

## A5 升级记录：dsh 0.2.1-rc.2 → 0.2.1-rc.3（2026-10-25）

| 项 | 结论 |
| --- | --- |
| 动因 | dsh 发布 0.2.1-rc.3，peer 钉版 `0.2.1-rc.2` 不满足 → 插件被拒载（同 A2 机制） |
| diff 实测 | **全家族纯 re-release**：`dsh-client-connection`/`dsh-tools`/`dsh-typert-protocol` + 传递包（scope/session/agent/llm/credentials/brand/user-approval/system-prompt/sandbox/sandbox-policy/working-directory/ptc-runtime/timeout/util-crypto 共 17 包）rc.2 vs rc.3 逐包 diff 仅 package.json 版本字段与家族互引版本号，代码文件零变更 |
| 改动 | package.json peer/dev `dsh-client-connection`+`dsh-tools`、dependencies `dsh-typert-protocol` 统一钉 `0.2.1-rc.3`；插件版本 0.1.2 → 0.1.3；pnpm-workspace.yaml `minimumReleaseAgeExclude` 名单换 rc.3（新发布包需排除最小发布龄拦截才可安装） |
| 不动 | dsh-ssh 家族维持 `0.1.6-alpha.1` 钉版（独立升级线，升级需 spike 回归，见矩阵行）；「dsh 0.2.1-rc.2 起 reason 为 {kind} 对象」等历史行为注释保留原版本号（行为引入版本的事实记录，非当前基线） |
| 验证 | typecheck 零错误；vitest 174 文件 / 1585 测试绿（2 skip 为存量）；build 产物绿；eslint + prettier 绿。`pnpm peers check` 的 10 条 unmet peer 警告与 rc.2 基线逐条一致（stash 对照验证：cordis ~4.0.5 / dsh-sandbox 家族等——咨询性存量，宿主运行期由 install anchor 供 peer）。**真机闭环（2026-10-25）**：本机 dsh CLI 升 0.2.1-rc.3（npm 全局，node-pty 等装包脚本被拦但 prebuilds 在场免脚本）后，旧包 0.1.2 在 rc.3 宿主实测被拒载（add 期显式警告 "requirements … 0.2.1-rc.2" + 启动拒绝，印证 A2 机制）；remove + 重 add 装入 0.1.3（同路径 file: 依赖 pnpm 复用旧解析，须先 remove 再 add 刷新）后警告消失，`dsh --profile pky-test` boot 插件装载成功（hostEntry apply 跑通、待办库 banner 打印、宿主驻留约 100s 无拒载/异常） |
| 事实边界 | rc.3 与 rc.2 代码零差异，A4 八键真机事实与 worktrees/timer 携带面记录直接沿用 |

## A6 升级记录：dsh-ssh 家族 0.1.6-alpha.1 → 0.2.1-rc.3（2026-10-25，插件 0.1.4）

| 项 | 结论 |
| --- | --- |
| 动因 | 独立升级线（A5 不动项）：平台线已到 rc.3 而 ssh 家族仍 0.1.6-alpha.1，lock 内家族分裂（dsh-ssh 拖 `0.1.6-alpha.2` 传递包与 rc.3 平台线并存，`dsh-brand`/`dsh-timeout`/`dsh-util-values` 双版本）；升级后 `@deepseek-ai/*` 全部收敛单一 rc.3 线、cordis 4.0.4 → 4.0.5（宿主携带同版） |
| diff 实测（tarball 逐文件） | **非 re-release**：① Config `node: string` → `launch: { kind: "node-script", node } \| { kind: "executable" }`，zod 校验改 `.strict()`（旧字段构造期即抛）；② 实例 getter `nodeExecutable`/`bootstrapPath` → `ptcLaunch`（插件未消费）；③ `SSH_PROTOCOL_VERSION` 1 → 2，hello schema 字面量锁 2、新增 `kind`/`executable` 字段——**旧 helper 握手被拒，已开通远端必须重装 helper**；④ helper.js 新增 `import "node:sea"`——远端 Node ≥ 20.12 / 21.7；⑤ 客户端 index.js 新增运行时依赖 `@deepseek-ai/dsh-util-values`（peer，宿主 anchor 供给已实测）；⑥ 终端新增 `terminal.activity` RPC（`shellActivity` 可选）——加法；⑦ `stream-security-DJlQsPG-.js` **字节级相同**（TLS 1.2 `PSK-AES256-GCM-SHA384` + `pskCallback`）——**A3 未修，broker 过渡通道维持** |
| executable 形态 | 上游 Node SEA 单文件 helper（内嵌 Node + PTC worker，免远端装 Node）——归档来自 monorepo `ssh-helper-runtime`，npm 未发布、dsh 0.2.1-rc.3 CLI 亦不携带；插件 `SshFamilyConfig.launch` 只收 `node-script`，executable 待上游发布后再评估（docs/debt.md 气隙安装条目跟踪） |
| 改动 | package.json：dsh-ssh / dsh-subprocess-ssh 钉 `0.2.1-rc.3`、cordis peer/dev `~4.0.5`、插件 0.1.3 → 0.1.4；Config 改形三处（`dsh/sshScope.ts` `SshFamilyConfig` / `dsh/sshScopeHost.ts` `familyConfig` / `dsh/brokerProtocol.ts` `BrokerConnectConfig`——broker 子进程原样喂 `sshScope.plugin`）；版本字面量（probeDsh 三处 detail / remoteAssembly 回落值）；**两处配套防护**：(a) `SshScopeHostOptions.helperHashAuthority`（remoteAssembly 注入闭包权威摘要）——实体 helperHash 落后于闭包时 scopeFor 先行直连（否则家族链 hello 即被拒、recheck 走不到摘要比对、部署卡 disconnected 带 zod 报错），recheck 经直连 sha256 比对走既有 `markHelperMismatch` 重装链；(b) `provisionCommands.remoteNodeSupported` 步② probe-node 版本门槛 ≥ 20.12 / 21.7（此前只看退出码，过旧 Node 会装成功后 helper 启动即崩、表象握手超时） |
| 验证 | typecheck 零错误；vitest 176 文件 / 1592 测试绿（新增 `dsh-scope-host-stale.spec` 3 例 + `remote/provisionNodeGate.spec` 4 例；`dsh-scope-host` 替身抽 `dsh-scope-host-harness.ts`）；build 三段绿；lint-gate 三服务 + 质量棘轮绿；`pnpm install` 零 peer 警告。**真机闭环（2026-10-25，`dsh --profile pky-test` web 宿主，系统 Node v24.21.0）**：remove + add 装入 0.1.4 后 boot 装载成功；`diagnosticsSnapshot.capabilities["dsh-ssh"]` = `dsh-ssh@0.2.1-rc.3 + dsh-subprocess-ssh` ok（`dsh-util-values` peer 经宿主 anchor 解析）；既有部署 pky-remote（旧 helper）首轮周期复核即按防护 (a) 路由直连 → 摘要探测报远端 helper 文件已失踪（`sha256sum: No such file or directory`）→ `not_ready` 可读原因（替代此前 `$.launch missing required value`）；向导 `restart` 重跑四步全过（probe-node v24.21.0 过门槛 → 远端 `npm install @deepseek-ai/dsh-ssh@0.2.1-rc.3` → 验证通过）→ `deploymentRecheck` 经家族链 **协议 2 握手 ready**（helperHash 更新为新闭包摘要 `d20e6ba7…`）；ssh 直查容器 `dsh-ssh 0.2.1-rc.3` / `SSH_PROTOCOL_VERSION = 2` |
| 运维提示 | ① 升级后所有已开通远端在首轮复核落 `not_ready`，向导点「重装」即可（upload 复用原 helperPath 目录原位装 rc.3）；② 从仓库 dist 长期驻留的旧宿主/`broker.mjs` 进程（desktop profile file: 链 + 遗留 broker）会在重启前以旧 Config 喂新库报 `$.launch missing`——重启桌面 app / 清理残留 broker 即消（docs/debt.md 窗口抬升条目附注同族）；③ desktop 宿主 broker 路径本轮未真机复测（传输层字节级未变，Config 改形在 broker 协议同步） |
| 事实边界 | A3 结论原样沿用（流安全模块未变）；A4 `dsh-ssh` 行 0.1.6-alpha.1 为当日事实记录；dsh terminal 行真 PTY 实测基于 0.1.6-alpha.1，rc.3 PTY 面为加法变更未复测 |

## 兼容矩阵（依赖子系统 × 最低版本 × 探测键）

| 依赖子系统 | 最低版本 | 探测键（`CAPABILITY_KEYS` 单源比对位） | 探测方式 | 状态 |
| --- | --- | --- | --- | --- |
| Node 运行时 | ≥ 24 | `node-runtime` | apply 期 `process.versions.node`（`probeNodeRuntime`） | 双形态已实测（web 系统 Node / Electron 内嵌均 24.21.0，见 A1/A4） |
| node:sqlite（DatabaseSync） | Node ≥ 24（内嵌 SQLite 3.53） | `node-sqlite` | apply 期内存库试开（`probeNodeSqlite`） | 双形态已实测（Electron 内嵌 Node 17 表 schema 冒烟通过，A4） |
| dsh | 0.2.1-rc.3（基线） | `dsh` | 装配期宿主表面探测（`probeDshCapabilities`：ctx.isolate/plugin 在场即插件已在宿主内运行） | 平台事实（0.2.1-rc.3 peer 钉版，见 A2/A5）；探测实装 |
| cordis-plugin-timer | ~1.1.6（dsh 宿主携带；携带面沿 0.2.0-rc.2 核实） | `dsh-timer` | 装配期 ctx 表面探测（`probeDshCapabilities`：ctx.interval 函数 / ctx.timer 对象任一在场；hostEntry 已 inject timer） | 探测+装配已实测（2026-10-21 web 宿主 ok，四循环 ctx.interval 驱动，A4；行为面沿 full-parity 4.5 真机记录） |
| dsh session（`ctx.agents` + `ctx.sessions`） | 0.2.1-rc.3（dsh-base 恒在场） | `dsh-session` | 装配期 ctx 注入面存在性（`probeDshCapabilities`：ctx.sessions；hostEntry inject 声明 agents/sessions/agentDefaultModel——缺席插件不装） | 真机探测 ok（2026-10-21 web 宿主，A4；基线随 A5 升 rc.3，代码零差异沿用）。**消费面已实装（2026-10-19 root 会话判定通道）**：`dsh/sessionExecutor.ts` 经 `agents.create`（root agent、无 origin 分类、meta.cwd 归组项目）+ `agent.followup`/`whenIdle` + `sessions.flush`（执行配方同 dsh-headless）——每批判定 = 一条新会话（`pky-judge-` 前缀），进宿主主会话列表、可回放（前形态无头 subagent 经用户裁决退役，ADR-0003）。root 会话无 outputSchema 结构化约束：prompt 要求裸 JSON 返回 + 围栏容忍解析（垃圾输出=通道失败）；模型组合取 `agentDefaultModel.currentSelection()`（无组合时 prompt 装配报 `{{model}}` 无值，真机实证）。判定会话无插件工具装配——判定上下文（openTasks/categories/tags/dimensions/now，`pk context` 逐字段同构 `buildToolContextData`）由接线层以当前 conn 现取、注入 prompt 头部（2026-10-20 落地，debt 原「候选②执行器预取」；候选①工具装配不采——agentCtx 作用域工具面未验证且 root 形态下无必要） |
| dsh worktrees | —（截至基线核实宿主未提供注入面） | `dsh-worktrees` | 装配期 ctx 注入面存在性（`probeDshCapabilities`：ctx.worktrees） | 探测实装；真机确认无注入面（2026-10-21 web 宿主，A4）——派发工作树由插件 ShellRunner 自建 git worktree，缺失只呈现不阻断 |
| dsh SSH provider family | **0.2.1-rc.3**（插件 dependencies 钉版分发；wire 协议 2——远端 helper 须同版，远端 Node ≥ 20.12 / 21.7） | `dsh-ssh` | 装配期动态 `import("@deepseek-ai/dsh-ssh")` + `import("@deepseek-ai/dsh-subprocess-ssh")` 可解析 + 导出面形状（default class + 静态 Config/inject 标记）；闭包版本号经 `createRequire` 读 package.json | 已实测（spike 2026-10-17 PASS 于 0.1.6-alpha.1；**A6 升级 rc.3 真机闭环 2026-10-25**：web 宿主探测 ok + 重开通 + 协议 2 握手 ready）。**Electron 宿主 TLS-PSK 协商失败（A3，2026-10-18）——已实装 broker 过渡通道（系统 Node 子进程传输，0.1.2）；rc.3 流安全模块字节级未变，A3 维持** |
| dsh storage | —（插件自持） | `dsh-storage` | 装配期 ctx 注入面存在性；宿主无 `ctx.storage` → 按前序自持口径标 ok（插件 storage 唯一握连接，detail 注明自持） | 探测实装；自持口径真机成立（2026-10-21，A4） |
| dsh slots | —（插件自持） | `dsh-slots` | 装配期 ctx 注入面存在性；宿主无 `ctx.slots` → 按前序自持口径标 ok（并发槽由插件 dispatch_slots 库内实现，detail 注明自持） | 探测实装；自持口径真机成立（2026-10-21，A4） |
| dsh terminal | 随 dsh 宿主版本（dsh-subprocess-ssh 0.1.6-alpha.1 真 PTY 已实测；0.2.1-rc.3 随 A6 升级，PTY 面为加法变更未复测） | `dsh-terminal` | 装配期宿主 ctx 终端表面探测（`probeDshCapabilities`：subprocess.spawnTerminal 可调 / ctx.terminals 在场） | 探测实装；真机确认 web 宿主无终端表面（2026-10-21，A4——外部终端真窗口承接）；spike 验证点② 已实测（双作用域真 PTY 无串扰）。**用户面板驱动**：dsh 0.2.x 无第三方面（浏览器终端 Session 私有 / ctx.terminals 为 agent 工具注册表 / spawnTerminal 为无 UI 裸 PTY）——**desktop 载体经外部终端真窗口等效闭环（2026-10-18，同日增终端偏好遵循 + iTerm2 入链 + kitty tab 复用）**：探测链 kitty → Ghostty → Alacritty → WezTerm → iTerm2 → Terminal.app（open 家族 `open -na` 免授权、AppleScript 家族逐行 -e，真机已验；kitty 首位因 tab 复用——remote control socket（约定 `unix:/tmp/kitty.sock`）在场时 `kitten @ launch --type=tab` 在最近活跃 kitty 窗口开 tab（outcome=`external-kitty@tab`），缺席/失败回落 `open -na` 自举带 `--listen-on`/`--override` 旗标的新实例供后续派发 tab 复用——listen socket 只认启动旗标，kitty.conf 的 `listen_on` 解析但不建 socket（0.49.2 实证），自举不依赖用户 kitty.conf），共享设置 `terminal_preference`（主应用 TerminalPref 值域同源对齐：kitty 双形态跨形态同构实装——macOS tab 复用/自举、Linux 直启）命中且已安装时优先于探测链、未装/未知值链回落，交互派发/回放/lark 登录共用（偏好值随每次唤起注入——运行期改设置即时生效）；唤起失败回落 handoff 复制；web/headless CLI 载体（非 Electron 宿主）不弹窗 → handoff + Web 提示（docs/debt.md ③） |

> 探测实装归 `src/host/dsh/probeDsh.ts`（任务 2.2）；键集 = CAPABILITY_KEYS 的 dsh
> 子集（`DSH_CAPABILITY_KEYS` 双向断言，`__tests__/dsh-probe.spec.ts`）。dsh RC 期
> 破坏性变更被架构限制在 dsh/ 适配层（AD §1 排序③）；dsh 平台包升级 = 显式改钉版
> + 全量验证（见 A2 升级记录）；dsh-ssh 家族升级 = 显式改钉版 + spike 回归。
