# Spec Delta

## Purpose

部署注册表：双端（桌面 app 与 dsh 插件）共享的远程机器唯一注册表——部署实体以 OpenSSH 别名为标识，凭据归 `~/.ssh`，是 agent 远程绑定与 pk 通道配置的挂靠点。

## ADDED Requirements

### Requirement: 部署实体唯一注册表

部署实体 SHALL 存于共享库的单一 settings 键（`dsh:deployments`），桌面 app 与 dsh 插件双端读写同一份数据；别名（alias）SHALL 全局唯一；实体 MUST NOT 存储任何密钥材料或口令（凭据由 `~/.ssh` 别名承载）。所有写操作 SHALL 在单条 `BEGIN IMMEDIATE` 短事务内整读-改-整写。

#### Scenario: 别名重复被拒

- **WHEN** 任一端用已存在的别名新建部署
- **THEN** 写入被拒绝并返回别名冲突错误，既有部署不变

#### Scenario: 双端并发写不损坏

- **WHEN** 桌面 app 与 dsh 插件同时编辑不同部署并保存
- **THEN** 两次写入均成功（后写覆盖先写的整份 JSON），数据保持合法 JSON 且无部分写入

### Requirement: 路径不变式

实体的远端路径字段（nodePath / workdir）SHALL 只接受展开后的 POSIX 绝对路径；`~` 前缀与相对路径 MUST 拒绝。空 workdir 表示远端登录目录缺省。双端校验口径一致。

#### Scenario: 拒绝波浪号前缀路径

- **WHEN** 任一端保存 nodePath 为 `~/node`
- **THEN** 返回路径不变式错误并提示填展开后的绝对路径

### Requirement: 别名改名的绑定级联

部署别名被改名且被 agent 绑定引用时，SHALL 经显式确认后级联更新全部 agent 绑定；未确认时拒绝改名。

#### Scenario: 确认后级联

- **WHEN** 别名从 `gpu-1` 改为 `gpu-2` 且携带确认标志，存在绑定 `gpu-1` 的 agent
- **THEN** 部署别名更新且所有 agent 绑定同步改为 `gpu-2`

### Requirement: pkTunnel 机器级字段

部署实体 SHALL 携带机器级隧道配置字段（`pkTunnel`：隧道端口 + 常驻开关）；一个部署至多一条 pk 通道配置；agent 实体 MUST NOT 再携带隧道端口或常驻开关字段。

#### Scenario: 隧道配置挂部署

- **WHEN** 在部署管理中为部署设置隧道端口并保存
- **THEN** 该配置对绑定此部署的全部 agent 生效，agent 编辑面无隧道字段

### Requirement: 契约单源与双端对齐

部署实体的形状（字段名、类型、约束）SHALL 单源于 `contracts/`，TS 与 Rust 双实现共享同一份 fixtures 对齐测试；任一端形状演进未同步另一端 SHALL 在 CI 呈红。

#### Scenario: 契约漂移即红

- **WHEN** 一端为部署实体新增必填字段而另一端实现未跟进
- **THEN** 共享 fixtures 回放测试在未跟进端失败

### Requirement: 存量迁移（AgentRemote → 部署绑定）

桌面 app SHALL 提供一次性迁移：把 agent 上的内联远程配置按 distinct (host, port, keyPath) 归并生成部署、在 `~/.ssh/config` 写入带 managed 标记的别名条目（原子写 + 先备份 + 幂等替换）、agent 改为绑定别名、清空其内联 remote 字段。迁移 SHALL 幂等可重跑，中断不产生半迁移状态。

#### Scenario: 同机多 agent 归并为一个部署

- **WHEN** 三个 agent 的内联远程配置 host/port/keyPath 完全相同，执行迁移
- **THEN** 生成一个部署，三个 agent 均绑定它，`~/.ssh/config` 恰好新增一个 managed 条目

#### Scenario: 幂等重跑

- **WHEN** 迁移完成后再次执行迁移
- **THEN** 无新增部署与 config 条目，结果报告全 skip

#### Scenario: 迁移前备份

- **WHEN** 迁移需要写 `~/.ssh/config` 且该文件已存在
- **THEN** 先生成备份副本再写入；managed 条目重复执行不堆积
