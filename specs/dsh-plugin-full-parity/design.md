# dsh-plugin 独立形态全量补齐 + dsh 原生 SSH 远程派发 · design.md

> brainstorming 方向性设计记录（2026-10-17）。分级：**L 级（Architectural）**——新子系统（系统能力 sidecar、远程派发架构）、改接口（helper 桥协议、DispatchExecutor seam、capability 探测面）、跨 host/client/helper 三层。
> 前置调研：独立分发可行性（构建期依赖全部内嵌、DB 自迁移自洽、运行期零桌面 app 依赖）+ dsh 0.2.0-rc.2 SSH 家族实测（本机 dsh 安装 + npm 包解包核查）。缺口清单见调研结论：①系统能力 9 项 ②远程派发（D5 翻案）③纯逻辑 4 项。

## ① 问题理解

**要解决什么**：dsh-plugin 目前约九成对齐桌面 app，剩余缺口集中在「桌面系统能力层」与「远程派发」。目标 = 不装桌面 app、只装 dsh 插件即获得完整功能，且远程 agent 派发改用 dsh 原生 SSH 子系统（取代桌面 app 的 pk shim + 反向隧道方案，D5 降级翻案）。

**谁 / 为什么**：用户本人（自用，A9 本地分发口径不变）；动机是「只装 dsh 的机器」拥有与桌面 app 等价的完整体验，并能向远端 POSIX 主机派发 agent 任务而无需远端安装 pk 二进制或建隧道。

**Success criteria**：
1. 调研缺口核销表逐项关闭：桌面 88 条命令面与插件 68 条的差集，每条落实为「已实现 / 等价替代 / 明确不做（记录裁决）」三态之一，无静默缺席。
2. 远程派发：单面板向 N 台远端 POSIX 主机派发无头与交互任务；远端前置 = Node + dsh-ssh helper（插件提供 provisioning），不需要 pk、不需要反向隧道；断连/清理语义明确。
3. 独立分发包安装到干净 dsh profile（无仓库、无桌面 app）后全功能可用；既有质量门禁不回退（覆盖率 85 四维、棘轮、契约回放、i18n 三语键集相等）。
4. 规格 §4.7 滞后两行（复盘向导 / 备份导出 OUT）回流关闭。

**用户原话 vs 本设计假设**（差异部分需在关卡确认）：
- 用户说：「全部补齐，包括使用 dsh 原生 SSH 子系统实现远程 ssh agent 派发」。
- 假设 1：「全部」= 上轮调研报告的缺口清单（①+②+③）+ 注意点 1/4（schema 推版口径、规格回流）；**不含** acceptance-report 遗留四项（J/K 焦点流、迟到判定 30s 回看、pregen --session-id、pk claim 令牌——维持既有债务）。【待确认】
- 假设 2：桌宠输入响应（打字节奏反馈）要求突破 helper「不引入键盘监听」红线，改为有条件实现（见轴 3）。【待确认——隐私/权限口径】
- 假设 3：分发形态维持 A9 本地路径/file 安装；npm 公开发布（PokeAPI 再分发口径）不在本次。

## ② 关键约束

**dsh 平台事实（2026-10-17 实测）**：
- 本机 dsh 0.2.0-rc.2 默认**不含** SSH 家族；`@deepseek-ai/dsh-ssh` / `dsh-subprocess-ssh` / `dsh-fs-ssh` / `dsh-sandbox-ssh` 0.1.6-alpha.1 已发布 npm，为可经 bundle patch / `ctx.plugin` 装载的 Cordis 插件。
- `dsh-ssh` = **部署级单连接服务** `ctx.ssh`：一个 OpenSSH alias ↔ 一个远端；Config 要求远端预装 helper 入口 + SHA-256 摘要校验 + 远端 Node 路径 + 默认 workspace；BatchMode + 严格 host-key + 禁 agent forwarding；OpenSSH 多路复用 + Unix socket 转发 + TLS-PSK 流加密；**无自动 provisioning、无重连、无 replay、不支持 Windows 端点**。
- `dsh-subprocess-ssh` = `ctx.subprocess` seam 的 SSH 实现（`spawn` / `spawnTerminal` 真 PTY / `resolveExecutable`），依赖 `ctx.ssh`，无自身配置；远端进程托管语义等同 `subprocess-local`（进程组、有界 spill 输出、静默清理）。
- cordis 4.0.4 支持 `ctx.isolate(name, label?)` 作用域隔离——同名服务可在兄弟作用域各持实例（同 label 合并作用域）。
- 插件现有 CAPABILITY_KEYS 已含 `dsh-ssh`/`dsh-terminal`/`dsh-subagent` 等占位键，apply 期表面探测框架在位。

