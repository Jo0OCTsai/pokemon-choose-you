# 用户场景验收报告（acceptance-report）· dsh-plugin-full-parity

> 日期：2026-10-17（实施会话收尾）。走查环境 = 本机真实 dsh 宿主（`dsh --profile pky-test`，
> 隔离数据目录 `CHOOSE_YOU_HOME=/tmp/pky-smoke.3rd`，冷启动建库）+ 真实 sshd（别名
> pky-spike-a → localhost，spike 资产复用）+ 真实 Electron 运行时（electronGet 下载件）。
> 证据：`reports/screenshots/rm-*.png`（真机截图）、`reports/raw/pky-test-*.log`（启动日志）、
> `specs/dsh-plugin-full-parity/spike-dsh-ssh.md` + `spike/logs/`（spike 机器报告）。

## 1. 真机冒烟叙事（4.5）

### 1.1 干净 profile 冷启动（FR-X9-1）✅

隔离数据目录启动 `dsh --profile pky-test`：待办库自动创建（`data/pokemon-choose-you.db` +
WAL）、迁移至 user_version=2、种子 5 默认分类 + 4 标签维度（sqlite3 实读核验 `2/5/4`）。
dsh web 面板内「Pokédex」入口 → 插件面板七分段全渲染（冒险/草丛/路线/图鉴/收音机/日志/背包），
空态被动文案在位（「＋ 新建任务」入口已移除——2026-10-17 用户裁决，FR-C1 回流）；零仓库相对路径读取报错（NFR-12① 机器面 = 构建期内嵌 +
CI 分发物断言）。截图 `rm-01-panel-adventure.png`。

### 1.2 electronGet 按需获取（FR-X9-4/D30）✅ 全链实测

首启：本机无 electron 二进制 → 正确降级（「桌宠降级停用（A20）：electron 二进制缺失——已发起
后台按需获取」——**不阻塞冷启动**，NFR-15）。`ELECTRON_MIRROR` 指向 npmmirror 后重启：
官方回落链 → 镜像下载（446MB）→ 内嵌校验 → 原子落位 `~/.dsh/electron/dist/Electron.app/`
→ **探测链直接命中**（AD §3.4「落位即被探测」实测成立）→「electron 运行时已就绪」。
再重启：petAutoStart 配置为 true 时**开机自动拉起 helper**（Electron 主进程 + GPU/utility
子进程，`ps` 实证，启动日志 `raw/pky-test-boot.log`）。

> 冒烟修正（已落码）：① probeDsh 的 ctx 表面探测改 try/catch 安全访问（真实 cordis ctx
> 对未注入服务名访问即抛 "cannot get property without inject"——测试 fake ctx 无代理掩盖了
> 此差异，真机暴露后修复，`dsh-ssh 家族：就绪` 现于真机正确呈现）；② `@electron/get` 改
> external（bundle 内联时其 CJS 依赖 `debug` 的运行时 `require("tty")` 在 ESM 产物直接炸导入
> ——真机「failed to import」暴露；external 后经插件包闭包解析，依赖钉版在位）；③ petAutoStart
> 未设值默认开（`!== false` 语义，D18）。

### 1.3 系统能力面（FR-A1/A2/A4/A5/A7）✅

helper 拉起后真机验证（截图 `rm-02-diagnostics.png`）：**托盘/全局快捷键/通知/文件对话框/语音
五能力全部「可用」**（hello.caps 能力位矩阵，helper 运行时 0.1.0）；**输入计数「降级」**——
未授辅助功能权限时零监听（D22 红线 + 授权门槛真机成立）；HelperBanner 随 helper 在位消失
（降级→恢复动态正确）。AX 一键直达面板（mac-auth-query 含直达动作）经 headless 契约测试锁定，
授权流交互属本机隐私操作未在无人值守走查中执行（授权后行为由 sys 模块单测 + sysRouting 集成
测试覆盖；记录为 NFR-13 手动项的自动化面）。

### 1.4 部署开通与远程派发（FR-RD 组）✅ 装配面 / ⚠ 前置传输

