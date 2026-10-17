# src/host —— 宿主半边（AD §3.1）

package-by-feature 模块挂点：每个子目录 README 记一句话职责（内容取自 AD §3.1，防后续任务找不到挂点）。

## 挂点清单（specs/dsh-plugin/plan.md 并行组 1）

- ~~apply 期能力探测全集~~：已落 `index.ts`（`CAPABILITY_KEYS` 单源 + `probeNodeRuntime` /
  `probeNodeSqlite`；dsh 表面键已入清单锁一致性，真实 dsh Context 适配层落位时逐项补探测实现）。
  探测清单与 `docs/compatibility.md` 矩阵「探测键」列的一致性由 `__tests__/compat.spec.ts` 断言。
- ~~`tools/` 注册面~~：已落（`registry.ts` defineTools + `todoTools.ts` 装配 22 工具名 /
  AD §4.1 表 20 行；`todoTaskTools` / `todoOpsTools` / `contextData` 分文件）——dsh 真实
  tools API 适配层后续消费注册表投影。
- ~~storage/ node:sqlite 连接与 guarded 迁移~~：已落（A1 实测见 docs/compatibility.md）。
- ~~domain/ 各状态机与并发原语~~：已落（契约回放 `__tests__/contracts-replay.spec.ts`
  43 场景全绿——FR-X3 以 contracts/fixtures 锁定）。
- `index.ts`：能力探测 + `apply`（骨架语义保留）；惰性装配工厂 `createPlugin(deps)` 见
  `assembly.ts`（+ `petSection.ts` 桌宠段），全部依赖可注入（伪 ctx 集成测试消费）。
- `commands.ts` + `commands/`：host 命令实现表（AD §4.1.1 的 49 RPC + taskDeleteUndo
  撤销面 + 实体读域 5 条（`readCommands.ts`：panelSnapshot/taskDetail/taskSearch/
  todayTasks/categoriesList——Phase B 契约缺口补齐，全部只读）+ pageOpen 推送出口 +
  conversation chip 数据源——dsh 适配层接线面）。


## 挂点清单（specs/dsh-plugin-full-parity/plan.md · 全量补齐批次）

- `reminder/`：到期查询（query）/聚合与勿扰纯函数（aggregate）/当日去重键 CAS（daily-keys）/
  20s tick 编排与送达通道（loop/deliver——timer 注入，helper sys-notify 优先、缺席 toast 降级）。
  行为基准 = 桌面 scheduler.rs（契约 `reminder` 场景组 8 例锁定）。
- `remote/`：部署域纯逻辑——deployments（settings 键 CRUD + alias 唯一索引 + 白名单键集）/
  provision（四步幂等状态机，步③ = 远端 npm 闭包安装——spike 修正 C）/recheck/lateReport/
  sshExecutor（dispatch 远端执行器与降级链）。**零 dsh import**：`sshScope.ts` 定义平台中立
  SshScope 接口，实现唯一落点 `dsh/sshScope.ts`。
- `dsh/sshScope.ts`：唯一 dsh-ssh 家族触碰点（per-deployment 双 label isolate + consumer 子插件
  + fiber dispose——装配模式见 specs/dsh-plugin-full-parity/spike-dsh-ssh.md 修正 A/B）；
  `dsh/probeDsh.ts`：capability 键真实探测（dsh-ssh 动态 import 形状 + ctx 表面）。
- `domain/streak.ts` + `domain/backup-{import,restore,loop}.ts`：连胜纯函数（契约 `streak` 组 6 例）
  与导入/恢复/每日备份循环（D25 前置快照 + A36 备份成功后条件写键）。
- `dispatch/sessions.ts`：sessionsPage 分页（M9 归组）+ sessionReplay 回放路由（执行世界快照压过
  当前配置）；`dispatch/` 各 seam 的远端分支注入面（HeadlessDeps.executorFor / TerminalAdapter /
  ShellRunner）见 `remote/sshExecutor.ts` 三个装配缝。
- `commands/remoteCommands.ts` + 各分域扩展：命令面 69→87（AD §4.1 17 条 + macAuthPaneOpen 联调
  对齐 1 条）；`HOST_COMMAND_NAMES` 单源 87 断言。
- `pet/` 扩展：sysChannel（hello 门控 + 能力位降级）/sysRequests（seq 两段语义）/sysEvents/
  macAuth/solemn（郑重时刻 A30）/electronGet（@electron/get 严格校验 + ~/.dsh/electron/dist 落位）/
  petChat（FR-A8 主 agent 执行方）。
- `loopSection.ts` + `petSection.ts`：reminder/backupLoop timer 装配与 sys-config 下发编排
  （能力探测失败不装配不报错——A20 语义扩展）。

> 注：待办标记只写在本 README（.md 不入质量棘轮 ③ 卫生扫描口径）；源码内不落 TODO 字面量，
> 全仓 TODO 基线 = 0（quality-ratchet-baseline.json hygiene 段）。