**插件铁律（不可破）**：业务核心零 dsh 依赖（平台面只在 `dsh/` `pet/` `dispatch/` 适配缝）；storage 唯一握连接 + guarded 迁移 + `BEGIN IMMEDIATE` 短事务 + CAS；契约行为以 `contracts/fixtures` 锁定为准；helper 独立子包（stdio JSON 行桥协议单源）；i18n 三语键集相等；TODO 零字面量；helper 不占 Dock 图标。

**数据共存**：`~/.choose-you/data/pokemon-choose-you.db` 三端共享；schema 窗口 [2,2]，A19「只迁到 minSchema」本义 = 只迁到插件打包的最新契约版（窗口随 contracts 同步演进）；独立分发后插件即唯一迁移执行方，推版纪律写进发布流程，不是代码变更。

**版权**：PokeAPI sprites 仅个人学习，不新增商用渠道（随分发形态延续）。

**平台**：dsh-ssh 两端均限 Linux/macOS；输入监听仅 macOS 有 AX 授权体系（Windows/Linux 端点降级）。

## ③ 方案探索

三条独立轴分别选型；轴 1/3 相对轻，轴 2 是本特性的架构主轴。

### 轴 1：桌面系统能力的承载者（托盘 / 全局快捷键 / 系统通知 / TTS / 文件对话框 / 打开目录）

| 方案 | 内容 | Trade-off |
| --- | --- | --- |
| **1a. Electron helper 升级为「系统能力 sidecar」（推荐）** | helper 内部新增系统能力模块：`Tray`（托盘菜单）、`globalShortcut`（⌘⇧K 快捕 / ⌘⇧D 显隐）、`Notification`（提醒/番茄通知 + host timer 调度）、TTS（`speechSynthesis`）、`dialog`（导入/恢复选文件）、`shell.openPath`（打开导出目录）；host 经既有 stdio 桥协议下发命令与回传事件 | 优点：常驻进程现成、桥协议单源已锁、桌宠演出/坐栖/台词本就在 helper、零新增进程与原生依赖。缺点：helper 职责膨胀（需内部分模块防成一锅粥）；helper 缺席 = 系统能力全降级（延续 A20 语义：仅桌宠停用 → 扩为「桌宠+系统能力停用」）；CI headless fake 面要扩 |
| 1b. dsh 平台面承载 | dsh-client-shortcuts（页面级快捷键）/ 浏览器 Notification / dsh-host-open-in-app | 覆盖不全：快捷键仅页面聚焦时有效（非 OS 级）、通知依赖面板常开、无托盘无 TTS；仅适合作降级通道 |
| 1c. host 侧 Node 直做 | node-notifier / say 子进程 | 依赖碎片化（原生模块 × 平台矩阵）、无托盘/快捷键，不完整，否决 |

**推荐 1a**，1b 作为 helper 缺席时的页面内降级（通知 → 插件页 toast + SegmentNav 计数；快捷键 → 页面内键盘流）。

### 轴 2：远程 SSH agent 派发架构（dsh 原生）

dsh-ssh 的部署级单连接设计（一条 `ctx.ssh` 对一个远端）与「单面板派 N 台」存在张力，三种走法：

