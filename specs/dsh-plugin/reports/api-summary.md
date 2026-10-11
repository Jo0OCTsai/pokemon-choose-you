# 接口测试总结 — dsh-plugin（dsh 插件形态）

> 原始数据：`raw/junit-src-tauri.xml`（cargo +nightly test → cargo2junit，412 用例）、
> `raw/junit-frontend.xml`（vitest junit，293 用例）、`raw/junit-dsh-plugin.xml`（595 用例）、
> `raw/junit-dsh-helper.xml`（64 用例）——机器产出，勿手改。
> 服务 commit：HEAD `777bde2`（feat/dsh-plugin）。
> 结论：✅ 可交付（四套 runner 合计 **1364 用例、0 失败**）

本特性「接口」三层（契约 = `contracts/PROTOCOL.md` 单源）：
①**判定/并发协议契约**（FR-X3 双实现单契约）——`contracts/scenarios/` 43 场景由 Rust（主应用，
oracle）执行生成夹具、TS（dsh-plugin）回放逐字段比对，双侧完备性断言（场景数==文件数）；
②**dsh tools 面**（20 行/22 个 `todo_*` 工具，AD §4.1）与 **host 命令面**（49+1 RPC，AD §4.1.1）
——注册表完整性 + 逐工具/逐命令 happy path 落库断言；
③**主应用与 pk 面**（FR-X4 不受影响）——pk 全命令面回归 + 主应用 409 用例 + E2E（见 e2e-summary）。

## 1. 结果总览

| 服务（stack.json name） | runner | 用例 | 失败 | junit |
|---|---|---|---|---|
| `src-tauri` | `cargo test`（nightly json → cargo2junit） | **412** | **0** | `raw/junit-src-tauri.xml` |
| `pokemon-choose-you`（前端） | `vitest run --reporter=junit` | **293** | **0** | `raw/junit-frontend.xml` |
| `dsh-plugin`（新服务） | `vitest run --reporter=junit` | **595** | **0** | `raw/junit-dsh-plugin.xml` |
| `dsh-plugin/helper`（Electron 子包） | `vitest run --reporter=junit` | **64** | **0** | `raw/junit-dsh-helper.xml` |

覆盖率（dsh-plugin business core 口径 `src/host/**`，门禁四维 ≥85）：**stmts 94.15 / branches 86.00 / funcs 93.28 / lines 94.43**；Rust 侧 85 门禁与前端 65 门禁均由各自 runner 维持（质量棘轮锁定地板，只紧不松）。

## 2. 契约一致性（FR-X3 核心验收）

- **43/43 场景 TS 回放全绿**（`__tests__/contracts-replay.spec.ts`，45 用例 = 43 场景 + M3a 正/反向完备性）：
  task_sm 8 / dispatch_sm 7 / judge_protocol 9 / anonymize 5 / concurrency 1（invariants 断言形态）/ vocabulary 4 / config_align 4 / redact 2 / injection 2 / cold_start 1。
- **Rust oracle 侧**：`contracts::{contracts_scenarios_execute_and_match_fixtures, contracts_fixtures_have_no_orphans, contracts_schema_single_source}` 3 测试绿；`UPDATE_FIXTURES=1` 重生成字节幂等（两步动作纪律）。
- **schema 同源**：Rust `include_str!` 与磁盘字节相等断言 + 裸 SQL 执行后 `user_version=2`/`dispatch_slots`/`judge_claimed_at` 在位；TS 侧 migrate.spec 同口径断言。
- 回放收敛过程中以夹具为准修复 TS 域层 7 处偏差（per-site 时间戳、单调微秒、槽时戳、别名碰撞探测异常路径、种子标记位、判重文案、p2p follow 拦截口径）——全部 FR-X3「以 oracle 为准」纪律内，无断言弱化。

## 3. dsh-plugin 用例构成（junit classname 检索）

- **storage（34）**：路径解析/PRAGMA/guarded 迁移封顶 minSchema=2/DB_SCHEMA_TOO_NEW 只读拒绝/冷启动种子幂等（5 分类+4 维度逐字段对齐 db.rs）/错误码 15 枚举。
- **domain（134）**：任务六态机+顶下 demote+撤销分流+放生级联墓碑；派发五态 CAS+槽表生命周期+queue_due；分诊 CAS（SUGGESTION_ALREADY_RESOLVED）；提交期 6 规则整批原子+接受期解析；假名化（懒分配/碰撞/长名优先/还原/群名不脱敏）；36 设置键集逐字断言（单源提取主应用 SETTING_KEYS）；提示词覆盖三态/20000 上限/占位符；agent 列表修订检测（SETTING_MODIFIED_ELSEWHERE+force）；词表 CRUD 不变式；注入定界（伪造定界洗裁）；D16 整分钟入账+幂等账本。
- **radio/judge/health（107）**：水位 CAS 双连接交错、退避 ×2 上限 ×8、lark-cli 子进程（fake 脚本三态：正常/未授权/失败）、会话过滤三态+免打扰降级、判定编排（claim→校验→落库→还原→健康）、A21 重试 ≤2 超限落 error、快捕 5 秒撤销、三层脱敏（**直接回放 redact 夹具逐行比对 + 密钥 0 泄漏**）、日志环 2000/logQuery 出口脱敏、支持报告。
- **dispatch/pet（108）**：路由解析级联、无头三态（成功/失败/超时 kill）槽全生命周期、自动派发扫描（到期入队/上限/不重派/agent 不可用撤销）、交互派发回传收口（todo_dispatch_done/fail 语义、不解析终端输出）、SSH BatchMode 预检 fake、pet 桥（fake helper 子进程真 stdio：hello/task-state/cmd 九 op/focus-settle 幂等/崩溃 10s 自拉起）。
- **tools/commands/装配/回放/兼容（78）**：22 工具名全集+逐工具落库断言（origin='dsh:tools'）、50 host 命令信封、createPlugin 伪 ctx 集成 6 链路（迁移种子→快捕判定分诊→出发→桌宠 task-state→自动派发回传→配置双形态读回）、43 夹具回放、兼容矩阵双向断言（CAPABILITY_KEYS ↔ compatibility.md）。
- **client UI（111，@testing-library/react）**：七段面板/背包八分区保存制/分诊卡/chip 四态/a11y 四条断言（role=status/focus trap/非颜色冗余/32px 命中区）/NFR-6 默认值断言（打断类默认全关、面板零闪烁 CSS 扫描）/i18n 三语键集相等（dsh.* 78 键 ×3）。

## 4. 主应用与 pk（FR-X4）

- `bin/pk/tests.rs` 27 用例全绿（全命令面经 run 分发器全链路）。
- 主应用 lib 385 用例全绿，其中配套演进新增回归：判定 claim 协议（claim 子集/超时回收/消费侧守卫/迟到落库回置）、分诊 CAS（已处置幂等反馈）、dispatch 迁移 CAS 化（并发失配幂等收口）、槽表并发/过期回收、busy_timeout=5000、外部变更侦听（2s 合取查询→events 广播、自家广播吸收）。
- 主应用界面零改动口径：唯一前端 diff = i18n 三语各 +1 键（`im.status.judging` 与 pending 同文案，判定中状态可见性）。