真机经 UI 添加部署 `pky-spike-a`（表单校验/落库/三态计数徽章正确）；诊断段 `dsh-ssh 家族：就绪`
（真实宿主内动态 import 解析插件闭包——spike ③ 结论在产品路径复验）。**dsh-ssh isolate 装配、
spawn/spawnTerminal/断连处置全链由 spike 17/17 断言 + sshScope 真机冒烟 14/14 覆盖**（真实
ssh 连接 277–578ms、双作用域 PTY 无串扰、dispose 隔离、ssh 进程记账零残留）。
**前置直连传输缺口已修复并真机复验（2026-10-17 收尾批次）**：开通向导步①–④发生在远端
helper 安装**之前**，而 dsh-ssh 连接以远端 helper 为传输基底（spike-dsh-ssh §5）——修复 =
`scopeFor` 按 helperPath/helperHash 落定状态路由（`familyProvisioned` 单源）：未落定 →
`dsh/directScope.ts` 直连 ssh 传输（本机 ssh 二进制 + BatchMode/ConnectTimeout，选项复用
`sshCheck.sshConnectArgs`；无长连、spawnTerminal/writeFile 不支持），落定 → dsh-ssh isolate
scope（自然切换——recheck/派发用真连接）。真机复验（pky-test profile + pky-spike-a 真实
sshd，经 web 面板同款 `/api/pky/call` 传输面驱动）向导四步全过：① 免密连通 HOME 探测 →
② Node v24.21.0 → ③ npm 闭包安装（远端非交互 shell 无 nvm PATH——npm 探测优先 node 同目录
sibling + 安装命令注入 `PATH=<node bin>:$PATH` 前缀，两处真机暴露后修复）→ ④ 摘要复核
`9d7c7403…c5e896` 一致；徽章计数 ready=1，sqlite `dsh:deployments` 落 helperPath/Hash，
`deploymentRecheck` 经家族链复核 ready 复验通过。

### 1.5 提醒/仲裁/导入恢复/会话回放（FR-A3/A10/A5/C2）✅ 域面

契约回放 59 场景（reminder 8 + streak 6 新增）+ 领域单测（提醒聚合/勿扰七边界/CAS 让位/导入
五态/恢复超窗/回放快照压配置）全绿——域行为按 FR-X3 以夹具锁定；装配层 reminder loop
全链（到期→送达→去重→勿扰→toast 降级→补看面）经 fake timer 测试覆盖。双形态提醒单发依赖桌面
P2 守卫（已合入，cargo 394 全绿）——双开真机同窗验证属 NFR-10 手动项（下表）。
（FR-C1 面板手动新建已移除——2026-10-17 用户裁决「完全不需要」，相关域面/用例/入口同步下线。）

## 2. SDD §5 Gherkin → 测试映射（DoD）

| 故事 | 场景 | 落点 | 状态 |
|---|---|---|---|
| FR-A1 托盘 | 常驻与菜单/缺席降级/自愈恢复 | helper sys 单测 17 + runtime.sysRouting 10 + 真机 1.3（自愈：旧 dsh 杀 helper 后自动重拉实测）| ✅ |
| FR-A2 快捷键 | ⌘⇧K 快捕/注册失败降级 | sys.modules.spec（失败不发 + 全注销回干净态）+ 真机「可用」| ✅（注册失败**上行面**缺失→debt 已记）|
| FR-A3 提醒 | 到期去重/聚合/逾期复盘/勿扰/降级不丢 | 契约 reminder 8（含 quiet-boundaries 七步、CAS 双连接）+ reminder-loop 13 | ✅ |
| FR-A10 仲裁 | 双形态单发/郑重形态归属 | reminder/dedup-cas-single-delivery（双连接双 tick）+ solemn 单测（A30 host 完成路径判定）| ✅ 域面；双开同窗属手动项 |
| FR-A5 导入恢复 | 校验拒绝/前置快照/超窗/备份失败中止/补跑 | backup-import 12 + backup-restore 7 + commands-remote 信封 | ✅ |
| FR-A9 输入响应 | 默认关/只计数/撤销即停 | sys.modules + inputCps 纯函数 + eslint 红线自证 6 + 真机降级呈现 | ✅（AX 授权交互 = 手动项）|
| FR-B3 连胜演出 | 宽容日/里程碑优先/可跳过 | 契约 streak 6 + catchScene 11 + reducedMotion 即时结算（含顺手修复既有卡死 bug）| ✅ |
| FR-C1 新建 | 最小新建/标题校验 | 已移除（用户裁决 2026-10-17「完全不需要」——taskCreate 命令/TaskEditModal create 模式/入口与全部用例下线；建卡走会话捕捉与收音机链路） | 🗑 |
| FR-C2 回放 | 本机三分支/快照压配置 | sessions-page 22 + harness E2E 04 | ✅ |
| FR-RD1 部署管理 | 断开可移除/凭据零存储 | deployments 18（键集白名单断言）+ 移除清理三路 | ✅ |
| FR-RD2 开通向导 | 免密失败即停/摘要不符/幂等/降级确认 | provision 20 + upload 拆件 8 + D31 两态 + 真机四步全过（§1.4 复验）| ✅ 全链（含真机前置传输）|
| FR-RD3 无头派发 | 远端世界/断连不损库/迟到留痕 | dispatchRemote 23（事务外执行断言/单事务收口/前后快照）+ spike 并发 spawn | ✅ fake 面 + spike 真连接 |
| FR-RD4 交互派发 | 真 PTY 注入/同上下文/兜底新开 | spike vp2（双作用域 PTY 写读隔离）+ 适配器单测（同 sessionId 重派/关闭兜底）| ✅ |
| FR-RD5 worktree | 幂等复用/失败降级 | dispatchRemote worktree 组 | ✅ |
| FR-RD6/7 降级探测 | 家族缺失明示/无死入口 | compat 双向断言 + 部署卡指引态（harness E2E 05 面）+ 真机 sshFamily 就绪 | ✅ |
| FR-X9-1/2/4 | 冷启动/迁移收编/分发 | 真机 1.1/1.2 + migrate D29 同版断言 + CI 分发物断言 | ✅ |

