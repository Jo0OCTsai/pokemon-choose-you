# dsh 插件形态（第二形态）· 实施计划

> L 级任务，已过「需求+设计+架构通过」关卡（2026-10-11，含 7 轮回流裁决）。本计划自包含编排：任务分解/顺序/依赖/TDD 分诊/文件映射/验收；规格细节以下列文档为事实源，冲突时以 SDD/AD 为准、再以主应用代码为准（FR-X3 铁律：契约逆向自主应用现行行为）。
>
> **必读输入**（新会话第一步）：
> - 规格：`specs/dsh-plugin/requirements.md`（FR-T/R/P/D/S/X 六组 50+ Gherkin、D1–D20 决策、NFR 9 组）
> - 架构：`specs/dsh-plugin/architecture.md`（§3 结构/§4 契约 50 命令+15 错误码/§5 数据与并发/§7 变更影响；A1–A24 决策）
> - UIUX：`specs/dsh-plugin/uiux-design.md`（含 U1–U21、契约需求面、`uiux-prototype.html`）

## 0. 决策快照（不可推翻，实施中直接引用）

- **形态**：dsh 0.2.0-rc.2 Cordis 插件（host 半边 Node + `dsh.client` React 同包）；主应用正常演进、双轨长期
- **UI 载体**：Plugins 页 → 本插件 detail page（`plugins.detail.section`）；SegmentNav 七段（冒险/草丛/路线/图鉴/收音机/日志/背包）；背包内八分区选单+分区整页+保存制（U16–U21）；桌宠 = sidecar Electron helper 局部小窗
- **数据**：同一 SQLite 直连（WAL+busy_timeout+短事务），零同步层；迁移 SQL 单源 `contracts/schema/` 双执行方 guarded（插件迁移封顶 minSchema，A19）；36 设置键+实体配置同库互通
- **并发**：消息级幂等（判定 claim/分诊 CAS/派发 CAS/`dispatch_slots` 槽表/出发 demote 单事务，A5）
- **契约**：`contracts/` fixtures 由 Rust（oracle）生成锁定、TS vitest 回放、CI 双红（A18 别名参数化）；错误码 15 枚举单源 = UIUX 契约需求面
- **轮询**：宿主半边 cordis-plugin-timer + 自管水位，零 LLM 拉取（D14 分支 A）
- **假名化**：人名替换/群名不脱敏（D17，代码逆向）
- **实施期待确认项**（早期验证任务，非阻塞）：A1 node:sqlite 在 dsh 宿主/Electron 实测（回落 better-sqlite3+electron-rebuild）；A3 schema 并入 v1 基线（主应用未正式发布可改基线）；A8 兼容清单字段名；A10 真实宿主 E2E 手动验收

## 1. 仓库布局与文件映射（AD §3.0）

```
pokemon-choose-you/
├── contracts/                      # 单一契约源（新）
│   ├── schema/001_v1.sql           # SCHEMA_V1 外置（主应用 include_str!）
│   ├── PROTOCOL.md                 # 判定协议 JSON Schema、15 错误码、脱敏规则
│   ├── scenarios/                  # 契约 fixtures 场景（Rust 生成 checked-in）
│   └── host-commands.md            # 50 host 命令 + pageOpen（AD §4.1.1 的可执行版）
├── dsh-plugin/                     # 插件包（新，pnpm workspace）
│   ├── package.json                # dsh.client 声明 + Config schema（A2 双轨）
│   ├── src/host/                   # 宿主半边（package-by-feature，AD §3.1）
│   │   ├── domain/                 # 纯逻辑核心（TDD 重灾区）
│   │   ├── storage/                # node:sqlite 直连 + guarded 迁移 + CAS 原语
│   │   ├── radio/                  # 轮询/水位/退避 + lark-cli 调用
│   │   ├── judge/                  # 判定编排（subagent/外部 CLI）+ prompt 组装
│   │   ├── anonymize/              # 假名化（fixtures 对齐）
│   │   ├── dispatch/               # subagent/worktrees/SSH 编排 + 槽管理
│   │   ├── health/                 # 诊断快照/支持报告/日志环形
│   │   ├── pet/                    # helper 拉起/监督/桥
│   │   └── index.ts                # apply：能力探测（NFR-3）+ 惰性注册
│   ├── src/client/                 # React 客户端半边（AD §3.2 组件树/UIUX §3）
│   └── helper/                     # Electron 子包（dsh-plugin/helper）
│       └── src/main.js 等          # 透明置顶小窗/穿透翻转/看门狗/宿主存亡（dsh-pet 模式，MIT 参考）
├── src-tauri/                      # 主应用配套演进（AD §7.1 九条目）
└── pnpm-workspace.yaml / .devcontainer/stack.json / .github/workflows/ci.yml   # 工程设施
```

## 2. 并行组与顺序

依赖主线：**契约先行 → 域核心 → 两条消费线（UI/helper）+ 两条链路（收音机/派发）→ 集成收尾**。

### 并行组 0 · 契约地基 + 主应用配套演进（Rust 侧，先行，阻塞其余组）

1. `contracts/schema/001_v1.sql` 外置 + `db.rs` include_str!（行为零变化）
2. schema 基线新增 `dispatch_slots` 表 + `chat_messages.judge_claimed_at` 列（A3：按未正式发布改基线）
3. **TDD**：Rust 契约测试模块——fixtures 生成/校验（`UPDATE_FIXTURES=1` 重生成）、场景数==文件数断言、schema 字节同源断言（AD §4.4）
4. 主应用配套：判定 claim 协议（judge.rs）、分诊 WHERE 守卫（review.rs/suggest.rs）、迟到落库 claim 守卫 + followUp 幂等键（A22）、dispatch 迁移 CAS（state.rs）、`inflight()`→槽表（auto.rs）、db.rs 补 busy_timeout、主应用侧 ≤2s 变更标记轮询触发 events 广播——每条**先写回归测试**（回归 TDD：现行行为先钉死再改）
5. pk 全命令面回归全绿（FR-X4 验收口径）

