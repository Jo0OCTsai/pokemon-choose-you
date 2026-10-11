# src/host —— 宿主半边（AD §3.1）

package-by-feature 模块挂点：每个子目录 README 记一句话职责（内容取自 AD §3.1，防后续任务找不到挂点）。

## 挂点清单（后续任务落位，specs/dsh-plugin/plan.md 并行组 1）

- TODO（AD NFR-3 ②）：apply 期能力探测全集——timer / subagent / worktrees / ssh / storage /
  slots / terminal 表面 + 宿主 Node 运行时；node:sqlite 探测已落 `index.ts`（`probeNodeSqlite`）。
  探测清单与 `docs/compatibility.md` 矩阵的一致性由单测断言（矩阵与代码不一致即红）。
- TODO：`tools/` 注册面（AD §3.1：dsh tools 注册，会话模型与判定 subagent 的统一消费面——
  薄壳，全部转发到 domain/judge/dispatch）。
- TODO：storage/ 落 node:sqlite 连接与 guarded 迁移（并行组 1 任务 3，A1 实测见 docs/compatibility.md）。
- TODO：domain/ 各状态机与并发原语（并行组 1 任务 2，TDD 重灾区，逐 fixtures 回放）。

> 注：待办标记只写在本 README（.md 不入质量棘轮 ③ 卫生扫描口径）；源码内不落 TODO 字面量，
> 全仓 TODO 基线 = 0（quality-ratchet-baseline.json hygiene 段）。
