# dsh 插件形态（第二形态）· 方向性设计

> brainstorming 产出（2026-10-11）。本文档只做需求探索 + 方向性选型；细化归 SDD（requirements.md）与设计阶段（uiux-design.md / architecture.md）。

## ① 问题理解

**要解决什么**：把「就决定是你了」（Tauri 桌宠待办应用）以 DeepSeek Harness（dsh）插件形态落地，成为与主应用**长期并存的第二形态**。用户日常常驻 dsh 工作时，待办管理的完整闭环——任务读写、收音机判定、桌宠陪伴、待办派发——在 dsh 内原生完成，不必切回 Tauri 主应用。

**谁**：本项目用户（开发者自用为主），dsh 日常重度用户；主应用用户不受影响。

**为什么**：

- 日常工作环境已实质迁移到 dsh（会话、终端、subagent、SSH 都在 harness 内），待办工具跟着走可以消除切换成本；
- dsh 的能力面与本产品需求高度同构：schedule 子系统（host-wide durable 调度）对应收音机轮询与提醒，subagent（external executions）+ worktrees + SSH provider family 对应待办派发（含远程），slot GUI 体系 + sidecar Electron helper（社区 dsh-pet 先例）对应图鉴机面板与桌宠；
- 派发方向上 dsh 原生 SSH（远端执行世界、harness 留本机）比主应用现在的 ssh+tmux+shim 链路更干净。

**success criteria（双轨长期口径，用户已确认）**：

1. v1 全量四块在 dsh 内可用：任务面（读写 / 状态机 / 专注）、收音机（飞书轮询 → AI 判定 → 建议分诊）、桌宠（透明置顶 helper、任务状态驱动动画与台词）、派发（subagent + worktrees + SSH 远程，状态与成本回传）；
2. dsh 插件与 Tauri 主应用双轨长期并存、各自正常演进（主应用保持正常节奏，不冻结）；
3. 两形态面向**同一份待办数据**，不出现两套待办库（具体共享机制是 AD 开放项）；
4. 主应用行为不受插件存在的影响。

## ② 关键约束

- **平台基线**：dsh 0.2.0-rc.2（RC 期，破坏性变更风险已知——如 Desktop 访问闸门曾逼出 dsh-pet 的 bridge 改造）；插件体系 = Cordis（everything is a plugin，host 半边 + `dsh.client` 客户端半边同包）。
- **业务核心 TS 重写（用户选型）**：判定 / 假名化 / 任务状态机等核心逻辑迁进 Cordis 插件；与 Rust 核心构成双轨期两套业务逻辑，**写路径归属与 schema 演化协调是本项目最高风险项**。
- **桌宠 OS 面**：非官方扩展点，走 sidecar Electron helper 模式（dsh-pet 先例：局部小窗 + 点击穿透 + 命中翻转 + 置顶看门狗 + 宿主存亡绑定；MIT 可参考）。已知坑：Windows DWM 全屏透明画布触发视频合成黑屏 → 必须局部小窗形态（本应用现窗体即 300×330 局部小窗，同构）。
- **调度语义**：schedule 子系统投递目标是 Session（到点注入 prompt 唤醒模型回合），非任意代码执行；jobs 子系统是否支持无 LLM 确定性任务**待验证**——收音机轮询的正确挂点取决于此。
- **派发语义**：dsh SSH = deployment 拥有的远端执行世界（fs/subprocess/sandbox/terminal/LSP 落远端，模型与会话留本机）；派发策略面（并发上限 / worktree 隔离 / 续接 / 自动派发）为插件编排逻辑，dsh 不内置。交互通道形态差异：主应用「新终端 / ssh+tmux」↔ dsh 终端面板。远端 workspace 文件视图需单独集成（官方文档明示）。
- **产品原则延续**：注意力友好七原则需在 dsh 形态下重新表述（harness 是已选择打开的工作台，被动信号原则的载体不同）；判定链路全链路假名化不因形态迁移放松。
- **素材版权**：PokeAPI sprites 版权限制（仅个人学习、勿商用）随任何分发形态维持。
- **i18n**：简体 / 繁體 / English 三语延续。

## ③ 方案探索

### 方案 A · 薄插件，核心单源（pk 复用）

dsh 插件仅作 TS 编排壳（slots UI + schedule/jobs + 派发 + 桌宠 helper），一切数据与判定经 pk CLI 读写同一 SQLite，业务核心留在 Rust 单源。

- ✅ 双写成本最低；数据零分叉；主应用零改动。
- ❌ dsh 侧功能永远受 pk 命令面约束；轮询归属（app 不开则无轮询）需要额外解法；dsh 原生能力（storage/tools/调度语义）利用率低。

### 方案 B · 全量 TS 重写（**选定**）

业务核心迁移进 Cordis 插件（dsh storage domain / 自有存储 + dsh tools），dsh 原生形态最彻底；pk CLI 降级或退役，节奏另议。

- ✅ dsh 原生语义全面利用；摆脱 pk 面约束；长期看第二形态可独立演进。
- ❌ 全量重写成本；双轨期两套业务逻辑并行维护，每个新功能双写（用户已知悉并接受）；数据共享机制需要专门设计，分叉风险最高。

### 方案 C · daemon 中台

Rust 核心抽 headless 常驻服务，pk 为客户端协议，Tauri 与 dsh 插件皆薄壳。

- ✅ 长期最干净的架构；单业务逻辑。
- ❌ 需先重构主应用，与「主 app 正常演进」决策冲突；周期最长；dsh 侧 TS 壳仍要写，等于两边大动。

### 选型结论

**方案 B**，由用户在知晓代价的情况下选定（双轨长期 + 主 app 正常演进的组合下，双写成本已知悉接受）。风险缓解方向（细节归 AD）：数据层尽量维持单库单 schema 源；TS/Rust 双逻辑边界用协议化的判定与状态机契约钉死，使「双写」收敛为「双实现、单契约」。

## ④ 待落地清单（交给 SDD / AD 的开放项）

1. **数据共享机制**（最高优先）：同一 SQLite 直连（schema 归属如何协调——Rust 迁移单源 vs TS 接管）vs 同步层 vs 各自存储 + 归并；双轨期 schema 变更流程。
2. **pk CLI 去留与降级节奏**：终端入口保留多久、agent 技能面如何过渡到 dsh 原生 tools。
3. **收音机触发归属**：dsh schedule（模型回合驱动，成本口径）vs jobs（若支持无 LLM 确定性任务）vs 依赖主应用轮询——需先做 jobs 能力验证。
4. **假名化在 TS 链路的位置**：判定 prompt 组装侧的实现与真名还原边界。
5. **派发映射细节**：SSH deployment 配置管理、并发上限与 worktree 策略在编排层的表达、状态/成本回传的写路径、会话续接语义。
6. **桌宠 helper 工程细节**：与插件宿主半边的通信（参考 dsh-pet bridge 模式）与生命周期、开机自启、多显示器。
7. **注意力友好七原则的 dsh 形态重述**（UIUX）：被动信号 / 打断可拒 / 通知分级在新载体的落点。
8. **dsh RC 版本跟踪策略**：破坏性变更的应对流程（锁定版本 / 升级窗口）。
9. **图鉴设计系统与三语 i18n 在 dsh UI 的延续方式**。
10. **测试与质量门禁映射**：Cordis 插件测试栈、CI 形态、与现有质量棘轮的关系。
