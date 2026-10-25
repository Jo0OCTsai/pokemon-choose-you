# dsh-plugin 独立形态全量补齐 + dsh 原生 SSH 远程派发 · 实施计划 (plan.md)

> **分级 L 级，已过「需求+设计+架构通过」关卡**（用户 2026-10-17 批示「确认后直接编写自包含 plan.md」）。
> 本计划自包含：实施会话只需读本文件 + 三份背景文档，不依赖任何会话讨论记忆。
> 代码基线 = commit `7986072`（命令面实数 69，含新增 petStatus；electron 探测已改 dist 真实二进制——AD §3.4 已注记）。

## 0. 背景文档（实施前必读）

| 文档 | 路径 | 必读章节 |
|---|---|---|
| SDD 需求 | `specs/dsh-plugin-full-parity/requirements.md` | §2 决策 D21–D33（全部行为口径）、§4 用户故事、§5 Gherkin、§7 NFR-10..16 |
| AD 架构 | `specs/dsh-plugin-full-parity/architecture.md` | §2 选型、§3.2 模块挂点表（**文件映射单源**）、§4.1 命令契约表（17 条）、§4.2 错误码、§4.3 桥协议扩展、§4.5 provisioning、§4.6 提醒仲裁、§4.7 远程派发、§9 spike、§12 决策 A25–A37 |
| UIUX | `specs/dsh-plugin-full-parity/uiux-design.md` | §1.2 影响判定、§2 信息架构、§3 组件树、§4 交互状态、§8 文案规格（三语单源）、文首「契约收敛纪要」 |
| 方向 | `specs/dsh-plugin-full-parity/design.md` | 三轴选型背景（冲突时以 SDD/AD 为准） |

**铁律回顾**（全文约束，违反即返工）：业务核心零 dsh 依赖（平台面只准在 `src/host/dsh/`、`pet/`、`dispatch/` 适配缝 + `remote/` 经接口注入）；storage 唯一握连接、写路径 = 单条 `BEGIN IMMEDIATE` + CAS、**事务内禁止子进程/SSH 调用**；迁移 SQL 只追加；错误码 15 枚举单源在 `contracts/PROTOCOL.md` §2（追加 6 枚）；i18n 三语键集相等断言；源码零 TODO 字面量（待办写各模块 README）；测试用真实临时 SQLite + fake 脚本替身；覆盖率 `src/host/**` 四维 85（`src/host/dsh/**` exclude 既有口径）。

## 1. 总体执行序

```
串行组 0（spike，阻塞远程派发全链路）
    ↓ 通过
并行组 1（桌面配套 P1–P4 ‖ 纯逻辑核心 TDD）   ←—— 与组 0 同时可开（不依赖 spike）
并行组 2（适配层与装配）
并行组 3（客户端 UI）                          ←—— 依赖 2.9 契约定型（可按 AD §4.1 契约 + mockHost 提前并行）
并行组 4（分发物与横切收尾）
    ↓
集成验证（报告 + 质量门禁 + 手动验收项）
```

编排纪律：同组内任务真正独立时同消息派 subagent 并行；每任务按 TDD 分诊（核心逻辑/边界 → 先写测试；胶水/配置 → 客观验证兜底）；主观 code review 用隔离 subagent，客观验证主会话自查。

## 2. 串行组 0 · spike（D23 · 首个实施任务）

### 任务 0.1 spike-dsh-ssh（可复现探针，非产品代码）

- **做什么**：按 AD §9 全表执行——验证点① 多实例 isolate 装配（两 label 作用域各装 dsh-ssh 家族、独立连接、单侧 dispose 不影响另一侧、无宿主级副作用、同 scope 并发两路 spawn）；验证点② terminal backend 作用域隔离（两作用域 spawnTerminal 真 PTY 面板路由无冲突）；验证点③ 构建产物经 `file:` 安装进**干净 dsh profile** 后 `dist/host.js` 内 `import("@deepseek-ai/dsh-ssh")` 实际解析锚点（插件包 node_modules vs 全局 dsh 安装——AD 最重载假设）+ uiohook-napi prebuild 对 Electron ABI 可达。
- **产出**：`specs/dsh-plugin-full-parity/spike-dsh-ssh.md`（可重跑脚本 + 日志证据 + 结论）。
- **判据**：AD §9「判据（通过）」行。
- **失败切换**：①/② 失败 → 主路径切方案 2b，**停止组 2 的 2.1/2.8**，回流 design.md 轴 2（D23 已授权）；③ 失败 → 构建面修复（external 解析锚定收口），不切 2b。
- **新建测试 profile 冒烟**（勿动 web/desktop profile 既有安装）。

