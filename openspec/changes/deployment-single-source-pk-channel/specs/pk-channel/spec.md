# Spec Delta

## Purpose

pk 通道：远端机器经反向隧道回调本机 pk 的整条链路（shim + 受限 authorized_keys 条目）的开通与双端幂等收敛；含纯 dsh 场景下 pk 二进制的落位分发。

## ADDED Requirements

### Requirement: `pk remote setup` 子命令

pk CLI SHALL 提供 `pk remote setup` 子命令：以显式参数（SSH 目标别名、隧道端口、密钥目录、本机用户、pk 路径、超时）执行开通序列（定位 pk → 本机 sshd 探测 → 专用密钥 → 本机公钥装配 → 推私钥 → 预信任主机指纹 → 装 shim → 远端 PATH → 端到端验证），任一步失败即停并输出该步修复建议；子命令 MUST NOT 读写待办库。桌面 app 与 dsh 插件 SHALL 经同一子命令获得同套开通能力（桌面可同进程直接调用底层实现）。

#### Scenario: 端到端开通成功

- **WHEN** 对可达的部署别名执行 `pk remote setup`，本机 sshd 已开启
- **THEN** 报告所有步骤 ok/skip，端到端验证步回传远端经隧道执行的 pk 版本号

#### Scenario: 本机 sshd 未开启

- **WHEN** 本机 22 端口无应答时执行开通
- **THEN** 在「本机 sshd」步失败即停，报告给出平台开启指引，后续步骤未执行

#### Scenario: 子命令不碰库

- **WHEN** 本机不存在待办库文件时执行 `pk remote setup`
- **THEN** 开通正常进行，过程中不创建库文件

### Requirement: 双端开通幂等收敛

pk 通道是机器级单例：专用密钥 SHALL 单源于 `<appHome>/data/` 下同一对密钥文件（双端共用），本机 authorized_keys 恒至多一条对应受限条目（`restrict,command=` 指向 pk 受校验入口）；远端 shim 内容 last-writer-wins（嵌最近发起方的 pk 绝对路径）。桌面与 dsh 各自对同一部署开通后重复执行 SHALL 收敛到同一状态，不产生多余密钥、条目堆积或失败残留。

#### Scenario: 双端先后开通不堆积

- **WHEN** 桌面 app 开通部署 A 后，dsh 插件再对部署 A 开通，随后桌面重跑开通
- **THEN** 本机仍只有一对专用密钥、authorized_keys 中恰一条该公钥的受限条目，远端 shim 存在且可用

#### Scenario: 旧版裸公钥原位升级

- **WHEN** 本机 authorized_keys 含旧版本写入的裸公钥行，执行开通
- **THEN** 该行被原位替换为受限条目，其余用户条目不动

### Requirement: 验证步不留悬挂连接

端到端验证 SHALL 在取得 pk 版本后关闭 shim 的连接复用 master（优雅退出 + 失联兜底清扫），保证验证命令按超时返回；验证退出码保留 pk 调用的真实结果。

#### Scenario: 验证后无残留 master

- **WHEN** 端到端验证步执行完成
- **THEN** 远端不存在悬挂的 shim ControlMaster 进程，验证整体在超时内返回

### Requirement: 纯 dsh 场景的 pk 落位

dsh 插件包 SHALL 携带当前平台的 pk 二进制（`vendor/pk-<triple>`）；插件宿主在需要本机 pk 而检测到 `~/.choose-you/bin/pk` 缺失时 SHALL 从包内落位并赋予执行权限；已存在则复用不覆盖。落位后的 pk SHALL 可独立执行 `pk remote setup` 与数据回写。

#### Scenario: 首次落位

- **WHEN** 未装桌面 app 的机器上 dsh 插件首次发起 pk 通道开通
- **THEN** `~/.choose-you/bin/pk` 由包内 vendor 落位，开通与回写全链路成功

#### Scenario: 已存在不覆盖

- **WHEN** `~/.choose-you/bin/pk` 已存在时再次触发落位
- **THEN** 既有文件保持不动，直接复用
