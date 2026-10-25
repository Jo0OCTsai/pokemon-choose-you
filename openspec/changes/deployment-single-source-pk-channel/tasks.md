# Tasks

## 1. 契约与部署实体（无行为变化基座）

- [x] 1.1 `contracts/deployments/`：实体形状单源（字段表 + JSON 口径）+ 共享 fixtures（合法/非法样例：别名冲突、路径不变式、pkTunnel）；PROTOCOL.md 增补部署实体节
- [x] 1.2 TS 实现：`dsh-plugin/src/host/remote/deployments.ts` 实体扩展 `pkTunnel` 字段（类型 + 校验），fixtures 回放测试
- [x] 1.3 Rust 实现：`src-tauri` 部署实体 struct（serde 全形状 + 未知字段保留）+ fixtures 回放测试（Rust oracle 对齐）

## 2. `pk remote setup` 子命令（Rust 单源）

- [x] 2.1 `RemotePkSetup` 参数化改造：`run_setup` 上下文全部显式参数（去掉按 agent 组装）；密钥目录缺省改 `<appHome>/data/`（双端收敛单源，含桌面路径切换）
- [x] 2.2 pk CLI `remote setup` 子命令：参数解析 + JSON 报告输出 + 退出码语义；不碰库（抢在 open_db 前）
- [x] 2.3 桌面部署驱动薄壳 `setup_deployment_pk`：按部署实体组装参数调 `run_setup`，成功落 `pkTunnel`；旧 `setup_remote_pk`/`write_back_tunnel_port` 随 3.4 AgentRemote 退役一并删除（顺序调整，非缩水）
- [x] 2.4 双端收敛测试：同 key_dir 重跑全 skip、authorized_keys 恒单条目、旧裸公钥原位升级、shim last-writer-wins

## 3. 桌面部署管理 + 绑定切换 + AgentRemote 退役

- [x] 3.1 桌面部署 CRUD 命令组（读 `dsh:deployments`，`BEGIN IMMEDIATE` 整读整写）+ 别名改名校验/级联 + `~/.ssh/config` Host 条目读取
- [x] 3.2 派发解析切换：`ssh_host_of` → 绑定 → 部署注册表；`dispatch/route.rs`、`exec.rs`、`ai/runner.rs`、技能远端安装全 ssh 组装点改 `ssh <alias>`；悬空绑定报错
- [x] 3.3 存量迁移器：distinct (host,port,keyPath) 归并建部署 + managed config 标记块（备份/幂等替换）+ 绑定改写 + remote 清空（单事务、可重跑、报告）
- [x] 3.4 `AgentRemote` 退役：struct 删除、`ai_agents` 解析容忍未知 `remote` 字段、`tunnel.rs` TunnelKey 改从部署 `pkTunnel` 派生
- [x] 3.5 桌面 UI：设置页部署管理区（CRUD + pk 通道开通入口 + 分步报告 + 隧道状态）、agent 表单绑定下拉替换内联字段、迁移引导横幅；i18n 键补齐

## 4. 让位锁 + 双宿主隧道

- [x] 4.1 让位锁原语：`<appHome>/tunnels/<deployment-id>/pid` 目录锁（mkdir 原子性 + PID 探活 EPERM=存活）+ 单元测试（双抢/死锁回收）
- [x] 4.2 桌面 `tunnel.rs` 接锁：启动/变更触发、待命重查周期、退出释放；状态机补「让位待命」
- [x] 4.3 dsh `remote/tunnelSupervisor.ts`：spawn `ssh -N -R` 同构配方（ServerAlive/ExitOnForwardFailure/退避）+ 锁集成 + `remote/` 零 dsh import 保持
- [x] 4.4 dsh 宿主接线：启动时对 `pkTunnel.persistent` 部署拉起；面板隧道状态展示（让位待命 vs 重连区分）

## 5. 纯 dsh pk 落位

- [x] 5.1 `dsh-plugin/build.mjs` vendor 步骤：拷当前平台 `pk-<triple>` 入包；`files` 清单与分发物断言更新
- [x] 5.2 宿主首用落位：`~/.choose-you/bin/pk` 缺失检测 → vendor 落位 + chmod +x；已存在复用；CI 分发物断言

## 6. 验收与文档

- [x] 6.1 api-contract-test：部署实体双端 fixtures 回放 + `pk remote setup` 报告契约（junit raw 报告落变更目录 reports/）
- [ ] 6.2 e2e-acceptance：specs 四能力逐 Scenario E2E——本地 sshd + localhost 别名拓扑：双端开通收敛 / 双宿主让位与接管 / 死锁回收 / 迁移幂等 / 纯 dsh 落位闭环（**未完成**：单测级覆盖已含锁双抢/死锁回收/收敛/迁移幂等/vendor 落位断言，真机 sshd 拓扑 E2E 待补——见 reports）
- [x] 6.3 文档同步：USER_GUIDE（部署管理、pk 通道、隧道可用性契约与断开语义）、dsh-plugin/AGENTS.md 与 src 相关 AGENTS.md、ARCHITECTURE.md、`docs/debt.md`（npm 平台包演进缝、并发编辑 CAS 强化）
- [x] 6.4 质量收口：lint-gate + 棘轮 + 覆盖率门禁（前端/Rust/dsh-plugin 三口径）+ `pnpm check:duplicates` + gitleaks

## Workflow follow-up

- 用户 review 规格与设计（本提案四工件）后方可 `/opsx:apply`
- 实施完成后 `/opsx:archive`（主规格库首次归档）
