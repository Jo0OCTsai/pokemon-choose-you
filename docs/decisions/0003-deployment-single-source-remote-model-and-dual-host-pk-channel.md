# ADR-0003：部署实体单源远程模型与 pk 通道双宿主闭环

> 状态：已采纳（§3 的「开通序列 Rust 单源」结论已被 ADR-0006 取代——按宿主双实现）　日期：2026-10-19
> 来源：2026-10-19 盘问裁决（grill-with-docs，10 问全裁）；上游裁决 = dsh-plugin AGENTS「执行世界单源 = agent 绑定部署（2026-10-19）」与 USER_GUIDE「v1 本地路径/file 包分发」。术语见根 `GLOSSARY.md`。

## 背景

dsh 插件侧已裁决 agent 绑定部署（`ai_agents.deployment` = OpenSSH 别名）驱动远程派发；桌面 app 仍是 per-agent 内联 `AgentRemote`（host/端口/密钥/隧道）+ `setup_remote_pk` 按 agent 开通。两套远程描述并存于同一 `ai_agents` JSON，隧道与 shim 端口是机器级属性却挂在 agent 上（「同远程多 agent 须手填相同端口」已暴露别扭）。同时反向隧道唯一维护者是桌面 app——桌面 app 未跑则远端无法经 pk 回写。

本次两项需求：① 桌面 app 对齐部署模型（「安装配置远程 PK」等同 dsh 远程部署）；② **纯 dsh-plugin（桌面 app 未装/未跑）也必须闭环 PK 回写**。

## 决策

### 1. 部署实体 = 远程机器唯一注册表；执行世界单源贯穿双端

部署（alias 即标识，凭据归 `~/.ssh`）成为两端共享的机器注册表（`dsh:deployments`）：桌面 app 获得完整 CRUD + agent 绑定下拉 + pk 通道开通 + 隧道状态；dsh helper 开通向导仍归插件面板（桌面派发 ssh 直呼 agent CLI，用不到 helper）。桌面派发解析从 `agent.remote.host` 切换为部署绑定；`AgentRemote` 退役，经存量迁移转换（distinct (host, port, keyPath) → 自动建部署 + 写 `~/.ssh/config` managed 条目（备份 + 幂等）+ 绑定 + 清空 `remote`）。否决双轨长期并存（单源名存实亡）与手配提示（机械工作甩给用户）。

### 2. 隧道可用性契约 = 本机任一宿主驻留期；双宿主以让位锁协调

`ssh -N -R`（autossh 配方内化）由持有让位锁的宿主维持：锁 = `<appHome>/tunnels/` 目录锁 + PID 探活，抢不到者待命周期重查，持有方退出自动接管。两端（桌面 `tunnel.rs`、dsh host）同构实现。否决独立 daemon（两端都退即断，文档写明）与 ssh 对撞容忍（桌面常驻 + dsh 按需同跑是主路径场景，`ExitOnForwardFailure` 对撞会让后到者永陷重连）。

### 3. pk 通道 = 机器级单例；开通序列下沉 `pk remote setup` 子命令

开通序列（密钥生成 / authorized_keys 受限装配 / 推私钥 / 指纹预信 / 装 shim / PATH / 端到端验证）从 Tauri 命令层参数化下沉为 pk CLI 子命令（Rust 单源，`run_setup` 等与 pk 同 crate 零搬运）；桌面 UI 薄壳调用，dsh host spawn `<pk> remote setup` 获得同套能力。双端重复开通幂等收敛：专用密钥单源（`<appHome>/data/` 同一对密钥文件 → authorized_keys 恒单条目）、shim 内容 last-writer-wins（嵌最近发起方 pk 绝对路径，两端 pk 读写同一库，覆盖无害）。否决 dsh 侧 TS 重实现（约 400 行永久双维护）。

### 4. 纯 dsh 的 pk 分发 = 插件包内 vendor + 首用落位

插件构建把 `pk-<triple>` 拷入包内 `vendor/`；host 首用检测 `~/.choose-you/bin/pk` 缺失则落位（chmod +x）。与 v1「本地路径/file 包分发」一致，零新基建；npm 发布裁决落地后可演进为 esbuild 式 optionalDependencies 平台包（演进缝记 `docs/debt.md`）。否决首用下载（pk 无官方源，需自建 release 基建）与手动构建（违背纯 dsh 闭环）。

### 5. 部署实体形状进 `contracts/`

部署实体升级为双端一等读写公民后，形状单源进 `contracts/`（TS/Rust 双实现 + 共享 fixtures 对齐，沿用既有契约机制）。否决「TS 权威 + Rust serde 宽松容忍」延续（Rust 结构体往返静默丢未知字段——`write_back_tunnel_port` 已踩过）与桌面 Value 级手术式改写永久化（一次性补丁变永久负担）。

## 后果

- 桌面全部 ssh 组装点（runner / tunnel / probe / setup / 远端技能安装）从显式 `-i/-p` 改 `ssh <alias>`，`~/.ssh/config` 成为凭据唯一载体；存量迁移一次性 Breaking（备份 + 可重跑）。
- `dsh:deployments` 双端整读整写（`BEGIN IMMEDIATE` 内，同 `ai_agents` 模式）；字段演进经 contracts/ 契约锁，双端 fixtures 漂移即 CI 红。
- 隧道与 shim 端口从 agent 字段上移部署实体（`pkTunnel` 机器级字段），agent 表单只剩「绑定哪个部署」一个远程概念。
- 「桌面 app 与 dsh host 都未跑」的时段远端调 pk 失败——可用窗口语义写进 USER_GUIDE。
