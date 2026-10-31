# Spec Delta

## Purpose

定义 pk 命令面（agent 经 PATH 消费的 CLI）的对外契约：命令集、输出信封、退出码、环境变量、远程开通家族的安全模型，Rust/TS 双实现的行为一致性要求，以及 dsh 场景下 pk 的构建分发与落位形态。

## ADDED Requirements

### Requirement: 命令面完备

TS pk SHALL 提供与 Rust pk 相同的命令集：task（list/get/search/create/update/done/start/pause/current/delete、note、log）、session（log/list）、dispatch（start/done/fail）、suggest（todo/update/follow-up/none/batch）、skill（install/show）、remote（setup/shim/内部 `__ssh_entry`）、category（list）、tag（list/create）、context、doctor、init-db、help（含 `--json`）、version；`pk help --json` 输出的命令索引结构两实现 SHALL 一致。

#### Scenario: help 索引一致

- **WHEN** 分别运行 Rust pk 与 TS pk 的 `pk help --json` 并比对（契约归一化后）
- **THEN** 命令索引的命令集合与字段结构逐字段一致

#### Scenario: 未知命令

- **WHEN** 执行未定义的子命令
- **THEN** 以用法错误退出（码 2），stderr 输出错误信息

### Requirement: CLI 输出信封

stdout SHALL 恒为 UTF-8 JSON（pretty 序列化），例外仅 `skill show`（MD 原文）与 `remote shim`（脚本正文）；业务与用法错误 SHALL 以 `{"error":"..."}` JSON 输出到 stderr；退出码约定：0 成功、1 业务错误、2 用法错误。

#### Scenario: 成功输出 JSON

- **WHEN** 任一数据面命令成功执行
- **THEN** stdout 为可解析的 pretty JSON，退出码 0

#### Scenario: 业务错误

- **WHEN** 命令因业务规则失败（如校验不过、实体不存在）
- **THEN** 退出码 1，stderr 为 `{"error":"..."}` 形态的 JSON

### Requirement: 环境变量契约

pk SHALL 遵守环境变量：`PK_DB` 覆盖 SQLite 库路径（缺省用户数据目录下的库文件，WAL 模式与运行中桌面应用并发安全）、`PK_LOG_FILE` 轨迹日志、`PK_DISPATCH_TASK` 派发任务缺省注入、`PK_SSH_BIN` 覆盖 ssh 程序名；TS 实现语义与 Rust 实现一致。

#### Scenario: PK_DB 指向独立库

- **WHEN** 以 `PK_DB=<临时路径>` 执行 `pk task list`
- **THEN** 库文件在该路径按需初始化，操作不影响缺省库

#### Scenario: dispatch 缺省注入

- **WHEN** 设 `PK_DISPATCH_TASK=<id>` 执行 `pk dispatch done`
- **THEN** 效果等价于显式传 `--task <id>`

### Requirement: 双实现输出一致性

同一命令与输入下，TS pk 与 Rust pk 的 stdout JSON 经契约归一化（时间戳类字段、版本号字段）后 SHALL 逐字段一致；一致性由 contracts 的 CLI 信封契约组锁定——Rust oracle 生成期望输出 fixtures，TS 侧回放逐字段比对，双侧完备性断言（执行场景数 == 场景文件数）与既有契约组同口径。

#### Scenario: 信封契约组回放

- **WHEN** 运行 TS 侧 CLI 信封契约回放测试
- **THEN** 全部命令场景的输出与 fixtures 逐字段一致（归一化字段除外），且场景覆盖数与目录文件数相等

#### Scenario: 漂移检出

- **WHEN** Rust 侧命令输出结构变更后以 oracle 模式再生 fixtures
- **THEN** TS 回放对变更字段报红，漂移可见

### Requirement: remote setup 幂等开通

`pk remote setup` SHALL 执行九步幂等开通（定位 pk、本机 sshd 可达探测、专用 ed25519 密钥、本机 authorized_keys 受限条目装配、推送私钥到远端、预信任隧道端口主机指纹、安装远端 shim、远端登录 shell PATH、端到端验证并收尾 ControlPersist master），每步失败即停且报告含修复建议；SetupReport 输出为 camelCase JSON（`ok`、`steps[]`（name/status/detail）、`version`），结构与 Rust 实现一致；agent 实际运行的非登录 shell PATH 由派发脚本的 PATH bootstrap 兜底，与登录 shell 验证两径独立。

#### Scenario: 全新环境开通

