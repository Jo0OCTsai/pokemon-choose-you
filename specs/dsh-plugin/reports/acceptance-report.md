# 用户场景验收报告 — dsh-plugin（dsh 插件形态）

> 日期：2026-10-12 · 分支 `feat/dsh-plugin` · HEAD `777bde2`。
> 验收形态：**分层替身**（AD §7.3 / A10——真实 dsh 宿主 E2E 为手动验收项，本环境无 dsh 宿主，见 §4 手动清单）。
> 机器证据：`raw/junit-*.xml`（1364 用例 0 失败）、`raw/playwright-report/`（主应用 82/82）。
> 结论：✅ **可交付（分层替身口径）**——SDD P0 场景全部有自动化证据；真实宿主冒烟为交付后手动项。

## 1. SDD 核心用户故事 → 证据映射

| 用户故事（SDD） | 验收证据（自动化） | 状态 |
|---|---|---|
| FR-X1 单库不分叉/并发不损坏 | 契约 `concurrency` 场景（双连接 60 步混合读写）：active≤1、审计守恒、无重复建议/跟进、槽互斥（invariants 断言，Rust+TS 双侧）；水位 CAS 双连接交错测试 | ✅ |
| FR-X1 双形态轮询不重复判定 | 判定 claim 协议（契约 judge_protocol 组 9 场景 + pk 面消费侧守卫回归）；分诊结果幂等 CAS（SUGGESTION_ALREADY_RESOLVED，两形态几乎同时处置至多一成功） | ✅ |
| FR-X1 同一任务至多一个活动派发 | claim_dispatch CAS + 槽表 PK（dispatch_sm 场景「claim 原子抢占/双抢失败」+ TS 同款回放） | ✅ |
| FR-X1 纯 dsh 冷启动 | `migrate_cold_start` 契约场景（空库→种子逐字段锁定）+ storage 测试；主应用侧 FUTURE 拒启语义有既有回归 | ✅ |
| FR-X2 schema 超窗拒绝 | TS `migrate.spec`：user_version>2 → DB_SCHEMA_TOO_NEW 只读模式 + 写命令前置拦截；主应用 FutureVersion 回归 | ✅ |
| FR-X3 双实现单契约 | **43/43 夹具 TS 回放全绿**（Rust oracle 生成锁定，`UPDATE_FIXTURES=1` 字节幂等） | ✅ |
| FR-X4 主应用与 pk 不受影响 | pk 27 用例全命令面 + 主应用 385 用例 + Playwright 82/82（chromium/firefox） | ✅ |
| FR-R1 确定性定时轮询 | pollLoop（timer 注入）测试：到点触发全链路零 LLM 拉取、失败退避 ×2 上限 ×8、恢复追平不丢不重 | ✅ |
| FR-R3/FR-X6 全链路假名化 | anonymize 契约 5 场景（稳定/懒分配/碰撞/长名/还原/群名不脱敏——D17）；prompt 组装测试断言真名 0 泄漏（NFR-2） | ✅ |
| FR-R4/FR-R5 判定四动作+确认制 | 提交期 6 规则/接受期解析/批内判重（契约 9 场景）；分诊确认制——不点捕捉不建任务（review CAS 测试） | ✅ |
| FR-R6 失败留档可重判 | judge 编排测试：失败落 error 组、retryJudge 重置双守卫、重试 ≤2 超限（A21） | ✅ |
| FR-R8 健康可视自救 | 健康四元组 + 诊断快照 + 「立即拉取」pollNow 命令 + 支持报告密钥 0 泄漏（redact 夹具回放） | ✅ |
| FR-P1 桌宠 helper 生存 | helper 64 用例：透明置顶窗体参数/穿透翻转/置顶看门狗 5s/宿主存亡（stdin end + 心跳 + PID 三保险 10s SLA）/崩溃自拉起（supervisor 测试） | ✅ |
| FR-P2 状态驱动动画 ≤2s | pet stateFeed：写后直推 + A17 变更标记轮询（2s 合取单查询）→ fake helper 收到 task-state（集成链路 ③） | ✅ |
| FR-D1/2/5/7 派发闭环 | 路由级联/无头三态收口/自动派发扫描（不重派、上限、撤销排队）/SSH 免密预检（fake）/注入定界（FR-D8 契约 injection 场景：「忽略以上所有指令」不改 prompt 结构） | ✅ |
| FR-S5 诊断完整面 | diagnosticsSnapshot/supportReport/logQuery（出口三层脱敏、2000 环、最新在上） | ✅ |
| FR-S7 配置 100% 对齐（D20） | 36 键集逐字断言（单源提取主应用 SETTING_KEYS）；agent 列表/提示词覆盖 CRUD + 修订检测（SETTING_MODIFIED_ELSEWHERE + force）；背包八分区 UI 保存制测试 | ✅ |
| FR-X5 注意力友好 | NFR-6 默认值断言：打断类默认全关（读主应用 SETTING_DEFAULTS 单源）、面板 CSS 零闪烁扫描、计数静态、chip 无进行中不渲染 | ✅ |
| FR-X8 三语即时切换 | i18n 三语键集完全相等断言（dsh.* 78 键 ×3 + 主应用字典借用键传递断言）；语言切换即时跟随+保存落库组件测试 | ✅ |

