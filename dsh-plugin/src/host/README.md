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
  撤销面 + pageOpen 推送出口 + conversation chip 数据源——dsh 适配层接线面）。

> 注：待办标记只写在本 README（.md 不入质量棘轮 ③ 卫生扫描口径）；源码内不落 TODO 字面量，
> 全仓 TODO 基线 = 0（quality-ratchet-baseline.json hygiene 段）。
