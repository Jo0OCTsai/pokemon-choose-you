# pokemon-choose-you（就决定是你了）

待办/任务管理系统，三个形态端（桌面 app / pk CLI / dsh 插件）共用同一份 SQLite 数据；远程执行与数据回写围绕「部署」与「pk 通道」两个机器级概念组织。

## Language

**宿主（Host）**:
在本机驻留、可承担长时职责（维持隧道、维持会话）的形态端——桌面 app（Tauri）或 dsh host（插件宿主半边）。pk CLI 与 shim 是短命进程，不是宿主。
_避免_: 客户端、运行时、端

**部署（Deployment）**:
一台远端 POSIX 机器的注册条目：OpenSSH 别名即标识与凭据载体（凭据归 `~/.ssh`，实体不含密钥材料）。是远程执行世界的唯一指向物。
_避免_: 远程主机、服务器、机器配置

**执行世界（Execution World）**:
一次派发或 agent 会话的执行位置：本机（`local`）或某个部署（`ssh:<alias>`）。由 agent 的部署绑定唯一决定。
_避免_: 执行环境、runtime

**pk 通道（pk Channel）**:
远端回调本机 pk 的整条链路：反向隧道 + 远端 shim + 本机受限 authorized_keys 条目。机器级单例——同一部署至多一条，双宿主开通幂等收敛。
_避免_: 远程 pk、回写通道

**反向隧道（Reverse Tunnel）**:
把远端回环端口转回本机 sshd 的 ssh 连接（`ssh -N -R`）。同一时刻至多一个维护者。
_避免_: 端口转发（泛指）

**让位锁（Tunnel Lock）**:
隧道维护者协调机制：本机锁目录 + 持有方 PID 探活；抢不到锁的宿主待命，持有方退出后自动接管。
_避免_: 租约

**开通（Provision）**:
把一个部署变为可用状态的幂等步骤序列。两类互不混淆：dsh 组件开通（远端装 dsh-ssh helper，四步向导，归插件面板）与 pk 通道开通（`pk remote setup`，桌面与 dsh 均可发起）。
_避免_: 安装、部署配置

**shim**:
远端 `~/.local/bin/pk` 的透传脚本：把 pk 调用经反向隧道回连本机、以受限入口执行本机 pk。
_避免_: 代理、转发器

**存量迁移（Legacy Remote Migration）**:
把 agent 上旧的内联远程配置（host/端口/密钥/隧道）转换为部署绑定的一次性迁移；含生成 `~/.ssh/config` managed 条目。
_避免_: 与库迁移（schema migration）混用「迁移」一词