（FR-T4 跨形态打断番茄收尾：D16 focus-settle 整分钟入账 + 幂等账本已测；端到端「另一形态打断」时序由 A17 侦听+focus-settle 组合保证，真实双形态联测归 A10 手动清单。）

## 2. UIUX §9 Gherkin 抽样对照

- 「被动信号——新建议只产生计数与桌宠静态提示」：SegmentNav 计数静态断言 + helper ▼ 闪 3 次转静态（bubbleTiming 测试）✅
- 「打断可拒——番茄结束出口成对」：PomoPill ▶/✔ 成对 + 绝不自动续轮（pomodoro/focusSettle 测试 + NFR-6 断言）✅
- 「逾期折叠不羞耻」「幂等冲突中性反馈」「放生两层确认与撤销」「短休息 chip 呈现」「分区选单切换/保存制/未保存离开确认」「三语切换」「减弱动效」——client UI 111 用例逐条覆盖（plugin-page/tasks/drawer/settings/settings-sections/chip/a11y/defaults spec）✅
- 「收音机键盘流 J/K…」：**部分**——Esc 收起与提示文案已交付，J/K 焦点移动未接线（记 debt.md）⚠️

## 3. 双形态同库互见演示（集成证据）

`integration.spec.ts` 链路 ⑤：dsh 侧 `configWrite` 写共享库 → 同库读回值一致；主应用侧反向由 Playwright 回归（同库读写）+ 变更侦听（条目 7：外部写入 ≤2s 触发 events 广播→前端既有监听链刷新）承载——FR-T5「≤10 秒可见」上界 = 侦听间隔 2s ≪ 10s。

## 4. A10 真实宿主手动验收清单（2026-10-21 执行）

> 执行环境：本机 dsh 0.2.1-rc.2 web 宿主（`dsh --profile pky-test --no-open --port 14330`，隔离
> `CHOOSE_YOU_HOME=/tmp/pky-e2e-20261021`，插件 0.1.2 构建产物新包名 `pokemon-choose-you-dsh` 重装）+
> 真实 Electron 运行时（`~/.dsh/electron/dist`，`ELECTRON_RUN_AS_NODE` 探针——A3 实测的
> desktop 宿主子进程同一运行体）。宿主侧命令经 web 面板同款 `/api/pky/call` 传输面驱动（浏览器
> 页内 fetch，认证随会话 cookie）。证据截图 `screenshots/e2e-20261021-readonly-banner.png`。
> 首轮真机冒烟（2026-10-17，full-parity 批次）另见 `specs/dsh-plugin-full-parity/reports/acceptance-report.md`。

