# Changelog

所有重要变更记录于此。格式遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，
版本号遵循 [Semantic Versioning](https://semver.org/lang/zh-CN/)。
发布走开发版草稿流（见 [开发指南 · 发布](docs/DEVELOPMENT.md)）：本文件随版本人工维护，已发布段落请勿手工编辑。

## [Unreleased]

### Features

- 新增**终端偏好**设置（设置页 → 集成）——交互派发、历史记录与飞书授权唤起哪个终端应用跟选择走：macOS 可选系统内置 Terminal.app / iTerm2（AppleScript 新建窗口）/ Ghostty（`open -na`），Windows 可选系统内置 PowerShell（`powershell -NoExit -ExecutionPolicy Bypass -Command`，会话级放行 npm 垫片 .ps1——默认 Restricted 策略会禁脚本；行格式换 PS 单引号字面量 + 行首 `&` 调用符，cd 串联改 `;` 且 `-ErrorAction Stop` 失败即停——PS 5.1 无 `&&`；不再走 cmd）/ Windows Terminal（wt.exe 跑同一 PowerShell 行，固定 SystemRoot 工作目录规避 reparse 别名静默失败、`\;` 转义防 wt 子命令分隔符截断派发 prompt），Linux 可选自动探测 / Ghostty；下拉按当前平台裁剪，跨平台错配（如迁移库后）显式报错不静默回落
- Agent CLI 集成新增 **pi**（[pi coding agent](https://github.com/earendil-works/pi)）支持——设置页预设一键添加（无头参数、会话恢复语法预配），pk 技能目录自动识别（pi → `~/.pi/agent/skills/`，`pk skill install pi` 可装），历史入口按 id 恢复（pi 的选择器 `-r` 自动换 `--session <id>`），无头派发会话续接（pi 预生成 `--session-id`）

### Security

- 远程 pk 通道安全收敛——authorized_keys 改为 `restrict,command=` 受限条目，forced command 进 pk 新增的 `__ssh_entry` 校验入口（严格白名单 `[env] PK_* <本机 pk> 参数…`，argv 直启自身不经 shell），远程 shim 私钥失陷也拿不到本机 shell；旧裸公钥条目重跑一键配置自动原位升级（REMOTE_PK_CHANNEL_PROPOSAL §8 落地）
- Windows 命令注入面收敛——`cmd /C` 回退逐参改用 cmd 安全引用：`"`/`%`/控制字符中和为全角后整参双引号包裹，飞书消息正文里的 cmd 元字符不再可逃逸（macOS/Linux 路径原本安全，不受影响；交互派发终端随后整体换 PowerShell，见 Features「终端偏好」条目）
- 假名化旁路补齐——AI prompt 的来源标签群名换稳定代号（新增 `feishu_chat_aliases`，群_xxxx，落库前自动还原真实群名）；桌宠问答的任务快照、待办派发 prompt（标题/跟进/项目备注）过同一套假名化规则；开发态 debug 日志不再打印消息原文
- 支持报告脱敏升级——三层脱敏（敏感键名 → 邮箱/凭证值形态 → 本库人名与群名词表），报告里的日志与健康错误不再带出内容类敏感信息
- 导出目标校验——自选路径须扩展名匹配且父目录已存在（不再替任意路径 `create_dir_all`），导入列名白名单校验（拒含引号标识符），收紧被入侵渲染层的任意写原语
- CI 加固——第三方 Actions 全部 pin 到 commit SHA（Renovate 按 `# vX` 注释跟进）、Release 写权限从工作流顶层收敛到具体 job、新增 cargo audit 依赖漏洞扫描
- 零散注入面收敛——全部 ssh argv 的 host 前置 `--` 保护；`pk remote shim --host/--key` 引用后进脚本；lark-cli 授权终端行引用 bin 路径；生产 CSP 剥离 Vite HMR 的 `ws://localhost:1420` 与死配置 `asset:`（开发态经 `devCsp` 保留）

## [1.0.0](https://github.com/Jo0OCTsai/pokemon-choose-you/compare/pokemon-choose-you-v0.1.0...pokemon-choose-you-v1.0.0) (2026-09-13)


### ⚠ BREAKING CHANGES

* **backend:** AppError 统一错误、命令分域与常驻插件接入

### Features

* 收音机判定全链路假名化——真名不进大模型，归属判断交给确定性标注 ([5db5625](https://github.com/Jo0OCTsai/pokemon-choose-you/commit/5db5625d47c1bd990d8b7407161b62096ee92559))
* 桌宠台词瞬态化——气泡按时长自动淡出、悬停暂停、点击收起，快捷图鉴屏改悬停☰钮唤出 ([7ff45ea](https://github.com/Jo0OCTsai/pokemon-choose-you/commit/7ff45ea5894cd17f34b723e339668ca09b23eace))
* 收音机人工裁决显影——已逃走亮出 AI 原判与逃走原因，原因弹层上弹不再溢出 ([8eb4a2e](https://github.com/Jo0OCTsai/pokemon-choose-you/commit/8eb4a2efe4e8cefe3da179e181266dced6f26e42))
* 收音机判定失败可重判——超时挽救已落库判定，error 消息批量重送 AI ([810372e](https://github.com/Jo0OCTsai/pokemon-choose-you/commit/810372e123f1d1f3e6d60874d24df25404f4cf6c))
* 项目标签 agent 派发表单抽成独立「项目派发」卡片，修复维度下拉盖住保存按钮 ([06f55e6](https://github.com/Jo0OCTsai/pokemon-choose-you/commit/06f55e675668a86dfccc666878d76ef98dddbcbe))
* release macOS 包稳定签名——自签证书(Apple 命名格式)固定身份，TCC 授权跨版本存活 ([2b5b16c](https://github.com/Jo0OCTsai/pokemon-choose-you/commit/2b5b16cc86a8c30b27618588d8b8bf6c63f0771a))
* macOS dev 稳定签名——自签证书 + cargo runner 自动重签，辅助功能授权跨编译存活 ([4e6a98c](https://github.com/Jo0OCTsai/pokemon-choose-you/commit/4e6a98c1d5c32246404af51115b592ac823ee87a))
* 桌宠体验升级——输入响应/AI 对话/时刻台词/边缘栖息/连胜演出/陪跑精灵/语音 ([5d70856](https://github.com/Jo0OCTsai/pokemon-choose-you/commit/5d70856b7e357f8d2a97a1a37a6e91b001f5d989))
* 快速捕捉收拢收音机——移除任务页创建表单，一句话经 AI agent 判定属性建待办 ([004c8d7](https://github.com/Jo0OCTsai/pokemon-choose-you/commit/004c8d7d71d7ba9e82e79346ca3bee677c7b4941))
* 待办派发体系 M1–M3——标签路由到 agent/机器/工作目录，交互/无头双通道与状态回传 ([e0f4e62](https://github.com/Jo0OCTsai/pokemon-choose-you/commit/e0f4e62f21519696fef7fc6b0e3e01d65ad068de))
* agent 能力增强——多实例辨识、SSH 远程历史修复、会话回链预设升级、技能检查同步与设置页优化 ([15ee10b](https://github.com/Jo0OCTsai/pokemon-choose-you/commit/15ee10b8ebdb000e6673ac716eebc47a798fda10))
* 设计焕新 v2 落地 + 设置页说明文字四层归位与 AI agent 修复 + design 目录整理 ([1fd573b](https://github.com/Jo0OCTsai/pokemon-choose-you/commit/1fd573be52e665463d84dda71ac0db46b15484d7))
* 标签体系维度化 + AI 自动打标与体检治理；下线 Todoist 与 AI text 模式 ([3348e4b](https://github.com/Jo0OCTsai/pokemon-choose-you/commit/3348e4bff591068822a4928d82506f427145dfe4))
* 收音机收件箱式分诊改版 + 飞书归属/判重修复 + agent 固定工作目录 ([4a5bfd](https://github.com/Jo0OCTsai/pokemon-choose-you/commit/4a5bfdac0345cd02393404e010b52220628670b7))
* 应用更名 POKéMON Choose You，中文系统显示「就决定是你了」 ([f6986d2](https://github.com/Jo0OCTsai/pokemon-choose-you/commit/f6986d236aa05d9297be8de5055e8680dc12ced5))
* 「先试 5 分钟」启动模式——零挫败入场券，到期不接休息 ([d777294](https://github.com/Jo0OCTsai/pokemon-choose-you/commit/d77729433ed1a5ac0d1b9638c03aef06027b817c))
* agent CLI 支持 SSH 远程执行——无头调用与历史入口经 ssh 转发 ([96d2be9](https://github.com/Jo0OCTsai/pokemon-choose-you/commit/96d2be91207930cd951465d3560aaf5b39922deb))
* agent 会话回链与成本记录——分类调用自动落库，pk session 关联任务，弹窗可回放转录 ([21cc64c](https://github.com/Jo0OCTsai/pokemon-choose-you/commit/21cc64ce1ca0b05f283f59a7d6e393d70871e057))
* **api:** IPC 错误分层与前后端事件名契约 ([1615747](https://github.com/Jo0OCTsai/pokemon-choose-you/commit/16157474a01ab668103f52a59cf77a6653712d50))
* **config:** 启用 CSP 与自动更新配置 ([b9b1de6](https://github.com/Jo0OCTsai/pokemon-choose-you/commit/b9b1de63d6fee2f5d80bf96138834e08ec2bca18))
* pk skill install 一键分发 agent 技能（含命令速查与建议流程） ([68ac2e5](https://github.com/Jo0OCTsai/pokemon-choose-you/commit/68ac2e5afd835571638128cd861aafd240059236))
* **security:** capabilities 按窗口最小权限拆分 ([0605d3f](https://github.com/Jo0OCTsai/pokemon-choose-you/commit/0605d3f540651aaca26d415c0a3f198fd1ff09f8))
* 任务体系升级与飞书用户身份改版 ([d5049e1](https://github.com/Jo0OCTsai/pokemon-choose-you/commit/d5049e19591085dbfbaa0cf970832bae51f920f7))
* 分类支持停用并修复设置页分类列表为空的问题 ([c7d84e4](https://github.com/Jo0OCTsai/pokemon-choose-you/commit/c7d84e4a4c66a92d6233a3abdcd5b01d6788b8f1))
* 强化任务状态机：草丛归位不变量、逃走状态、操作日志与页面规则调整 ([02705d9](https://github.com/Jo0OCTsai/pokemon-choose-you/commit/02705d967885439226841555560a834576daa5e3))
* 收音机 AI 建议附判定理由与置信档位，逃走可选原因码并落反馈库 ([cf50d9b](https://github.com/Jo0OCTsai/pokemon-choose-you/commit/cf50d9be5a39b8ac0ea7250b5af3da6d5ad6c7bd))
* 收音机批量分诊与诊断中心（集成健康 / 日志 / 支持报告） ([ea9fe14](https://github.com/Jo0OCTsai/pokemon-choose-you/commit/ea9fe1424777be5d1b3dbdefca24352e0fc9face))
* 收音机批量分诊与诊断中心（集成健康/日志/支持报告） ([2fcb8a5](https://github.com/Jo0OCTsai/pokemon-choose-you/commit/2fcb8a58b3b8da49a1e69489598e6e4adc52c2fe))
* 改用 AI agent CLI 调用并提供 pk 命令行，移除链路观测 ([2f17019](https://github.com/Jo0OCTsai/pokemon-choose-you/commit/2f17019a444c35b48074a7029962922fbb116a03))
* 数据导出/导入三件套——全量 JSON 往返、任务 CSV、日报 Markdown ([3360d04](https://github.com/Jo0OCTsai/pokemon-choose-you/commit/3360d04af3a671e46aee5ea37f66c7ef3e27cb46))
* 新建任务去向由是否设置时间决定，移除草丛/路线开关 ([4416a83](https://github.com/Jo0OCTsai/pokemon-choose-you/commit/4416a838c588521e3d9b64fcb378b2a77d78a1df))
* 标签系统、待办全字段编辑与跟进记录、AI 判重全属性、收音机全量电波与 AI 链路观测 ([5c59c3f](https://github.com/Jo0OCTsai/pokemon-choose-you/commit/5c59c3fa0ae5a84e59e25769f182cc3d0eab5d24))
* 桌宠就近可操作提醒——气泡带完成/推迟动作，免开主面板 ([7994adf](https://github.com/Jo0OCTsai/pokemon-choose-you/commit/7994adf666631f482de4b3ca87d1e1730353abc0))
* 每周复盘向导（训练师复盘）——路线逐站处置、草丛批量归位、每周提醒 ([1266ed7](https://github.com/Jo0OCTsai/pokemon-choose-you/commit/1266ed75f3586011be0de95e12f79e78a49e8722))
* 环境化倒计时——桌宠剩余时间色环、尾段焦急动画、长番茄钟轻提示音 ([c3481bf](https://github.com/Jo0OCTsai/pokemon-choose-you/commit/c3481bf35d5725da2fd98b45a216f3ebf2d4e110))
* 相对截止时间——距现在的距离五档分色显示，悬停见绝对值，可关 ([3f07747](https://github.com/Jo0OCTsai/pokemon-choose-you/commit/3f0774724a05c9e2ddbeb1bac2914f4c93d544ed))
* 秘钥迁 OS 钥匙串（keyring），无钥匙串环境回落本地库 ([e1e7582](https://github.com/Jo0OCTsai/pokemon-choose-you/commit/e1e7582cfd0d9d5c7c7a2de4644b99f34c76f4c3))
* 自动版本化备份——VACUUM INTO 每日快照滚动保留，设置页可备份与恢复 ([103d300](https://github.com/Jo0OCTsai/pokemon-choose-you/commit/103d300eb21312d57fb282f5de236e5cbda1550d))
* 自然语言快速捕捉——输入框解析时间/分类/标签，预览可取消、全局可关 ([97f9ba2](https://github.com/Jo0OCTsai/pokemon-choose-you/commit/97f9ba2e126fd66d2fe638a9f4d3b1ea43e57af4))
* 调整设置页与修改时间弹窗布局 ([4a95cfc](https://github.com/Jo0OCTsai/pokemon-choose-you/commit/4a95cfcbb091c1fc32b709b55ec8eeebb12f627a))
* 逾期 fresh start——冒险页折叠羞耻墙，一键/每日自动归草丛 ([bd7073c](https://github.com/Jo0OCTsai/pokemon-choose-you/commit/bd7073c84ac3150c712b6ede1874cb2f6eb6f0d7))
* 飞书拉取引擎可切换——官方 lark-cli（api --format json，凭证自管）与内置直连并存 ([03518b0](https://github.com/Jo0OCTsai/pokemon-choose-you/commit/03518b0392a906a98b3db67b6c13957b89137a11))
* 飞书用户身份改版与 AI 动作扩展 ([65edfad](https://github.com/Jo0OCTsai/pokemon-choose-you/commit/65edfad8c77da98eb11da668ea795e8ec221c5ce))


### Bug Fixes

* 逃走原因弹层选项点不中——背板挪到操作区之前，DOM 顺序与 z 双保险 ([69bc5a1](https://github.com/Jo0OCTsai/pokemon-choose-you/commit/69bc5a1eb2cffbeddc622a55f1069126badc1be3))
* spawn 兜底 ETXTBSY 退避重试——根治 CI 偶发 Text file busy 竞态 ([1618294](https://github.com/Jo0OCTsai/pokemon-choose-you/commit/16182941791a2f24e9ee55c770c12105c0d0a007))
* 输入响应 macOS 自写 CGEventTap 取代 rdev——授权后敲键段错误闪退 ([0bae75d](https://github.com/Jo0OCTsai/pokemon-choose-you/commit/0bae75d8f0061fea5792b1c36c61f8fc85870c5f))
* 输入响应授权引导改直达设置面板——这版 macOS 已禁 AX 官方弹窗 ([5179120](https://github.com/Jo0OCTsai/pokemon-choose-you/commit/5179120d39fe23f0515220e0fa3a6480960f7e69))
* 输入响应授权体验——系统弹窗引导勾选本应用、保存反馈不被权限提示吞掉、授权后免重启生效 ([fefd60e](https://github.com/Jo0OCTsai/pokemon-choose-you/commit/fefd60e9acf1e300e17d54816f24b7e0c05d4c34))
* 收音机按频道模式组头点击无效——补上 collapsed class 使分组可收起 ([b85bca0](https://github.com/Jo0OCTsai/pokemon-choose-you/commit/b85bca04e32b087aee520cf471d78b4908ea780c))
* 修复 GUI 精简 PATH 下 env node 找不到——lark-cli/agent 脚本目录补进子进程 PATH ([8c756fc](https://github.com/Jo0OCTsai/pokemon-choose-you/commit/8c756fcd4bb96ccf228e1f1a7df24417a50f0df7))
* **deps:** update rust dependencies ([5fb2cce](https://github.com/Jo0OCTsai/pokemon-choose-you/commit/5fb2cceb4584a03e1b5a0288fdfccb8650c43c15))
* **deps:** update npm dependencies ([3130809](https://github.com/Jo0OCTsai/pokemon-choose-you/commit/3130809c6cf88d31d422c4df245d93502692419a))
* **deps:** update rust crate dirs to v7 ([8e0a2e5](https://github.com/Jo0OCTsai/pokemon-choose-you/commit/8e0a2e51c6d47b02edc2bb5a1fa83f219279c961))
* bundle targets 显式列表去掉 MSI，Windows 只出 NSIS ([6f8d027](https://github.com/Jo0OCTsai/pokemon-choose-you/commit/6f8d027459d9c4d06b6b4d7628b95f3662bd2d7c))
* bundle targets 补 app 目标，恢复 macOS 更新包产出 ([9a88583](https://github.com/Jo0OCTsai/pokemon-choose-you/commit/9a885837a4eb9baa525a022a50245bce05c561d3))
* **ci:** 首版固定 0.1.0 并豁免 tauri.conf.json 格式检查 ([9db6fe2](https://github.com/Jo0OCTsai/pokemon-choose-you/commit/9db6fe27bea922c20091e116096eef64a2179d16))
* default-run 显式指定主程序，修复 release 包打入 pk CLI ([1dae24f](https://github.com/Jo0OCTsai/pokemon-choose-you/commit/1dae24f298a0b3d956602988c1b1fd371273a709))
* **deps:** update npm dependencies ([8809192](https://github.com/Jo0OCTsai/pokemon-choose-you/commit/88091925d9ffd2c040eaa742287dbef11712363e))
* lark-cli 断言参数与 i18n 文案 @ 转义 ([c442b11](https://github.com/Jo0OCTsai/pokemon-choose-you/commit/c442b11633d4ab317001df4f5b6668dc8129a3cd))
* lark-cli 断言参数与 i18n 文案 @ 转义（补上 [#34](https://github.com/Jo0OCTsai/pokemon-choose-you/issues/34) 合并时丢失的修复） ([928271b](https://github.com/Jo0OCTsai/pokemon-choose-you/commit/928271b96f0d05ee4f03725565d9d41151b8bbcf))
* release 打包主程序错选 pk CLI，补 default-run 与 universal lipo ([5a424ac](https://github.com/Jo0OCTsai/pokemon-choose-you/commit/5a424ac9f2232a3e55e3e670df902e90e9c8e549))
* ssh 占位符 user@host 的 @ 转义 ([6715d56](https://github.com/Jo0OCTsai/pokemon-choose-you/commit/6715d56d830922273c65394b08bee5ed488d22dc))
* ssh 占位符 user@host 的 @ 转义，消除 vue-i18n 编译警告 ([730dc8e](https://github.com/Jo0OCTsai/pokemon-choose-you/commit/730dc8ef16c0d00c679cef56bd24eecb72087dd9))
* universal sidecar 双架构构建后 lipo 合成胖二进制 ([3f6a4f6](https://github.com/Jo0OCTsai/pokemon-choose-you/commit/3f6a4f63acac5efd38bf85d5bafd8c65e52bc45b))
* universal 构建将 pk 胖二进制补进 target 目录，macOS .app 打包不再缺文件 ([4aad883](https://github.com/Jo0OCTsai/pokemon-choose-you/commit/4aad8832cebf72d1ce73c4c319277a8d3e843da9))
* 修复 macOS/Windows 的 release 编译错误 ([ced89ee](https://github.com/Jo0OCTsai/pokemon-choose-you/commit/ced89ee51bf1d5eb0adc0fcd64fba3d965f8f281))
* 修复 release 打包的 pk sidecar（Windows .exe 占位与 universal 目标） ([b1e4d1c](https://github.com/Jo0OCTsai/pokemon-choose-you/commit/b1e4d1c162545d1e1004f079a7349608b40cf346))
* 修复飞书消息拉取时间戳单位错误并完善链路日志 ([e7a2a8e](https://github.com/Jo0OCTsai/pokemon-choose-you/commit/e7a2a8ee02d4221cee913e5a81ee93b03d205c50))
* 占位 sidecar 的 Windows .exe 判断改用 TARGET 三元组 ([c61e81e](https://github.com/Jo0OCTsai/pokemon-choose-you/commit/c61e81e058fd1b69cd2c8fb1c482b104fe29667a))
* 日期时间选择器的下拉箭头固定贴选择框右缘 ([0473cbb](https://github.com/Jo0OCTsai/pokemon-choose-you/commit/0473cbb896eab75919d6b433e83bc8fe80af77b8))
* 调试配置适配 LLVM 官方 lldb-dap 扩展 ([a2ca06d](https://github.com/Jo0OCTsai/pokemon-choose-you/commit/a2ca06d4b7a904638652136187100c028e8dec88))


### Code Refactoring

* **backend:** AppError 统一错误、命令分域与常驻插件接入 ([3ddedb5](https://github.com/Jo0OCTsai/pokemon-choose-you/commit/3ddedb5e80d043627397caa405f3bd08ebc8bba9))

## [Unreleased]

### Added

- **远程 pk 常驻通道（方案 A+B）**：远程 SSH agent 场景下 pk 回传链路的可靠性与可用性升级——① shim 增加 ControlMaster 连接复用（首调建主连接，会话内后续调用毫秒级，弱网失败率大降，重跑「一键配置远程 pk」即升级旧 shim）；② agent 配置新增「常驻隧道」开关：应用驻留期间自持 `ssh -N -R` 长连（ServerAliveInterval 10s×3 自愈、ExitOnForwardFailure 杜绝假隧道、1s→30s 指数退避重连，按主机+端口+密钥+隧道端口去重共享），tmux 常驻会话/手动 ssh 等远程任何进程随时可调 pk，不再受「应用发起调用的存活窗口」限制；设置页实时显示隧道状态（已连通/建立中/重连中，附 ssh 报错尾行）；③ 无头调用注入的 `PK_DISPATCH_TASK`/`PK_LOG_FILE` 经远端命令行 + shim 转发跨过 ssh 边界（派发回传兜底与执行轨迹回写远程照常生效；Windows 本机 sshd 的 cmd shell 无 env 命令，此透传不生效）。设计全貌见 `docs/proposals/REMOTE_PK_CHANNEL_PROPOSAL.md`。
- **会话过滤偏好**：飞书免打扰从唯一过滤依据降级为默认值——设置 → 集成 → 「会话过滤」卡片逐会话三态（跟随免打扰（默认）/ 总是拉取 / 总是过滤），手动覆盖后以本应用为准；每轮落拉取快照（含生效状态与来源、免打扰查询失败逐会话降级标示）；偏好即时生效、导出导入可恢复；顺手补上拉取 in-flight 守卫（轮询与「立即拉取」并发防护，既有缺口）。
- **常驻应用标配**：系统托盘（打开图鉴机 / 显示隐藏桌宠 / 设置 / 检查更新 / 退出）、单实例保护、窗口位置记忆、全局快捷键（`Ctrl/Cmd+Shift+K` 快速捕捉待办、`Ctrl/Cmd+Shift+D` 显示/隐藏桌宠）、自动更新（minisign 签名，托盘与设置页入口）。
- **工程链**：ESLint（flat）+ Prettier + lefthook + commitlint + release-please + Renovate；CI 增加 clippy/fmt/lint 关卡。
- **架构补强**：命令统一 `AppError`（kind/retryable，前端 api.ts 分层捕获）；SQLite 启用 `PRAGMA user_version` 迁移；事件名前后端契约测试；wiremock 覆盖 AI/飞书/Todoist 的 HTTP 分支。
- **目录重构**：前端拆出 `components/ views/ stores(Pinia)/composables/`；后端 `commands/` 按域拆分。
- **安全合规**：LICENSE（代码 MIT + 素材非商用声明）、CSP、capabilities 按窗口最小权限、`.zcode/` 出库。

### Fixed

- Todoist 同步两个生产缺陷：`ON CONFLICT(external_id)` 未匹配部分唯一索引导致拉取必然失败；关闭远端任务的 SQL 误用 `sync_state.value` 列名（实际为 `cursor`）。
- 远端关闭任务时非 2xx 响应不再计入成功计数。

## 0.1.0 — 2026-09

首个可用版本：桌宠 + 图鉴机两窗口、任务 CRUD 与专注模式、番茄钟、分级提醒、飞书 AI 收音机、Todoist 双向同步、三语界面、跨平台打包。
