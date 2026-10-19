# Spec Delta

## Purpose

反向隧道：把部署远端回环端口转回本机 sshd 的 `ssh -N -R` 连接，由持有让位锁的宿主（桌面 app 或 dsh 插件宿主）维持，双宿主共存时同一时刻至多一个维护者。

## ADDED Requirements

### Requirement: 可用性契约 = 任一宿主驻留期

反向隧道 SHALL 在本机任一宿主（桌面 app 或 dsh host）驻留期间对开启了常驻开关的部署维持可用；两端均未运行时隧道断开（不引入独立守护进程），此断开语义 SHALL 在用户文档写明。

#### Scenario: 桌面 app 退出后 dsh 接管

- **WHEN** 桌面 app 维持着部署 A 的隧道并退出，dsh host 正在运行
- **THEN** dsh host 在让位锁释放后自动接管并恢复部署 A 的隧道，远端调用 pk 不中断超过一个重查周期

#### Scenario: 两端都退出

- **WHEN** 桌面 app 与 dsh host 均退出
- **THEN** 隧道断开、锁目录清理，无残留 ssh 进程；任一宿主再启动后恢复

### Requirement: 让位锁

隧道维护权 SHALL 由本机锁目录（`<appHome>/tunnels/` 下按部署标识）+ 持有方 PID 文件协调：抢锁失败且持有方 PID 存活时，挑战方 SHALL 进入待命（周期重查，不发起第二条同端口 `ssh -R`）；持有方 PID 已死时挑战方 SHALL 清理失效锁并接管。锁机制 MUST 跨平台零外部依赖。

#### Scenario: 双宿主同跑单维护者

- **WHEN** 桌面 app 已持有部署 A 的隧道锁且健康，dsh host 启动并欲维持同一部署
- **THEN** dsh host 进入待命状态不发起 ssh 连接；隧道始终恰由桌面 app 维持

#### Scenario: 死锁自动回收

- **WHEN** 持锁宿主被强杀（锁目录残留、PID 已死），另一宿主重查
- **THEN** 失效锁被清理，另一宿主接管隧道

### Requirement: supervisor 行为同构

两端隧道 supervisor SHALL 同构实现 autossh 配方：`ServerAliveInterval`/`ServerAliveCountMax` 探死、`ExitOnForwardFailure=yes` 杜绝假隧道、指数退避重连（稳定满一定时长后复位）；两端探测参数口径一致。

#### Scenario: 远端重启后自愈

- **WHEN** 隧道连接因远端机器重启断开，持锁宿主仍在运行
- **THEN** supervisor 按退避策略自动重连，恢复后远端调用 pk 恢复可用

### Requirement: 触发与释放

宿主 SHALL 在启动时及部署的常驻开关变更时，对开启常驻的部署自动拉起隧道维持；宿主退出时 SHALL 释放锁并终止其维持的 ssh 连接。

#### Scenario: 启动自动拉起

- **WHEN** dsh host 启动且部署 A 的 `pkTunnel` 常驻开关开启、锁可获取
- **THEN** dsh host 自动为部署 A 建立并维持隧道

### Requirement: 隧道状态可观测

每端 SHALL 能展示各部署的隧道状态（未配置 / 连接中 / 健康 / 重连中 / 让位待命），让位待命 SHALL 与故障重连在状态上可区分。

#### Scenario: 让位待命可区分

- **WHEN** 桌面 app 持锁维持部署 A 隧道，用户查看 dsh 插件面板的隧道状态
- **THEN** 状态显示为让位待命（非重连中），并指明当前维护者为桌面 app
