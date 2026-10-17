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

## 兼容矩阵（依赖子系统 × 最低版本 × 探测键）

| 依赖子系统 | 最低版本 | 探测键（`CAPABILITY_KEYS` 单源比对位） | 探测方式 | 状态 |
| --- | --- | --- | --- | --- |
| Node 运行时 | ≥ 24 | `node-runtime` | apply 期 `process.versions.node`（`probeNodeRuntime`） | 本工具链已实测；dsh 宿主待实测 |
| node:sqlite（DatabaseSync） | Node ≥ 24（内嵌 SQLite 3.53） | `node-sqlite` | apply 期内存库试开（`probeNodeSqlite`） | 本工具链已实测；dsh 宿主待实测 |
| dsh | 0.2.0-rc.2（基线） | `dsh` | 装配期宿主表面探测（`probeDshCapabilities`：ctx.isolate/plugin 在场即插件已在宿主内运行） | 平台事实（任务输入核实）；探测实装 |
| cordis-plugin-timer | ~1.1.6（dsh 0.2.0-rc.2 携带） | `dsh-timer` | 装配期 ctx 表面探测（`probeDshCapabilities`：ctx.interval 函数 / ctx.timer 对象任一在场；hostEntry 已 inject timer） | 探测实装；宿主注入待 4.5 冒烟复核 |
| dsh subagent（`ctx.subagents`） | 随 dsh 0.2.0-rc.2 | `dsh-subagent` | 装配期 ctx 注入面存在性（`probeDshCapabilities`；判定执行方 A7，Phase B 接面） | 探测实装；消费面后续任务 |
| dsh worktrees | —（dsh 0.2.0-rc.2 未提供注入面） | `dsh-worktrees` | 装配期 ctx 注入面存在性（`probeDshCapabilities`：ctx.worktrees） | 探测实装；派发工作树由插件 ShellRunner 自建 git worktree，缺失只呈现不阻断 |
| dsh SSH provider family | **0.1.6-alpha.1**（插件 dependencies 钉版分发） | `dsh-ssh` | 装配期动态 `import("@deepseek-ai/dsh-ssh")` + `import("@deepseek-ai/dsh-subprocess-ssh")` 可解析 + 导出面形状（default class + 静态 Config/inject 标记）；闭包版本号经 `createRequire` 读 package.json | 已实测（spike 2026-10-17 PASS；本机闭包动态 import 断言绿） |
| dsh storage | —（插件自持） | `dsh-storage` | 装配期 ctx 注入面存在性；宿主无 `ctx.storage` → 按前序自持口径标 ok（插件 storage 唯一握连接，detail 注明自持） | 探测实装；自持口径 |
| dsh slots | —（插件自持） | `dsh-slots` | 装配期 ctx 注入面存在性；宿主无 `ctx.slots` → 按前序自持口径标 ok（并发槽由插件 dispatch_slots 库内实现，detail 注明自持） | 探测实装；自持口径 |
| dsh terminal | 随 dsh 0.2.0-rc.2（dsh-subprocess-ssh 0.1.6-alpha.1 真 PTY 已实测） | `dsh-terminal` | 装配期宿主 ctx 终端表面探测（`probeDshCapabilities`：subprocess.spawnTerminal 可调 / ctx.terminals 在场） | 探测实装；spike 验证点② 已实测（双作用域真 PTY 无串扰） |

> 探测实装归 `src/host/dsh/probeDsh.ts`（任务 2.2）；键集 = CAPABILITY_KEYS 的 dsh
> 子集（`DSH_CAPABILITY_KEYS` 双向断言，`__tests__/dsh-probe.spec.ts`）。dsh 0.2.0-rc.2
> 属 RC 期，破坏性变更被架构限制在 dsh/ 适配层（AD §1 排序③）；dsh-ssh 家族升级 =
> 显式改钉版 + spike 回归。
