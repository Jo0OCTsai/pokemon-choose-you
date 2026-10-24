# Spec Delta

## Purpose

agent 远程绑定：agent 的部署绑定（别名；空 = 本机）唯一决定派发执行位置，桌面 app 与 dsh 插件同一口径；桌面 app 的部署管理与迁移入口。

## ADDED Requirements

### Requirement: 执行世界单源

agent 的部署绑定 SHALL 唯一决定该 agent 的派发执行位置：绑定为空 = 本机执行，绑定别名 = 经 `ssh <alias>` 远端执行。桌面 app 的派发目标解析 SHALL 与 dsh 插件同口径（hostKey 归一 `local` / `ssh:<alias>`）；agent 实体 MUST NOT 再携带 host/端口/密钥/隧道等内联远程字段驱动派发。

#### Scenario: 绑定部署的 agent 远程派发

- **WHEN** agent 绑定别名 `gpu-1` 的部署且该部署存在，向该 agent 派发任务
- **THEN** 派发经 `ssh gpu-1` 在远端执行，派发目标展示该部署

#### Scenario: 未绑定 agent 本机执行

- **WHEN** agent 部署绑定为空，向该 agent 派发任务
- **THEN** 派发在本机执行

### Requirement: 绑定存在性校验

绑定不存在别名的 agent SHALL 不可用于远程派发：派发解析时报错并指引到部署管理添加；agent 编辑保存时对新建绑定校验别名存在于部署注册表。

#### Scenario: 悬空绑定拒绝派发

- **WHEN** agent 绑定的别名不在部署注册表中，解析该 agent 的派发目标
- **THEN** 返回绑定失效错误并提示先在部署管理中添加该别名

### Requirement: 桌面部署管理面

桌面 app SHALL 提供部署管理：新建/编辑/删除部署（别名下拉读本机 `~/.ssh/config` Host 条目，既有别名即使已不在 config 中也保留可选）、pk 通道开通入口（调用 `pk remote setup` 同套能力并落库开通结果）、隧道状态展示。dsh helper 开通向导 MUST NOT 出现在桌面端。

#### Scenario: 桌面新建部署并开通 pk 通道

- **WHEN** 用户在桌面 app 用 `~/.ssh/config` 中的既有别名新建部署并点击开通 pk 通道
- **THEN** 开通按 `pk remote setup` 序列执行，成功后部署的通道状态就绪、失败展示分步报告可重试

### Requirement: agent 表单绑定面

桌面 agent 编辑表单 SHALL 以部署下拉（本机执行 + 已有部署列表）替代原内联远程字段（host/端口/密钥/隧道/常驻）；表单不再出现任何 SSH 连接参数输入。

#### Scenario: 表单仅剩绑定选择

- **WHEN** 打开桌面 agent 编辑表单
- **THEN** 远程相关控件只有「绑定部署」下拉（默认本机执行），无 host/端口/密钥输入

### Requirement: ssh 组装点凭据单源

桌面 app 全部远端操作（派发执行、隧道建立、探测、远端技能安装、通道开通）SHALL 以 `ssh <alias>` 调用（连接参数由 `~/.ssh/config` 解析），MUST NOT 再接受来自应用配置的显式 host/端口/密钥参数。

#### Scenario: 隧道按别名建立

- **WHEN** 桌面 app 为开启常驻开关的部署 `gpu-1` 拉起隧道
- **THEN** ssh 命令以别名 `gpu-1` 发起，不携带 `-p`/`-i` 显式参数