### 任务 0.2 依赖钉版（spike 附属，可与 0.1 同批）

- `dsh-plugin/package.json` `dependencies` 增：`@deepseek-ai/dsh-ssh@0.1.6-alpha.1`、`@deepseek-ai/dsh-subprocess-ssh@0.1.6-alpha.1`、`@electron/get`（当前稳定）、`uiohook-napi`（锁定具体版本号——AD §2 M9）；构建 external 口径不变（`@deepseek-ai/*`）。
- 验证：`pnpm install` 后 `pnpm --filter dsh-plugin lint` 全绿（tsc --noEmit 不因新依赖红）。

## 并行组 1 · 桌面配套演进 ‖ 纯逻辑核心（全部 TDD 或契约夹具）

> 组内任务互相独立，可同消息并行派发。桌面侧（1.1–1.4）与插件侧（1.5–1.10）零交叉。

### 任务 1.1 桌面 P1：scheduler 纯函数抽取（Rust）

- `src-tauri/src/scheduler.rs` 聚合/勿扰/文案决策抽纯函数（**只抽取不改行为**），供 oracle 生成 `reminder` 组 fixtures；走 `contracts/AGENTS.md` 夹具重生成流程。
- TDD：既有 scheduler 测试不动绿 + 新纯函数单测。

### 任务 1.2 桌面 P2：提醒落库 CAS 守卫（Rust）

- `UPDATE tasks SET reminded=1 WHERE id=? AND reminded=0` + `fresh_start_last_run`/`review_last_notified` 当日去重键改条件更新（AD §7.1 P2）。
- TDD：先写双发竞态回归测试（两线程模拟）再改。

### 任务 1.3 桌面 P3：streak oracle 抽取（Rust）

- `src-tauri/src/commands/pet.rs` streak_conn 抽可测纯入口（或以现测试面直供 oracle）→ fixtures `streak` 场景组（宽容日/今日未完成不算断/同日多捕计一/400 天回溯边界）。

### 任务 1.4 桌面 P4：backup 落键条件更新（Rust）

- `src-tauri/src/backup.rs` run_daily_backup 落键改「备份成功后 `UPDATE … WHERE value<>今日`」（AD §7.1 P4，与 P2 同 PR 窗口）。

### 任务 1.5 domain/streak.ts（TS · TDD）

- 文件：`dsh-plugin/src/host/domain/streak.ts`；算法 = SDD FR-B3（本地自然日去重、宽容日 1、今日未完成不算断、上限 400 天、输出 `{days, todayCount}`）。
- TDD：契约回放 `streak` 场景组（fixtures 由 1.3 oracle 生成——**依赖 1.3 先出夹具**；若时序倒置，先写 TS 侧单测、夹具到位后接契约回放）。

### 任务 1.6 reminder/ 纯函数 + CAS 原语（TS · TDD）

- 文件：`src/host/reminder/{query,aggregate,daily-keys}.ts`（loop/deliver 装配归组 2.7）。
- 行为基准 = 桌面 scheduler 语义（SDD FR-A3 全 Gherkin + 语义抽取报告）：到期判定（提前量 0/5/15/30、四态状态集、时间精判混排解析）、聚合（前 3 + 等 N 项、任一紧急整体 ‼）、勿扰（跨零点、start==end 关、解析失败 fail-open、urgent/high 例外）、`reminded` CAS 原语 + 当日去重键 CAS（BEGIN IMMEDIATE 内，AD §4.6）。
- TDD：契约回放 `reminder` 组（依赖 1.1 夹具）+ 单测（勿扰边界全枚举、CAS affected=0 让位）。

### 任务 1.7 domain/backup.ts 扩展：导入/恢复/backupLoop（TS · TDD）