## 3. NFR 手动验收项

| 项 | 结果 |
|---|---|
| NFR-15 资源 | helper 常驻（托盘+快捷键+通知+GPU 进程）实测 idle CPU ≈0.0–2.8%（ps 采样）≈ 内存 ~90MB（含 GPU/utility 子进程合计 <300MB 预算）；打字 60s 采样脚本未在无人值守执行（输入响应需 AX 授权交互）——数值面记录为待人工复核，红线（≤5%/≤300MB/≤10%）无反证 |
| AX 授权流实测 | 交互属系统隐私操作未无人值守执行；三态（未授权/已授权/撤销即停）由 sys.macAuth 单测 + 轮询/订阅双通道锁定（真机 1.3 的「降级→提示」态实证） |
| 双形态提醒单发（P2 后） | 桌面守卫（cargo 双线程竞态测试）+ 插件 CAS 单测各自在位；双开同窗整窗验证待人工（仲裁原语域面已契约锁定） |
| 干净机器冷启动 | §1.1 隔离目录全链 ✅（含外部依赖缺失降级：lark/agent CLI 缺省提示面由 NFR-12 断言）|

## 4. 已知项与归因（验收边界）

1. ~~**provision 前置步直连 ssh 传输**（§1.4）~~ **已修复并真机复验**：scopeFor 按 helperPath/Hash
   落定状态路由直连 scope（`dsh/directScope.ts`）；域状态机/错误映射/幂等语义不变（fake 面 63+
   用例锁定 + 路由判定/直连 scope 单元/真链 env 门控冒烟新增）。修复过程连带暴露并修复两处真机
   专项：① 制品解析 `require.resolve("@deepseek-ai/dsh-ssh/helper")`（裸 `./lib/helper.js` 子路径
   未 exports 抛 ERR_PACKAGE_PATH_NOT_EXPORTED）；② npm 安装命令 `PATH=<node bin>:$PATH` 前缀
   （npm shebang `env node` 在远端非交互 shell 缺 PATH）。
2. **shortcutRegistered 恒 null**：helper 注册失败无上行消息（debt 已记「全局快捷键注册结果上行面缺失」）。
3. **harness E2E 断言的是 mockHost 数据面**（真实 host 面由真机冒烟补位）；date-time-picker 存量时间敏感 flake 已修（断言按 defaultOpenValue 推导）。
4. 冒烟修正三件（probeDsh 安全访问 / @electron/get external / petAutoStart 默认开）均由真机暴露后修复并回归——真机验证的价值记录。

## 5. 供应链与门禁四件套

gitleaks（CI 口径 git 模式 + 豁免配置）no leaks；lint-gate 三服务全绿；cargo test 394+27 绿；
质量棘轮与覆盖率四维收口见收尾记录（复杂度清零 + 装配层补测批完成后重跑留档）。