### 并行组 1 · 插件工程骨架 + 域核心（依赖组 0 的 fixtures）

1. workspace/stack.json/CI plugin job/棘轮基线（AD §7.2–7.3）
2. **TDD**（vitest，逐 fixtures 回放 + 单测）：`domain/` 任务状态机（六态+顶下+撤销分流+放生级联）、判定协议校验（提交期/接受期两集，D17 口径）、假名化（懒分配/碰撞/长名优先/还原）、并发原语（claim/分诊 CAS/槽表出发 demote）、导入定界不变式（FR-D8）
3. `storage/`：node:sqlite 连接（**先做 A1 实测**）、guarded 迁移、库版本窗口拒绝（DB_SCHEMA_TOO_NEW）、冷启动种子（D15）
4. 契约回放 CI 红/绿打通（Rust job 与 plugin job 同 commit fixtures）

### 并行组 2 · Electron helper（独立进程，只依赖桥协议契约，可与组 1 并行）

1. **TDD**：桥协议测试（fake host 走真 stdio JSON 行；AD §4.3 消息全集 + pageOpen 链路）
2. 窗体：transparent+alwaysOnTop+skipTaskbar、穿透翻转（forward:true+命中）、setContentBounds 跟随、topmost-watchdog、宿主存亡（管道+PID）、崩溃自拉起（10s）
3. 素材链：内置 6 只 + CDN 候选 + 双缺回退（A20）；Electron 探测/下载/首装离线降级
4. 动画矩阵与台词时序（UIUX §3.4，DESIGN_SYSTEM token）

### 并行组 3 · 客户端半边 UI（依赖组 1 的 host 命令契约，可对契约 mock 先行）

1. 组件测试（RTL+happy-dom，非 TDD 分诊）：PluginDetailPage（七段 SegmentNav+计数/⚠）、五视图分段、背包八分区选单+分区整页+保存制+离开确认（U21）、conversation chip、SchemaBanner、ReleaseGuard、BatchBar
2. i18n 三语字典接入（主应用 src/i18n/*.ts alias 直引，A16）+ 键集相等构建校验
3. 注意力友好默认值断言（NFR-6 键级清单）、a11y 四条（UIUX §6.2）

### 并行组 4 · 收音机链路（依赖组 1）

timer 轮询+水位 CAS+退避×2 上限×8；lark-cli 子进程封装（凭证不进插件）；判定编排（默认无头 subagent，A7；外部 CLI 复用 pk suggest batch）；prompt 组装+假名化；结构化提交强校验；重试 ≤2（A21）；建议/跟进/新标签提议落库；健康四元组。

### 并行组 5 · 派发链路（依赖组 1）

subagent external execution 编排+结果回传落库；worktrees 策略；SSH deployment 引用管理（A13）+免密预检（SSH_AUTH_REQUIRED）；`dispatch_slots` 机器级全局计数；自动派发 60s 扫描+不重派；交互派发（终端面板+注入+agent 经工具回传，D6/M6）；续接双路径（A14）；超时下限 10 分钟（D 口径）；注入定界（FR-D8）。

### 串行收尾 · 集成与验收

1. 分层替身集成测试：伪 ctx 驱动真实 host 模块 + 真实临时 SQLite（AD §7.3 E2E 形态）
2. 全链路冒烟（真实 dsh 宿主，A10 手动清单）
3. 质量门禁全绿：lint-gate（按 stack.json 路由）、覆盖率 ≥85%（business core 口径）、pnpm audit/gitleaks/check:duplicates、质量棘轮收录
4. 三报告：api-contract-test（junit）+ e2e-acceptance（playwright-report + 截图）→ `specs/dsh-plugin/reports/`
5. 文档同步（repo-knowledge 流程）：USER_GUIDE dsh 章节、`dsh-plugin/`+`contracts/` 的 AGENTS.md、ADR 记 D11/D14/迁移协议/D20、debt.md

## 3. TDD 分诊总表

| 类别 | 处置 |
|---|---|
| domain 全部纯逻辑、并发原语、假名化、判定协议校验、契约 fixtures、桥协议 | **TDD**（先红后绿） |
| 主应用配套演进九条目 | **回归 TDD**（现行行为先钉测试再改，单形态下守卫恒真） |
| React 组件、slots 胶水、helper 渲染、i18n | 组件/协议测试（非 TDD） |
| 配置面/文案/样式 | verification-before-completion 兜底 |

## 4. 验收（对照 SDD Gherkin 50+ 场景与 NFR）

- FR-X3 契约双红 CI、FR-X1 五不变式压测场景（不变式断言形态，AD §4.4b）、FR-X4 pk 回归、NFR-2 prompt 脱敏 0 泄漏断言、NFR-6 默认值断言、NFR-7 三语键集、UIUX §9 14+ 条 Gherkin
- 用户场景验收：双形态同库互见/双桌宠并存/背包八分区与主应用等效/远程 SSH 派发回传

## 5. 纪律提醒（实施会话）

- 改动范围铁律：不顺手重构主应用；配套演进仅 §7.1 九条目
- dsh-pet（MIT）helper 参考实现可借鉴结构，不可直接拷贝其代码风格进本仓而不经适配
- 歧义就地决策 + 标注，回流上限已用尽，方向问题停下问用户