| 方案 | 内容 | Trade-off |
| --- | --- | --- |
| **2a. 插件内多 deployment 作用域（推荐主路径）** | 插件为每个 deployment `ctx.isolate("ssh").isolate("subprocess")` fork 作用域，各挂 `SshConnection` + `SshSubprocessRuntime`；DispatchExecutor 新增远端实现经作用域 `ctx.subprocess.spawn`（无头）/ `spawnTerminal`（交互真 PTY）在远端起 agent CLI；本地派发同步收编为 `ctx.subprocess`（dsh-subprocess-local 或回落现 spawn），统一进程托管语义 | 优点：单 profile 单面板派 N 台；复用 dsh-ssh 全部传输安全语义（多路复用/TLS 流/远端托管清理）；本地+远端同一 seam，DispatchExecutor 抽象正是为此预留。缺点：dsh-ssh 设计意图是部署级单例，多实例隔离需 **spike 验证两点**（isolate 多实例装配、`spawnTerminal` 终端 backend 注册是否按作用域隔离/命名冲突）；alpha API 风险集中在适配层（符合 RC 期薄适配层原则）；远端 helper provisioning dsh 不提供 → 插件自建向导；远端 agent CLI 需远端自带认证；远端无 pk → 派发提示词走「无 pk 变体」（完成回报本就靠进程退出收口，不阻塞） |
| 2b. 每 deployment 一个 dsh profile（composition 级 SSH） | 用户为每台远端建 SSH-composed profile，插件以 worker 角色装入，经 DB `dispatch_slots` 领取路由到本 deployment 的队列任务执行；主 profile 面板只写队列 | 优点：完全顺着 dsh「一个 deployment 一个 composition」意图，零作用域黑魔法；worker 的 dsh 终端侧栏/jobs UI 原生可见远端进程。缺点：每台远端常驻一个 dsh 进程（重）；多实例共享库需 primary/worker 角色互斥（radio/judge 只跑 primary）；交互派发终端在另一个 profile 的 UI（切换成本）；N 台 = N 份 profile 维护 |
| 2c. 插件自管 OpenSSH 传输（非 dsh 原生） | 现有 ShellRunner 缝扩展：`ssh -o ControlMaster=auto` 复用连接 + 流式 stdout，`sshCheck` 已是雏形 | 优点：最简单、多 host 天然、零新依赖。缺点：不满足「dsh 原生」诉求；无 PTY 终端集成；进程托管/断连/清理全部自研 |

**推荐 2a 为主路径，2c 保留为降级链**（dsh-ssh 包缺失 / 远端 helper 未装 / 派发目标非 POSIX → ShellRunner 直连 `ssh` 跑无头派发；交互派发降级为「复制命令行」现状语义）。**2b 不采用**，但 2a 沿用既有 `dispatch_slots` CAS 槽协议，未来可与 2b 叠加不冲突。**首个实施任务 = spike**：验证 isolate 多实例 + 终端 backend 注册两点；spike 失败则主路径切换 2b 再回流设计。【待确认——spike 失败的切换授权】

### 轴 3：桌宠输入响应（打字节奏 cps 反馈）

| 方案 | 内容 | Trade-off |
| --- | --- | --- |
| **3a. helper 引入全局键盘钩子（推荐）** | uiohook-napi 类原生模块挂在 helper 主进程；**只统计按键频率不记录键值**；默认关，设置开启 + macOS 辅助功能授权引导（复用桌面 input.rs 的 AX 授权流语义） | 优点：唯一能真实还原桌面体验的路径；helper 是常驻 sidecar、钩子生命周期可控。缺点：突破 helper「不引入键盘监听」红线 → 需以四条新红线替代（可选、默认关、只计数不记键、授权显式）；原生模块引入 electron-rebuild/ABI 分发面 |
| 3b. 维持 D4 降级 | 不做 | 与「全部补齐」目标冲突，仅在 3a 被否时保留 |
| 3c. dsh 页面/终端输入事件近似 | 监听插件页输入 | 失真（仅面板聚焦时），无全局性，价值存疑 |