- **WHEN** 对从未开通的 ssh 别名执行 `pk remote setup --host <alias>`
- **THEN** 九步全部执行，SetupReport `ok` 为 true，远端 `~/.local/bin/pk` 就位且端到端验证回传 pk 版本

#### Scenario: 重复开通幂等

- **WHEN** 对已开通环境再次执行 setup
- **THEN** 已满足的步骤报告 skip，最终 `ok` 为 true，不产生重复条目或重复密钥

#### Scenario: 步骤失败报告

- **WHEN** 某步失败（如本机 sshd 不可达）
- **THEN** 流程在该步停止，SetupReport `ok` 为 false，该步 detail 含修复建议

### Requirement: forced-command 入口安全模型

`__ssh_entry` SHALL 严格校验 `SSH_ORIGINAL_COMMAND`：按 POSIX sh 子集词法切分（支持单/双引号与反斜杠转义，零展开，畸形即拒）、环境变量仅允许 `PK_LOG_FILE` 与 `PK_DISPATCH_TASK` 白名单、程序 token 经符号链接消解后 MUST 等价于自身可执行文件；校验通过后不经 shell 以 argv 直启自身，任何拒绝以 stderr JSON 报错并退出码 78。

#### Scenario: 合法透传

- **WHEN** `SSH_ORIGINAL_COMMAND` 为合法形态（可选白名单 env + 本程序路径 + pk 参数）
- **THEN** 以给定 argv 直启 pk，stdout/stderr/退出码透传回 ssh 调用方

#### Scenario: 白名单外环境变量

- **WHEN** 命令含白名单外的环境变量赋值（如 `FOO=1 <pk> ...`）
- **THEN** 拒绝执行，退出码 78

#### Scenario: 程序 token 不匹配

- **WHEN** 程序 token 消解符号链接后与自身可执行文件不等价
- **THEN** 拒绝执行，退出码 78

#### Scenario: 词法畸形

- **WHEN** 命令存在无法按子集词法解析的形态（如未闭合引号）
- **THEN** 拒绝执行，退出码 78

### Requirement: remote shim 生成

`pk remote shim` 与 setup 生成的隧道 shim SHALL 与 Rust 版脚本同语义：`exec ssh` 直连或经隧道回连（BatchMode、ConnectTimeout、ControlMaster/ControlPath/ControlPersist 连接复用，ControlPath 落系统临时目录并带 uid）、`PK_LOG_FILE`/`PK_DISPATCH_TASK` 按需透传（Windows 本机形态省略 env 段）、`"$@"` 参数原样转发；shim 文本作为 CLI 信封契约场景之一锁定双实现一致。

#### Scenario: shim 脚本信封一致

- **WHEN** 以相同参数分别生成 shim 并比对
- **THEN** 脚本正文逐字节一致（嵌入的路径/端口参数相同前提下）

### Requirement: dsh 场景构建分发与落位

dsh-plugin 构建 SHALL 产出单文件 TS pk bundle（node shebang 脚本），构建产物 MUST NOT 包含 Rust pk 二进制（`vendor/` 移除）；插件安装时 SHALL 将 bundle 落位 `~/.choose-you/bin/pk`（Windows 落位 `pk.cmd` 包装 + 无扩展名脚本），内容 sha256 漂移时覆盖重拷，agent PATH 注入机制不变；落位产物 SHALL 可独立执行（`pk --version` 可跑通）且 pk bundle 不依赖 dsh 平台面运行时。

#### Scenario: 单次构建全能力

- **WHEN** 执行 dsh-plugin 构建并检查产物
- **THEN** `dist/` 含 pk bundle，`vendor/` 不存在，构建过程不调用 cargo

#### Scenario: 落位与 PATH 可用

- **WHEN** 插件完成 pk 落位后以注入的 PATH 执行 `pk --version`
- **THEN** 命令成功输出版本号

#### Scenario: 落位幂等与漂移更新

- **WHEN** bundle 更新后插件再次落位
- **THEN** sha256 不同触发覆盖重拷，之后落位文件与 bundle 一致

### Requirement: TS pk 版本取值

TS pk 的 `pk --version` 输出 SHALL 取 dsh-plugin 包版本（构建期注入单源）；CLI 信封契约对版本号字段做归一化，不与 Rust pk 的 Cargo 版本锁字面一致。

#### Scenario: 版本输出单源

- **WHEN** 执行 TS pk 的 `pk --version`
- **THEN** 输出与 dsh-plugin `package.json` 的 `version` 一致
