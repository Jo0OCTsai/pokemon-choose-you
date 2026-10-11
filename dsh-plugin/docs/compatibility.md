# dsh 兼容矩阵（FR-X7）

> 本文件是「依赖子系统 × 最低版本」兼容矩阵的家（AD §6 NFR-3 ③）。单测将断言本矩阵与
> `src/host/index.ts` apply 期能力探测清单一致（矩阵与代码不一致即红）——矩阵行增删须同步
> 探测清单；断言随组 1 后续任务挂入 CI plugin job（见 `.github/workflows/ci.yml` 占位注释）。

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

## 兼容矩阵（依赖子系统 × 最低版本）

| 依赖子系统 | 最低版本 | 探测方式 | 状态 |
| --- | --- | --- | --- |
| Node 运行时 | ≥ 24 | apply 期 `process.versions.node`（随 `probeNodeSqlite` 试开） | 本工具链已实测；dsh 宿主待实测 |
| node:sqlite（DatabaseSync） | Node ≥ 24（内嵌 SQLite 3.53） | apply 期内存库试开（`probeNodeSqlite`） | 本工具链已实测；dsh 宿主待实测 |
| dsh | 0.2.0-rc.2（基线） | 插件清单声明 + apply 期探测兜底（A8：清单字段名待确认，`package.json` 的 `dsh`/`engines` 为占位） | 平台事实（任务输入核实） |
| cordis-plugin-timer | 待定 | apply 期表面探测（NFR-3 ②，轮询载体 D14 分支 A） | 待实测 |
| dsh subagent（local children / external） | 待定 | 同上（判定执行方 A7） | 待实测 |
| dsh worktrees | 待定 | 同上（派发工作树） | 待实测 |
| dsh SSH provider family | 待定 | 同上（远程派发 deployment 引用 A13） | 待实测 |
| dsh storage | 待定 | 同上（纯 dsh 平台态，A2） | 待实测 |
| dsh slots | 待定 | 同上（机器级并发槽宿主面） | 待实测 |
| dsh terminal | 待定 | 同上（交互派发终端面板） | 待实测 |

> 「待定」行随 apply 期能力探测全集任务（AD NFR-3 ②）逐项落实最低版本并补单测断言；
> dsh 0.2.0-rc.2 属 RC 期，破坏性变更被架构限制在 index/pet/dispatch 薄适配层（AD §1 排序③）。
