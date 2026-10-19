# Proposal

## Why

远程模型当前双轨并存：dsh 插件已按「agent 绑定部署（OpenSSH 别名）」驱动远程派发，桌面 app 仍是 per-agent 内联 `AgentRemote` + per-agent 开通 pk shim——同一 `ai_agents` JSON 里两套远程描述，隧道与 shim 端口（机器级属性）挂在 agent 上。更关键的是反向隧道唯一维护者是桌面 app：桌面 app 未装/未跑时，远端 agent 无法经 pk 回写本机数据，纯 dsh-plugin 场景不闭环。

## What Changes

- **部署实体成为双端共享的远程机器唯一注册表**：桌面 app 获得部署 CRUD、agent 绑定下拉、pk 通道开通入口、隧道状态展示；dsh helper 开通向导仍归插件面板。实体形状进 `contracts/`（TS/Rust 双实现 + 共享 fixtures，ADR-0003 §5）。
- **BREAKING：`AgentRemote`（host/port/keyPath/tunnel/persistent）退役**：桌面派发解析从 `agent.remote.host` 切换为部署绑定；存量配置一键迁移（distinct (host, port, keyPath) → 自动建部署 + 写 `~/.ssh/config` managed 条目 + 绑定 + 清空 `remote`，备份 + 可重跑）。
- **pk 通道开通序列下沉为 `pk remote setup` 子命令**（Rust 单源参数化，桌面 UI 薄壳 + dsh host spawn 调用）；双端重复开通幂等收敛（专用密钥单源、authorized_keys 恒单条目、shim last-writer-wins）。
- **反向隧道双宿主维持**：可用性契约 = 本机任一宿主（桌面 app 或 dsh host）驻留期；`<appHome>/tunnels/` 让位锁（目录锁 + PID 探活）协调双宿主，抢不到者待命、持有方退出自动接管；两端同构 supervisor（autossh 配方内化）。隧道配置上移部署实体（`pkTunnel` 机器级字段），agent 表单只剩「绑定哪个部署」。
- **纯 dsh 的 pk 分发**：插件包内 `vendor/pk-<triple>`，host 首用检测 `~/.choose-you/bin/pk` 缺失则落位；npm 平台包为后续演进（记 `docs/debt.md`）。

## Capabilities

### New Capabilities

- `deployment-registry`: 部署注册表——双端共享的远程机器实体（alias 唯一、路径不变式、绑定级联、`pkTunnel` 机器级字段、contracts 契约、存量迁移）。
- `pk-channel`: pk 通道——远端回调本机 pk 的开通（`pk remote setup`）与双端幂等收敛、纯 dsh 场景的 pk 落位分发。
- `reverse-tunnel`: 反向隧道——双宿主维持契约、让位锁协调、两端 supervisor 行为。
- `agent-remote-binding`: agent 远程绑定——桌面执行世界解析切换到部署绑定、AgentRemote 退役与迁移、桌面 UI（部署管理 + agent 表单 + 隧道状态）。

### Modified Capabilities

（无——openspec 首次接入，主规格库为空；既有 dsh 侧部署行为见 `specs/dsh-plugin-full-parity/`，本变更不改其 helper 开通向导。）

## Impact

- **代码面**：桌面 `src-tauri/`（`commands/remote_pk.rs` 下沉参数化、`commands/tunnel.rs` 加让位锁、`commands/dispatch/route.rs` 解析切换、`ai/config.rs` AgentRemote 退役、新增部署管理命令组、全部 ssh 组装点改 `ssh <alias>`）；`src/`（Vue：设置页部署管理、agent 表单、迁移引导）；`src-tauri/src/bin/pk/`（`remote setup` 子命令）；`dsh-plugin/src/host/`（隧道 supervisor + 让位锁、pk 落位、`pk remote setup` spawn、读 `pkTunnel`）；`contracts/`（部署实体契约 + fixtures）；`dsh-plugin/build.mjs`（vendor pk）。
- **兼容性**：AgentRemote 迁移一次性 Breaking（自动 + 备份 + 幂等）；`dsh:deployments` 升级双端整读整写（`BEGIN IMMEDIATE` 内，同 `ai_agents` 模式）。
- **决策依据**：ADR-0003；术语见根 `GLOSSARY.md`。
- **范围外**：dsh helper 开通向导（仍归插件面板）、npm 平台包分发（另行裁决）、独立隧道 daemon（否决，两端都退即断）、`/opsx` 流程外的 UI 重设计。
