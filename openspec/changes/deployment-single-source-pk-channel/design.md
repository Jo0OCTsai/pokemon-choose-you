# Design

## Context

现状基线（见 proposal.md - Why 与 ADR-0003）：dsh 插件已按 agent 绑定部署驱动派发（`dsh-plugin/src/host/remote/` + `dispatch/routes.ts`）；桌面远程面 = `src-tauri/src/ai/config.rs` 的 `AgentRemote` + `commands/remote_pk.rs`（开通序列）+ `commands/tunnel.rs`（常驻隧道管理器，autossh 配方内化）+ `commands/dispatch/route.rs` 的 `ssh_host_of`；pk CLI 已有 `remote shim` 子命令与 `__ssh_entry` 受限入口（`src-tauri/src/bin/pk/remote.rs`），且 `run_setup`/`shim_script`/`authorized_entry` 与 pk 同 crate。三方共库 `~/.choose-you/data/pokemon-choose-you.db`（WAL，PRAGMA 逐字对齐）。dsh 插件 v1 以本地路径/file 包分发。openspec 本次首次接入，主规格库为空。

## Goals / Non-Goals

**Goals:**

- 部署实体双端一等读写，形状契约进 `contracts/`
- 桌面 app 与 dsh 插件的执行世界解析同口径（部署绑定单源），`AgentRemote` 退役
- pk 通道开通 Rust 单源（`pk remote setup`），双端幂等收敛
- 隧道「任一宿主驻留期」维持，让位锁协调双宿主
- 纯 dsh 场景 pk 落位闭环

**Non-Goals:**

- dsh helper 开通向导进桌面端（仍归插件面板）
- npm 平台包分发 pk（记 debt，另行裁决）
- 独立隧道 daemon / 系统服务
- Windows 远端机器支持（部署 = POSIX 远端，本机 Windows 既有行为不变）
- `ai_agents` 之外存量数据的任何迁移

## Decisions

### D1 部署实体契约放 `contracts/deployments/`

形状（TS interface + Rust struct + JSON Schema 口径说明）与 fixtures 双端共享；Rust 侧 `serde` 全形状（非宽松容忍），未知字段仍保留序列化（`#[serde(flatten)] catch-all` 或 Value 合并策略，以 fixtures 锁行为）。替代方案：TS 权威 + Rust 宽松（否决：双端完整读写后往返丢字段）；桌面 Value 级手术式改写永久化（否决：一次性补丁变永久负担）。写路径沿用 settings 键整读-改-整写（`BEGIN IMMEDIATE` 内），不引入新表——部署实体形态变化不触碰库迁移（`dsh:deployments` 是 settings 键，minSchema 不动）。

### D2 `pkTunnel` 字段与让位锁粒度

锁目录 = `<appHome>/tunnels/<deployment-id>/`（内含 `pid` 文件）；用 deployment id 而非 alias 作锁键——alias 改名不影响隧道身份。挑战方周期（10s 量级）重查；PID 探活用 `kill(pid, 0)` 等价语义（Node `process.kill(pid, 0)` / Rust `kill -0`），跨平台零依赖。接管与释放由 supervisor 生命周期事件驱动，不引入心跳文件。

### D3 `pk remote setup` 参数化与桌面薄壳

`RemotePkSetup` 上下文从「按 agent_id 查库组装」改为子命令参数直供（`--host <alias>`、`--tunnel-port`、`--key-dir`、`--local-user`、`--pk-path`（缺省 current_exe）、`--timeout`）；输出 JSON 报告（steps + version），退出码 = 报告 ok 与否。桌面 `setup_remote_pk` Tauri 命令保留（UI 入口不变），内部按部署实体组装参数后同进程调用 `run_setup`；dsh 侧 spawn `~/.choose-you/bin/pk remote setup --host <alias> …` 并解析 JSON 报告落库。`write_back_tunnel_port` 整体删除（隧道端口归部署实体，agent 不再回写）。

### D4 双端隧道 supervisor 同构、互不共享代码