- 导入校验（app/format/必需表、100MB 上限、解析深度限、列名白名单）、前置自动备份 → 整体替换（秘钥/提示词覆盖行不随导入覆盖）、恢复（文件名白名单拒 `/\`、超窗拒、恢复后补跑迁移 + 补种 + 补写当日 last_backup_date）、backupLoop 逻辑（跨天判定 + 备份成功后条件写键 + prune + 空库跳过——AD §3.2/A36 时序）。
- TDD：真实临时库全流程测试（含「备份失败当日可重试」「写键失败下轮自愈」两个关键时序用例）。

### 任务 1.8 remote/ 部署域纯逻辑（TS · TDD · fake SshScope）

- 先定接口：`src/host/remote/sshScope.ts` 导出 `SshScope`（spawn / spawnTerminal / shell / writeFile / disconnect / connected——AD §3.2）。
- `deployments.ts`（CRUD + id 唯一键/alias 唯一索引 + confirmAliasRefs 级联 + 路由失配明示本机确认）、`provision.ts`（四步幂等状态机 + $HOME 探测展开 + 路径不变式拒 `~`）、`recheck.ts`（周期/即时复核）、`lateReport.ts`（mtime 痕迹 → 只增行留痕）。
- TDD：内存 fake SshScope（spawn 记录/可编程结果/断开事件）上全模块单测；引号全量引用静态断言（NFR-11④——组装路径逐命令检查）。

### 任务 1.9 dispatch/sessions.ts 扩展 + taskCreate（TS · TDD）

- `sessionsPage`（分组映射 all/radio/dispatch/other、limit 钳 1–100 默认 20、id 倒序、counts 不随翻页变）+ `sessionReplay` 路由（remote_host 空 = 本机三分支；非空 = 部署唤起；快照压过配置——唤起执行体注入）。
- `taskCreate` domain（字段校验/默认分类/状态推导/标签全量替换/审计）。
- TDD：单测 + 契约对齐桌面行为（分页/回放路由）。

## 并行组 2 · 适配层与装配（依赖：0.1 spike 通过；1.5–1.9 接口在位）

### 任务 2.1 dsh/sshScope.ts 实现

- 唯一 dsh-ssh 触碰点：per-deployment isolate 创建 + 动态 import 家族 + `ctx.plugin()` 装载 + 连接生命周期 + 断开回调；实现 1.8 定义的 `SshScope` 接口（签名按 spike 实测可调，接口不回流 AD）。
- 验证：不进覆盖率门禁（`src/host/dsh/**` exclude）；真机验证归 0.1/4.5 profile 冒烟。

### 任务 2.2 dsh/probeDsh.ts + compatibility 同步

- capability 键实装（AD §4.8 表：dsh-ssh 动态 import 形状探测、dsh-terminal ctx 表面、其余占位转实装）；结果进 diagnosticsSnapshot `capabilities` 段。
- 同步 `docs/compatibility.md` 矩阵（探测方式列实装化 + dsh-ssh 0.1.6-alpha.1 版本）——`compat.spec.ts` 双向断言保持绿。

### 任务 2.3 桥协议扩展（单源同步三处）

- `helper/src/bridge/protocol.ts`（类型 + 校验器）+ host 侧消费 + `helper/README.md` §桥协议表——AD §4.3 全表：`sys-config`/`sys-notify`/`tts-speak`/`dialog-request→ack→result`/`dialog-cancel`/`open-path`/`mac-auth-query→ack→result`/`chat-reply` 下行 + `tray-action`/`shortcut-fired`/`notify-clicked`/`input-activity`/`sys-unsupported`/`cmd.pet-chat` 上行 + `hello.caps` 8 能力位 + **hello 发送门控**（未收到 hello 禁发 sys 消息）。
- TDD（桥契约测试 = 核心逻辑）：双版本兼容矩阵（旧协议样本回放：未知消息丢弃计错不崩、能力位缺位不发、seq ack 超时降级、result 长超时 + cancel）。

### 任务 2.4 helper sys/ 模块族

- `helper/src/sys/{tray,shortcuts,notify,tts,dialogs,openPath,inputCount}.ts`——Electron 稳定 API；`HELPER_HEADLESS=1` = no-op 记录器（可编程结果）；`inputCount.ts` = uiohook dynamic import + 授权检测 + 撤销即停 + **只计数红线**（rawcode/keycode 不读取——eslint `no-restricted-*` 规则锁属性访问，进 CI）；文本渲染红线（textContent 禁 innerHTML）。
- 验证：headless 模式单测 + 真机冒烟归 4.5。

### 任务 2.5 helper 桌宠行为移植

- `helper/src/state/` + `renderer/` 扩展：坐栖（≤72 逻辑像素）、时刻台词（生日>深夜>周五晚>整点 + 每日/每小时去重）、连胜/里程碑演出（可跳过 + reducedMotion 即时结算）、陪跑（默认关）、打盹/时段问候、AI 聊聊 ChatBox（≤4 行、经桥 pet-chat/chat-reply、历史内存 3 条）。
- 移植源 = 桌面 `src/PetApp.vue` composables（usePerch/useTimeLines/useCatchScene/usePetChat 等）语义，**非拷贝**——helper 是独立渲染层，文案键复用主应用 `pet.*`（UIUX §8 声明）。
- 分诊：演出时序/去重逻辑 TDD（纯函数抽出测），渲染胶水客观验证。

### 任务 2.6 host pet/ 桥消费 + electronGet

- 桥新消息 host 侧消费（tray-action→pageOpen/pet 显隐/quit、shortcut-fired、dialog 双段、mac-auth、input-activity）；`macAuthorizationStatus` 查询；郑重时刻判定（完成动作路径内取 streak → tts-speak 仅本形态——A30）。
- `pet/electronGet.ts`：@electron/get 严格校验薄封装（校验值 = 构建期内嵌 sha512 常量、镜像只换 URL、原子落位 `~/.dsh/electron/dist/`——探测链直接命中，AD §3.4）。
- TDD：electronGet 单测（URL 组装/校验失败拒绝/落位路径），桥消费经 fake host。

### 任务 2.7 reminder loop + backupLoop 装配

- `reminder/{loop,deliver}.ts`：20s tick（timer 注入）→ 查询 → CAS → 聚合 → helper sys-notify / toast 降级 + 分段计数 + `dsh:last_seen_reminder_at` 补看面；backupLoop 30min 惶。
- 装配点：`assembly.ts`/`petSection.ts` 注入（能力探测失败不装配不报错——A20 语义扩展）。
- TDD：fake timer 推进测试（到期→送达→去重→勿扰→降级全链）。

### 任务 2.8 dispatch 远端接线

- `HeadlessDeps.executorFor` 路由 local/sshExecutor；交互 TerminalAdapter 远端分支（spawnTerminal + 注入 + 同上下文重派/关闭兜底）；ShellRunner 远端实现（worktree 脚本远端跑）；就绪复核注入派发前即时检查 + DEPLOYMENT_NOT_READY 前置；断连收口 + lateReport 挂 recheck 恢复。
- TDD：fake SshScope 上全链测试（断连置失败可重派/迟到留痕不改写/事务外执行 + 单事务收口）。

### 任务 2.9 命令面装配（契约定型点）

- `commands/remoteCommands.ts` 新文件 + 既有分域扩展：AD §4.1 表 17 条全量（参数/响应/错误码逐行对齐）；`HOST_COMMAND_NAMES` 69→86 + 装配完整性断言；`diagnosticsSnapshot` 响应 + `helperCaps`/`shortcutRegistered`/`sshFamily` 三字段（签名不变）；`contracts/PROTOCOL.md` §2 追加 6 枚错误码。
- TDD：命令表完整性断言 + 每命令信封测试（fake deps）。
- **完成即通知组 3 联调**（组 3 可提前按本表 + mockHost 开发）。

## 并行组 3 · 客户端 UI（依赖 2.9 契约；可按 AD §4.1 + mockHost 提前并行）

> 全部组件对齐 UIUX 规格（§2 挂载/§3 组件树/§4 状态/§8 文案三语）；每个任务的组件测试用 mockHost 模式（既有 `__tests__/client/` 惯例）。

### 任务 3.1 TaskCreateModal（UIUX §2.1：任务三段头「＋ 新建任务」+ 空态主行动）
### 任务 3.2 SessionsView 扩展（分页控件 + 过滤胶囊四选映射 + 回放按钮 + 已移除部署删除线 + counts 常显）
### 任务 3.3 DeploymentCard + 开通向导（四步条×四态 + LCD 输出屏 + 步③跳过转直连入口 + D31 嵌套确认 + 「就绪（直连）」琥珀点徽章 + 「向导执行中」卡面徽章 + Esc/✕ 后台继续）
### 任务 3.4 导入/恢复确认流（ImportConfirmModal/RestoreConfirmModal 全态序 + 实备份文件名 + 超窗拒绝态 + 结果态）+ 导出卡两按钮
### 任务 3.5 AX 授权卡（两态 + 撤销提示 + 非 macOS 整面隐藏）+ 输入响应开关（默认关口径）
### 任务 3.6 诊断段扩展（helper 六能力矩阵/快捷键注册行/SSH 家族行/HelperBanner）+ badge 清单更新（U29 移除清单 + U35 backup_* 撤销——D33；close_to_tray 保留）
### 任务 3.7 三语 i18n 键全集（dsh.* 增量键三语齐备，`i18n.spec` 键集相等断言扩面）

## 并行组 4 · 分发物与横切收尾

### 任务 4.1 helper 随插件分发

- `package.json` `files` 增 `"helper"`；`build.mjs` 构建序先 helper 后 host（脚本链）；CI 断言安装产物内 uiohook prebuild 在场。

### 任务 4.2 D29 迁移收编

- `storage/migrate.ts` 封顶语义 = `SCHEMA_FILES.length`（行为零变化——当前 2=2）；同版断言测试（`MAX_SCHEMA === SCHEMA_FILES.length` + 内嵌键集 === 文件集）；PROTOCOL §1 文档表述替换。

### 任务 4.3 文档同步（repo-knowledge 义务）

- `dsh-plugin/AGENTS.md` 适配缝清单（+`remote/(经接口注入)`）；`src/host/README.md` 挂点表；`helper/README.md` 桥协议表（2.3 已含）；`docs/debt.md` 记 uiohook 维护项 + 清 debt ⑥；`docs/compatibility.md`（2.2 已含）。

### 任务 4.4 规格回流

- `specs/dsh-plugin/requirements.md` §4.7 两行标 superseded（部分取代边界——FR-X9-3 措辞）。

### 任务 4.5 真机验证（pky-test profile）

- 新建测试 profile 安装构建产物：冷启动建库种子、面板全功能、helper 系统能力面（托盘/快捷键/通知/对话框/TTS/输入计数授权流）、部署开通到派发全链（无远端时 fake 目标 + 降级链验证）、electronGet 落位探测。

## 5. 集成验证与报告（收尾必做）

| 项 | 命令/口径 | 产物 |
|---|---|---|
| 接口测试 | `pnpm --filter dsh-plugin test`（全量 vitest）+ `cargo test`（桌面 P1–P4） | `specs/dsh-plugin-full-parity/reports/raw/junit-*.xml`（api-contract-test 技能口径） |
| E2E | Playwright（客户端面） | `reports/raw/playwright-report/`（e2e-acceptance 技能口径） |
| 验收叙事 | pky-test profile 真机走查 SDD §5 核心 Gherkin | `reports/acceptance-report.md` + `reports/screenshots/` |
| 机械质量 | `CLAUDE_PROJECT_DIR=. bash .claude/hooks/lint-gate.sh` + `python3 .devcontainer/scripts/quality_ratchet_check.py` + `pnpm check:duplicates` + `cargo deny check`（若动 Rust deps）+ `gitleaks detect` | 全绿 |
| 覆盖率 | `pnpm test:coverage`（host 四维 ≥85）+ `pnpm test:rust:coverage`（P1–P4 若动核心逻辑） | 门禁不回退 |
| NFR 手动验收项 | NFR-15 资源脚本（打字 60s 采样 CPU/内存）、AX 授权流实测、双形态提醒单发（P2 合入后）、干净机器冷启动 | 记入 acceptance-report |

## 6. 风险与编排预案

| 风险 | 触发 | 编排动作 |
|---|---|---|
| spike ①/② 失败 | 验证点断言不成立 | **冻结 2.1/2.8**，主路径切 2b（worker 队列适配替换 sshScope，其余任务不受影响）；design.md 轴 2 回流重开 |
| spike ③ 失败 | 解析锚点断言不成立 | 构建面修复（external/bundling 调整），任务面不变 |
| P2/P4 未合入窗口 | 桌面守卫滞后 | 插件侧单方面正确（先到让位成立）；NFR-10 双开验收口径按合入后，报告中标注 |
| uiohook prebuild 缺失 | CI 断言红 | 输入响应面降级（D22 可选功能），不阻塞其余组 |
| 契约夹具时序 | 1.3/1.1 oracle 晚于 TS 侧 | TS 先单测、夹具到位后接契约回放（plan 已注依赖方向） |

## 7. 完成定义（DoD）

- SDD §5 全部 Gherkin 场景可对应自动化测试或真机验收记录；缺口逐条列明归因。
- 命令面 86 条装配断言绿；错误码 21 枚；桥协议双版本矩阵绿；三语键集相等。
- 干净 profile 冷启动全功能可用（外部依赖缺失项全降级提示、零静默）。
- §5 表全部产物落 `specs/dsh-plugin-full-parity/reports/`；门禁四件套全绿；文档同步（4.3）完成。
