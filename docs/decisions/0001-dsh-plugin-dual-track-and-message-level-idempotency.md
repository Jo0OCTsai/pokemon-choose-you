# ADR-0001：dsh 插件形态双轨并存与消息级幂等并发模型

> 状态：已采纳　日期：2026-10-12
> 来源：`specs/dsh-plugin/`（SDD D11/D14/D15 · AD §5.1/§5.3/§5.4 · 就地决策 A3/A5/A19/A22）；规范单源 = `contracts/PROTOCOL.md`，行为契约以 `contracts/fixtures/` 锁定的代码行为为准（FR-X3）。

## 背景

「就决定是你了」以 dsh（DeepSeek Harness 0.2.0-rc.2）Cordis 插件形态落地为与 Tauri 主应用**长期并存**的第二形态（`dsh-plugin/`）。两形态面向**同一份待办数据**，不出现第二套待办库、不开同步层——dsh 插件宿主半边（Node）成为继主应用（rusqlite）与 pk CLI 之后的**第三个 SQLite 直连方**。三方并发正确性不靠进程隔离，靠库内原子操作与短事务；主应用正常演进、行为不受插件存在影响（FR-X4）。

## 决策

### 1. 并发模型 = 消息级幂等，否决互斥单游标（D11 → AD A5）

双形态轮询/判定/分诊并存采用「结果幂等」，机制为四个库内原子原语，任一失败 = 幂等反馈而非错误状态：

| 原语 | 保障的不变式 |
|---|---|
| 判定 claim：`UPDATE chat_messages SET ai_status='judging', judge_claimed_at=now WHERE … AND ai_status='pending'`（只处理 claim 到的子集；judging 超 10 分钟任一形态可回收 pending，A6） | 同一消息至多一条待处理建议、不重复判定 |
| `message_id` UNIQUE + `INSERT OR IGNORE`；水位 CAS（`sync_state` + `settings` 双写，`WHERE cursor=old`） | 双形态拉取自由并发、不重复入库 |
| 分诊/派发 CAS（`WHERE review_status='pending'` / `dispatch_state=<from>`，affected=0 即「已处置」幂等反馈） | 建议分诊结果幂等、同一任务至多一个活动派发 |
| `dispatch_slots` 槽表（领取插租约、收口删、过期回收；上限检查 = `BEGIN IMMEDIATE` 内 COUNT，host_key 归一 `local` / `ssh:user@host`） | 机器级自动派发并发上限跨形态合计 |

否决理由（互斥单游标/轮询租约）：租约的崩溃恢复、时钟漂移、双形态竞争都是新增失败模式；且拉取互斥挡不住判定与分诊的并发，还要再造第二套机制。消息级幂等与现行 WAL 多进程模型（pk × GUI 已验证）同构。

### 2. 轮询载体 = cordis-plugin-timer + 自管水位，拉取步零 LLM（D14 分支 A）

收音机轮询由插件宿主半边的 cordis-plugin-timer 周期回调驱动（dsh base profile 自带）：增量拉取（since = 共享水位）→ 去重入库 → CAS 推进水位 → 判定。拉取/水位推进是确定性代码，**不产生任何 LLM 调用**；断网退避 ×2 上限 ×8（与主应用同口径，D8）。catch-up 由插件自管水位实现，与主应用增量轮询同构（jobs 运行时是长任务生产者容器、不带周期调度，故选 timer）。

### 3. 同一 SQLite 三方直连的访问铁律

- 直连 `~/.choose-you/data/pokemon-choose-you.db`（`CHOOSE_YOU_HOME` 覆盖优先，与 `db.rs` 同解析规则）；打开即 `PRAGMA journal_mode=WAL; synchronous=NORMAL; busy_timeout=5000`。
- 所有写操作 = 单条 `BEGIN IMMEDIATE` 短事务；跨行不变式一律 compare-and-swap（WHERE 守卫 + affected rows 判定）；禁止长事务、禁止事务内子进程调用/await。
- 全局唯一进行中（出发顶下 demote）由同一原语保证；审计（`task_logs`）双形态同构写入（origin 区分形态），为 NFR-1 对账 oracle。

### 4. guarded 双执行方迁移协议（A19 封顶 + A3 就地决策）

- 迁移 SQL 单源 = `contracts/schema/`（编号顺序执行）；执行权 = 「主应用 + 插件」双执行方、库内原子互斥：`BEGIN IMMEDIATE` 内读 `PRAGMA user_version`，逐条执行到目标版本。
- 插件声明 `[minSchema, maxSchema]` 兼容窗口：`user_version > maxSchema` → 只读模式 + `DB_SCHEMA_TOO_NEW` 拒写（FR-X2）；`< minSchema` → 执行 guarded 迁移但**封顶 minSchema 即停**——「把库版本推进到更高」只由主应用执行，防「先升插件 → 共存窗口内旧主应用 FutureVersion 拒启」破坏 FR-X4 可感承诺（A19）。
- **就地决策（A3 实施落点）**：新增的 `dispatch_slots` 表与 `chat_messages.judge_claimed_at` 列以**追加迁移 `002_dispatch_coord.sql`** 落地，而非并入 v1 基线。理由：存量 v1 库经 `migrate()` 按序执行 002 即自动前滚（不依赖 db.rs「未正式发布可改基线」注释假设）；新库 001→002 顺序执行，产物与并入基线完全同构；`001_v1.sql` 自 002 起冻结（`src-tauri/src/db.rs` MIGRATIONS 口径）。纯 dsh 冷启动（D15）时插件建库迁至 minSchema + 写默认种子。

### 5. 迟到落库消费侧守卫（A22）

现行 `apply_suggestion_conn` / pk 写回是无守卫覆盖写，迟到落库（判定发起方以延迟回看兜底迟到孤儿）会污染新判定。封闭方式：落态 UPDATE 一律携带 claim 守卫 `AND ai_status='judging' AND judge_claimed_at=<本 claim 时间戳>`，affected=0 即 claim 已被回收/重归属 → 结果丢弃并记审计；followUp 幂等键 = (message_id, 本 claim 令牌)。TS 侧全量生效；pk suggest 子进程路径不改命令面（D9 维持）→ 由**判定发起方回读侧代守卫**（消费前校验 claim 归属，失配按重判处理）；主应用判定路径同样先 claim + 消费侧守卫（配套演进 `src-tauri/src/commands/radio/judge.rs`）。

## 后果

- 主应用配套演进九条目随插件同窗口期发布（`specs/dsh-plugin/architecture.md` §7.1）：claim 协议、分诊 WHERE 守卫、槽表化 `inflight()`、派发迁移 CAS、db.rs busy_timeout、变更侦听广播等——单形态下新守卫恒真/无观测差异，行为变化（条目 7 能力新增、条目 9 缺陷修复）已显式声明（A11）。
- 契约漂移即 CI 红：TS 回放与 Rust oracle 吃同一份 checked-in fixtures（`contracts/`），任一单边演进不重生成即红（ADR 详见 `contracts/PROTOCOL.md` §5）。
- pk CLI 与 `src-tauri/skills/` 零改动（D9）。