| # | 条目 | 结果 | 证据 |
|---|---|---|---|
| 1 | 本地路径安装 → 面板渲染 | ✅（本轮复验） | 冷启动零报错（`[pokemon-choose-you] 待办库：…`）；侧边栏 Pokédex 入口 → 主面板七分段渲染（DOM 断言 segment-nav + 冒险/路线/草丛/图鉴/收音机/日志/背包）；首轮 2026-10-17 §1.1 |
| 2 | 会话工具建任务（LLM 驱动） | ⏸ 人工 | 需真实 LLM 会话消耗账号额度，无人值守未跑；工具注册面经 `registerTodoTools` 装配零错（宿主启动日志）+ 22 工具投影单测承载 |
| 3 | 双形态同库互见 ≤10s | ⏸ 人工 | 需主应用与 dsh 同开同窗操作（GUI）；域面 = integration.spec 链路 ⑤ + stateFeed 2s 变更侦测 |
| 4 | 双桌宠并存 + 双击开插件页 | ◐ 推送链已验、双击触发人工 | helper 真机拉起 ✅（petStatus.running=true、hello 八能力位、0.1.0）；**pageOpen host→client 推送链真机闭环（2026-10-21 新接）**：host `@Remote({mode:"stream"})` 流端点 `pky/pageOpenEvents` 经 gateway SRC 解析 → `/api/remote.mux` WebSocket mux 下行 ready 帧到浏览器（页内手工开流探针实测）；client 消费面（$stream 订阅 → emitPageOpen → selectPanel 导航 + 分段锚点）由单测锁定；「双击桌宠」触发本身是 GUI 手动项 |
| 5 | 真实 lark-cli 授权链 | ⏸ 人工 | 授权属本机隐私交互（首轮 1.3 同口径）；轮询/判定/分诊域面由契约夹具锁定 |
| 6 | 无头派发真实 agent + 交互注入终端 | ✅（此前批次） | 外部终端真窗口链 2026-10-18/21 真机已验（debt ③ 主体收口记录）；无头派发 + `todo_dispatch_done` 域面单测 |
| 7 | user_version 推到 3 → 只读横幅 | ✅（本轮全链） | 隔离库 `PRAGMA user_version=3` → dbStatus `mode:"readonly"` → 面板只读横幅真机渲染（「待办库版本较新，需升级插件后才能写入…只读模式」）；**顺带暴露并修复 dbStatus mode 值漂移**（host `ok/readonly` vs client 契约 `rw/ro`——只读态在 dsh 形态原永不点亮，本轮收编对齐） |
| 8 | dsh 宿主 Node `node:sqlite` 实测 | ✅（本轮） | **web 宿主**（系统 Node v24.21.0）：库创建/迁移/WAL 运行即证；**Electron 内嵌 Node**（44.7.0 内嵌 Node 24.21.0、SQLite 3.53.4、无实验告警）：契约 schema 17 表建齐、`chat_messages.judge_claimed_at` 在位、user_version 事务写读通过——A1 回落链（better-sqlite3）无需启用，见 compatibility.md A4 |

**附带产出（本轮执行驱动）**：① diagnosticsSnapshot 增 `capabilities` 段（dsh 平台表面八键真机探测出口——compatibility.md 矩阵「探测键」列数据面，此前文档声称而代码未供）；② 真机八键实测结论与矩阵行更新（见 compatibility.md A4）；③ pky-test profile 完成新包名重装（debt「包正名后本机 profile 重装」该 profile 已销账）。

**遗留人工项**：条目 2/3/4 双击触发/5 —— 均为 GUI 交互或账号消耗性质，域面已有自动化证据承载（见各行），不再开新 debt。

## 5. 已知遗留（详见 docs/debt.md）

- dsh 适配层真实装配（slots/timer/subagent/SSH/终端的宿主桥——接口已全部留位并通过伪 ctx 集成测试）；
- J/K 键盘流焦点移动；迟到判定 30s 回看（事件面）；pregen `--session-id`（CLI 适配器用 stdout 信封）；pk 不携带 claim 令牌（D9 口径维持，消费侧代守卫已落地）；
- 分发形态（npm 公开与否待裁决 A9）；本机 WebKit E2E 段错误（环境债务，CI Linux 裁决）。
