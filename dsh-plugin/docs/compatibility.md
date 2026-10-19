# dsh 兼容矩阵（FR-X7）

> 本文件是「依赖子系统 × 最低版本」兼容矩阵的家（AD §6 NFR-3 ③）。单测断言本矩阵
> 「探测键」列与 `src/host/index.ts` 的 `CAPABILITY_KEYS` 探测清单全集**双向相等**
> （矩阵与代码不一致即红）——矩阵行增删须同步探测清单；断言已挂入 CI plugin job
> （vitest 套件的一部分，`__tests__/compat.spec.ts`）。
>
> dsh 平台面 8 键的探测已实装（`src/host/dsh/probeDsh.ts`，任务 2.2）：结果进
> diagnosticsSnapshot 的 `capabilities` 段（`sshFamily` 字段 = `dsh-ssh` 条目的呈现
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
**dsh 宿主实际运行时（Electron 内嵌 Node）仍待实测**——探测已纳入 apply 期能力清单
（NFR-3 ②，`probeNodeSqlite`）；失败回落链 = better-sqlite3 + 按 ABI 分发预编译产物
（Electron 下需 electron-rebuild），见 AD §2 A1。

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

## 兼容矩阵（依赖子系统 × 最低版本 × 探测键）

| 依赖子系统 | 最低版本 | 探测键（`CAPABILITY_KEYS` 单源比对位） | 探测方式 | 状态 |
| --- | --- | --- | --- | --- |
| Node 运行时 | ≥ 24 | `node-runtime` | apply 期 `process.versions.node`（`probeNodeRuntime`） | 本工具链已实测；dsh 宿主待实测 |
| node:sqlite（DatabaseSync） | Node ≥ 24（内嵌 SQLite 3.53） | `node-sqlite` | apply 期内存库试开（`probeNodeSqlite`） | 本工具链已实测；dsh 宿主待实测 |
| dsh | 0.2.1-rc.2（基线） | `dsh` | 装配期宿主表面探测（`probeDshCapabilities`：ctx.isolate/plugin 在场即插件已在宿主内运行） | 平台事实（0.2.1-rc.2 peer 钉版，见 A2）；探测实装 |
| cordis-plugin-timer | ~1.1.6（dsh 宿主携带；携带面沿 0.2.0-rc.2 核实） | `dsh-timer` | 装配期 ctx 表面探测（`probeDshCapabilities`：ctx.interval 函数 / ctx.timer 对象任一在场；hostEntry 已 inject timer） | 探测实装；宿主注入待 4.5 冒烟复核 |
| dsh session（`ctx.agents` + `ctx.sessions`） | 0.2.1-rc.2（dsh-base 恒在场） | `dsh-session` | 装配期 ctx 注入面存在性（`probeDshCapabilities`：ctx.sessions；hostEntry inject 声明 agents/sessions/agentDefaultModel——缺席插件不装） | **消费面已实装（2026-10-19 root 会话判定通道）**：`dsh/sessionExecutor.ts` 经 `agents.create`（root agent、无 origin 分类、meta.cwd 归组项目）+ `agent.followup`/`whenIdle` + `sessions.flush`（执行配方同 dsh-headless）——每批判定 = 一条新会话（`pky-judge-` 前缀），进宿主主会话列表、可回放（前形态无头 subagent 经用户裁决退役，ADR-0003）。root 会话无 outputSchema 结构化约束：prompt 要求裸 JSON 返回 + 围栏容忍解析（垃圾输出=通道失败）；模型组合取 `agentDefaultModel.currentSelection()`（无组合时 prompt 装配报 `{{model}}` 无值，真机实证）。已知局限：判定会话无插件工具装配（判重/分类/标签/相对时间缺上下文）——候选演进 = `agents.create` setup 挂 todoContext/todoSuggestBatch（docs/debt.md） |
| dsh worktrees | —（截至基线核实宿主未提供注入面） | `dsh-worktrees` | 装配期 ctx 注入面存在性（`probeDshCapabilities`：ctx.worktrees） | 探测实装；派发工作树由插件 ShellRunner 自建 git worktree，缺失只呈现不阻断 |
| dsh SSH provider family | **0.1.6-alpha.1**（插件 dependencies 钉版分发） | `dsh-ssh` | 装配期动态 `import("@deepseek-ai/dsh-ssh")` + `import("@deepseek-ai/dsh-subprocess-ssh")` 可解析 + 导出面形状（default class + 静态 Config/inject 标记）；闭包版本号经 `createRequire` 读 package.json | 已实测（spike 2026-10-17 PASS；本机闭包动态 import 断言绿）。**Electron 宿主 TLS-PSK 协商失败（A3，2026-10-18）——已实装 broker 过渡通道（系统 Node 子进程传输，0.1.2）** |
| dsh storage | —（插件自持） | `dsh-storage` | 装配期 ctx 注入面存在性；宿主无 `ctx.storage` → 按前序自持口径标 ok（插件 storage 唯一握连接，detail 注明自持） | 探测实装；自持口径 |
| dsh slots | —（插件自持） | `dsh-slots` | 装配期 ctx 注入面存在性；宿主无 `ctx.slots` → 按前序自持口径标 ok（并发槽由插件 dispatch_slots 库内实现，detail 注明自持） | 探测实装；自持口径 |
| dsh terminal | 随 dsh 宿主版本（dsh-subprocess-ssh 0.1.6-alpha.1 真 PTY 已实测） | `dsh-terminal` | 装配期宿主 ctx 终端表面探测（`probeDshCapabilities`：subprocess.spawnTerminal 可调 / ctx.terminals 在场） | 探测实装；spike 验证点② 已实测（双作用域真 PTY 无串扰）。**用户面板驱动**：dsh 0.2.x 无第三方面（浏览器终端 Session 私有 / ctx.terminals 为 agent 工具注册表 / spawnTerminal 为无 UI 裸 PTY）——**desktop 载体经外部终端真窗口等效闭环（2026-10-18，同日增终端偏好遵循 + iTerm2 入链 + kitty tab 复用）**：探测链 kitty → Ghostty → Alacritty → WezTerm → iTerm2 → Terminal.app（open 家族 `open -na` 免授权、AppleScript 家族逐行 -e，真机已验；kitty 首位因 tab 复用——remote control socket（约定 `unix:/tmp/kitty.sock`）在场时 `kitten @ launch --type=tab` 在最近活跃 kitty 窗口开 tab（outcome=`external-kitty@tab`），缺席/失败回落 `open -na` 自举带 `--listen-on`/`--override` 旗标的新实例供后续派发 tab 复用——listen socket 只认启动旗标，kitty.conf 的 `listen_on` 解析但不建 socket（0.49.2 实证），自举不依赖用户 kitty.conf），共享设置 `terminal_preference`（主应用 TerminalPref 值域同源对齐：kitty 双形态跨形态同构实装——macOS tab 复用/自举、Linux 直启）命中且已安装时优先于探测链、未装/未知值链回落，交互派发/回放/lark 登录共用（偏好值随每次唤起注入——运行期改设置即时生效）；唤起失败回落 handoff 复制；web/headless CLI 载体（非 Electron 宿主）不弹窗 → handoff + Web 提示（docs/debt.md ③） |

> 探测实装归 `src/host/dsh/probeDsh.ts`（任务 2.2）；键集 = CAPABILITY_KEYS 的 dsh
> 子集（`DSH_CAPABILITY_KEYS` 双向断言，`__tests__/dsh-probe.spec.ts`）。dsh RC 期
> 破坏性变更被架构限制在 dsh/ 适配层（AD §1 排序③）；dsh 平台包升级 = 显式改钉版
> + 全量验证（见 A2 升级记录）；dsh-ssh 家族升级 = 显式改钉版 + spike 回归。
