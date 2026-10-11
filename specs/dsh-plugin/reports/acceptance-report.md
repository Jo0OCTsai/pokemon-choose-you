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

## 4. A10 真实宿主手动验收清单（交付后执行；本环境无 dsh 宿主）

1. dsh 0.2.0-rc.2 本地路径安装本插件 → Plugins 页 detail page 七段面板渲染；Config schema live 表单出现。
2. 会话说「记个待办：明天下午 5 点交周报」→ 模型经 `todo_context`+`todo_task_create` 建任务（路线段可见）；5 秒「撤销刚才那条」删除。
3. 主应用与 dsh 同时开：任一形态完成任务，另一形态 ≤10s 刷新（变更侦听链）。
4. 双桌宠并存：各自隐藏恢复、双击 dsh 桌宠开插件页面（pageOpen 经宿主导航）。
5. 收音机：真实 lark-cli 授权 → 轮询拉取 → 判定建议卡 → 分诊建任务；双形态轮询同开不重复（claim 协议）。
6. 无头派发真实 agent（worktree 开/关两态）+ 交互派发注入终端面板 + `todo_dispatch_done` 回传。
7. 库版本窗口：手工把 user_version 推到 3 → 插件只读横幅（DB_SCHEMA_TOO_NEW）+ 主应用 FutureVersion 拒启（预期行为）。
8. dsh 宿主 Node 运行时 `node:sqlite` 实测（A1 宿主侧——Electron 内嵌 Node 版本确认；不可用走 better-sqlite3 回落链，见 compatibility.md）。

## 5. 已知遗留（详见 docs/debt.md）

- dsh 适配层真实装配（slots/timer/subagent/SSH/终端的宿主桥——接口已全部留位并通过伪 ctx 集成测试）；
- J/K 键盘流焦点移动；迟到判定 30s 回看（事件面）；pregen `--session-id`（CLI 适配器用 stdout 信封）；pk 不携带 claim 令牌（D9 口径维持，消费侧代守卫已落地）；
- 分发形态（npm 公开与否待裁决 A9）；本机 WebKit E2E 段错误（环境债务，CI Linux 裁决）。