桌面 `tunnel.rs` 加锁环；dsh 侧新增 `src/host/remote/tunnelSupervisor.ts`（`node:child_process` spawn `ssh -N -R`，remote/ 目录零 dsh import 不变量保持——锁与 spawn 均平台中立）。两端参数口径（ServerAlive 10s×3、ExitOnForwardFailure、退避 1s→30s、稳定 60s 复位）在 specs 锁定，实现各自测试。替代方案：抽出共享 JS 模块给桌面用（否决：桌面是 Rust）。

### D5 存量迁移器放桌面 `commands/` 内、幂等三段式

（1）扫描 `ai_agents` 内联 remote → 归并 distinct (host, port, keyPath)；（2）生成 managed `~/.ssh/config` 条目（`# BEGIN managed by pokemon-choose-you` / `# END` 标记块，块内幂等替换；块外用户内容不动；写前整体备份到 `<appHome>/backups/ssh-config-<ts>`）；（3）建部署 + 改绑定 + 清空 remote（单事务）。别名生成规则 `pky-<host 段>`，冲突时递增后缀。迁移入口 = 设置页横幅 + 部署管理页按钮；报告可重跑。

### D6 dsh 侧 pk 落位与首用触发

`dsh-plugin/build.mjs` 追加 vendor 步骤（从 `src-tauri/binaries/pk-<triple>` 拷当前平台；构建时 triple 已知）。落位时机 = 两个入口的最前置：宿主侧 pk 通道开通、隧道 supervisor 启动前探测（远端 shim 嵌的路径 = `~/.choose-you/bin/pk`，两端统一——桌面 app 已装机器上 dsh 落位同一路径则两个 pk 并存于不同位置，shim last-writer-wins 收敛，见 specs pk-channel）。

### D7 桌面 ssh 组装点切换面

`ai/runner.rs`（agent 远程调用）、`commands/tunnel.rs`、`commands/dispatch/*`、技能远端安装、`remote_pk.rs` 的 ssh 组装统一改为 `ssh <alias>`（BatchMode 等既有选项保留）；`AgentRemote` 结构体删除，`ai_agents` 解析改为容忍并忽略未知 `remote` 字段（迁移后字段已清空，容忍仅为迁移前兼容窗口）。`ssh_host_of` 改为「绑定 → 部署注册表查 alias」派生。

## Risks / Trade-offs

- [迁移写 `~/.ssh/config` 损坏用户配置] → 标记块 + 块内幂等替换 + 写前备份 + 迁移报告含备份路径；不做全文件重排
- [双端 `dsh:deployments` 并发编辑整份覆盖丢更新] → 短事务缩窗口（现状 `ai_agents` 同模式）；编辑面保存前重读 + 版本 CAS（settings 键无版本列，以整读时快照比对拒绝静默覆盖）记入 debt 的可选强化
- [让位锁跨平台边界（Windows 无 POSIX kill 语义差异）] → `process.kill(pid,0)`/`kill(pid,0,0)` 在 Windows 对不存在 PID 抛 ESRV/EPERM 语义差异——按「EPERM 视为存活」处理
- [dsh 侧 vendor 增大插件包体] → 只拷当前平台 triple（本地路径/file 安装场景构建机即目标机）
- [shim last-writer-wins 期间两端 pk 版本漂移] → 功能等价（同一库）；pk 版本对齐由发布节奏保证，doctor 面板展示远端回传版本
- [`pk remote setup` 与桌面旧 `setup_remote_pk` 并存期行为漂移] → 桌面薄壳即刻切换到同一 `run_setup`，无并存期

## Migration Plan

1. contracts 契约与双端实体实现（无行为变化）
2. `pk remote setup` 子命令 + 桌面薄壳切换（既有 agent 远程功能不变——`AgentRemote` 尚在场，组装参数暂由它派生）
3. 部署实体 `pkTunnel` 字段 + 桌面部署管理 + 绑定解析切换（存量迁移器上线，`AgentRemote` 退役）
4. 让位锁 + dsh 隧道 supervisor + pk 落位
5. 回滚策略：各步独立可回退（git revert 单步）；迁移器提供「从备份恢复 ssh config」报告指引，部署与绑定数据不回滚（新键新字段，旧读端忽略）

## Open Questions

- dsh 面板是否需要展示「当前隧道维护者」（锁持有方 PID 归属进程名）——specs 已锁「让位待命可区分」，归属进程名展示为实现细节，可后决