**推荐 3a**，前提是用户在关卡确认红线替换口径。【待确认】

### 就地决策（方向明确，不展开选型）

- 手动新建任务：客户端表单 + 新 host 命令（对齐桌面 create_task 字段集）。
- 会话历史：分页 host 命令 + 插件页内录制原文查看器（不依赖系统 opener）。
- 导入/恢复备份：helper `dialog` 选文件 → host 执行；恢复为危险操作 = 二次确认 + 恢复前自动备份。
- 飞书授权：对齐桌面事实——桌面并不内嵌 OAuth，而是拉起系统终端跑 `lark-cli auth login`（凭证 lark-cli 自管）；插件对等 = 在 dsh 终端会话内一键启动同一命令行，不自建回调 listener。
- 连胜：对齐桌面算法做 domain 纯函数 + 契约夹具锁定。
- 提醒调度：host timer 扫描到期（提前量/勿扰/紧急敲门语义对齐 FR-S6/D1）→ helper Notification；helper 缺席降级页面 toast。
- 桌宠行为补齐：连胜演出 / 坐栖 / 时刻台词 / 小剧场 / AI 聊聊（经 agent 执行方 + 既有 PET_CHAT_SYSTEM_PROMPT 覆盖位）自桌面 PetApp.vue composables 移植至 helper。
- schema 推版：**语义变更（SDD D29）**——独立分发后插件收编迁移执行权，封顶 = 插件打包的最新契约版（A19「绝不推过 2」修订）；双形态并存 = 插件推到打包上限、主应用可推更高、窗口外只读保护；发布检查单约束同版发版。
- 规格回流：`specs/dsh-plugin/requirements.md` §4.7 两行标 superseded 指向本特性 SDD。

## ④ 待落地清单（交给 SDD / AD / UIUX 的开放项）

**交 SDD**：缺口核销表逐项用户故事 + Gherkin（系统能力 9 项 / 远程派发 provisioning-派发-交互-断连-清理 / 纯逻辑 4 项）；输入响应隐私口径（默认关、只计数、授权流）；导入恢复安全口径；NFR（独立安装包完整性、断连不损库、覆盖率不回退）。

**交 AD**：轴 2a 的 Cordis 作用域装配 + spike 任务定义；deployment 实体与 dispatch_routes 契约（是否动 contracts 003 迁移，A13 双轨口径）；helper 桥协议扩展（系统能力命令族 + 事件回传，§桥协议单源同步）；ShellRunner 降级接口定型；远端 provisioning 协议（远端 Node 探测 / helper 上传 / sha256 / 写 deployment 配置）；capability 探测键实装（dsh-ssh/dsh-terminal 真实探测）；PROTOCOL §2 错误码扩展；`@deepseek-ai/dsh-ssh` 系列依赖装配方式（插件 dependencies 随 profile 安装 vs external）；headless CI fake 扩面；**helper 随插件包分发与 electron 运行时按需获取机制（SDD D30/debt ⑥）**；**迁移封顶改造（D29 语义变更的代码面）**；**跨形态提醒 CAS 仲裁原语（D28）**。

**交 UIUX**：新建任务表单；会话原文查看器；deployment 管理 + provisioning 向导（连接表单 → 远端探测 → helper 安装进度 → 校验）；辅助功能/通知授权引导流；托盘菜单项；远程派发状态呈现（deployment 健康、断连警示、远端任务回传）；导入恢复确认流；提醒通知文案与勿扰静默。

**关卡待确认清单（汇总）**：① 范围边界（acceptance 遗留四项不含）；② helper 键盘监听红线替换口径（轴 3a）；③ 2a spike 失败时切换 2b 的授权；④ npm 发布不在本次。
