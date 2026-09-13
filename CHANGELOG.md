# Changelog

所有重要变更记录于此。格式遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，
版本号遵循 [Semantic Versioning](https://semver.org/lang/zh-CN/)。
本文件由 release-please 自动维护——合并 release PR 时更新，请勿手工编辑已发布段落。

## [2.0.0](https://github.com/Jo0OCTsai/pokemon-choose-you/compare/v1.0.0...v2.0.0) (2026-09-13)


### ⚠ BREAKING CHANGES

* **backend:** AppError 统一错误、命令分域与常驻插件接入

### Features

* 「先试 5 分钟」启动模式——零挫败入场券，到期不接休息 ([a2ce8e5](https://github.com/Jo0OCTsai/pokemon-choose-you/commit/a2ce8e5847b6be0264a331480cd4e5cd07c0d9e1))
* 「先试 5 分钟」启动模式——零挫败入场券，到期不接休息 ([d777294](https://github.com/Jo0OCTsai/pokemon-choose-you/commit/d77729433ed1a5ac0d1b9638c03aef06027b817c))
* 「加入路线」操作收进草丛页（其他页面隐藏表单时间选择器与卡片 📅） ([06def6f](https://github.com/Jo0OCTsai/pokemon-choose-you/commit/06def6fb1da4a060b45d224b4df7f02bc975455a))
* agent CLI 支持 SSH 远程执行——无头调用与历史入口经 ssh 转发 ([aefba50](https://github.com/Jo0OCTsai/pokemon-choose-you/commit/aefba507ed4e666955faf639afeb640418f92489))
* agent CLI 支持 SSH 远程执行——无头调用与历史入口经 ssh 转发 ([96d2be9](https://github.com/Jo0OCTsai/pokemon-choose-you/commit/96d2be91207930cd951465d3560aaf5b39922deb))
* agent 会话回链与成本记录——分类调用自动落库，pk session 关联任务，弹窗可回放转录 ([606098f](https://github.com/Jo0OCTsai/pokemon-choose-you/commit/606098f4fcbd182bfcc986ab5892a973286052ae))
* agent 会话回链与成本记录——分类调用自动落库，pk session 关联任务，弹窗可回放转录 ([21cc64c](https://github.com/Jo0OCTsai/pokemon-choose-you/commit/21cc64ce1ca0b05f283f59a7d6e393d70871e057))
* AI 分类工具调用模式——agent 经 pk suggest 落库、应用回读，替代解析输出文本 ([2343d16](https://github.com/Jo0OCTsai/pokemon-choose-you/commit/2343d1672c155a6758f79e645a215ec9d9976cc1))
* AI 分类工具调用模式——agent 经 pk 落库、应用回读，替代解析输出文本 ([d02fb68](https://github.com/Jo0OCTsai/pokemon-choose-you/commit/d02fb68e5fde1b42dd5f3aa566ded43d11ee68fa))
* **api:** IPC 错误分层与前后端事件名契约 ([1615747](https://github.com/Jo0OCTsai/pokemon-choose-you/commit/16157474a01ab668103f52a59cf77a6653712d50))
* **config:** 启用 CSP 与自动更新配置 ([b9b1de6](https://github.com/Jo0OCTsai/pokemon-choose-you/commit/b9b1de63d6fee2f5d80bf96138834e08ec2bca18))
* pk skill install 一键分发 agent 技能（含命令速查与建议流程） ([4c34f48](https://github.com/Jo0OCTsai/pokemon-choose-you/commit/4c34f48a942bf58dc90a61d2c009c1800f714419))
* pk skill install 一键分发 agent 技能（含命令速查与建议流程） ([68ac2e5](https://github.com/Jo0OCTsai/pokemon-choose-you/commit/68ac2e5afd835571638128cd861aafd240059236))
* pk 的 agent 友好性四件套——doctor 自检、--dry-run、list --limit、help --json ([09fad0e](https://github.com/Jo0OCTsai/pokemon-choose-you/commit/09fad0e22e18f002bb36f1a15e476b92187654cc))
* **security:** capabilities 按窗口最小权限拆分 ([0605d3f](https://github.com/Jo0OCTsai/pokemon-choose-you/commit/0605d3f540651aaca26d415c0a3f198fd1ff09f8))
* 任务体系升级与飞书用户身份改版 ([d5049e1](https://github.com/Jo0OCTsai/pokemon-choose-you/commit/d5049e19591085dbfbaa0cf970832bae51f920f7))
* 分类支持停用并修复设置页分类列表为空的问题 ([c7d84e4](https://github.com/Jo0OCTsai/pokemon-choose-you/commit/c7d84e4a4c66a92d6233a3abdcd5b01d6788b8f1))
* 强化任务状态机：草丛归位不变量、逃走状态、操作日志与页面规则调整 ([02705d9](https://github.com/Jo0OCTsai/pokemon-choose-you/commit/02705d967885439226841555560a834576daa5e3))
* 收音机 AI 建议附判定理由与置信档位，逃走可选原因码并落反馈库 ([4b9ca67](https://github.com/Jo0OCTsai/pokemon-choose-you/commit/4b9ca6788d5ca4687bd26570b8e66cb27d406ab7))
* 收音机 AI 建议附判定理由与置信档位，逃走可选原因码并落反馈库 ([cf50d9b](https://github.com/Jo0OCTsai/pokemon-choose-you/commit/cf50d9be5a39b8ac0ea7250b5af3da6d5ad6c7bd))
* 收音机批量分诊与诊断中心（集成健康 / 日志 / 支持报告） ([ea9fe14](https://github.com/Jo0OCTsai/pokemon-choose-you/commit/ea9fe1424777be5d1b3dbdefca24352e0fc9face))
* 收音机批量分诊与诊断中心（集成健康/日志/支持报告） ([2fcb8a5](https://github.com/Jo0OCTsai/pokemon-choose-you/commit/2fcb8a58b3b8da49a1e69489598e6e4adc52c2fe))
* 改用 AI agent CLI 调用并提供 pk 命令行，移除链路观测 ([7286884](https://github.com/Jo0OCTsai/pokemon-choose-you/commit/7286884c2f58905c7ff75ccad3e69c4f5acdd31b))
* 改用 AI agent CLI 调用并提供 pk 命令行，移除链路观测 ([2f17019](https://github.com/Jo0OCTsai/pokemon-choose-you/commit/2f17019a444c35b48074a7029962922fbb116a03))
* 数据导出/导入三件套——全量 JSON 往返、任务 CSV、日报 Markdown ([63ced12](https://github.com/Jo0OCTsai/pokemon-choose-you/commit/63ced126ecb330cfcecdf959109c233f91a91b3d))
* 数据导出/导入三件套——全量 JSON 往返、任务 CSV、日报 Markdown ([3360d04](https://github.com/Jo0OCTsai/pokemon-choose-you/commit/3360d04af3a671e46aee5ea37f66c7ef3e27cb46))
* 新建任务去向由是否设置时间决定，移除草丛/路线开关 ([4416a83](https://github.com/Jo0OCTsai/pokemon-choose-you/commit/4416a838c588521e3d9b64fcb378b2a77d78a1df))
* 更名「就决定是你了」（pokemon-knock → pokemon-choose-you）——文案视角体系与标识层一次性切换 ([#49](https://github.com/Jo0OCTsai/pokemon-choose-you/issues/49)) ([a9f107d](https://github.com/Jo0OCTsai/pokemon-choose-you/commit/a9f107d489e78cb4fe5553924187214fc74b01ec))
* 标签系统、待办全字段编辑与跟进记录、AI 判重全属性、收音机全量电波与 AI 链路观测 ([5c59c3f](https://github.com/Jo0OCTsai/pokemon-choose-you/commit/5c59c3fa0ae5a84e59e25769f182cc3d0eab5d24))
* 桌宠就近可操作提醒——气泡带完成/推迟动作，免开主面板 ([297dfb4](https://github.com/Jo0OCTsai/pokemon-choose-you/commit/297dfb40604a76fe767cb2aba27d0503dedf1951))
* 桌宠就近可操作提醒——气泡带完成/推迟动作，免开主面板 ([7994adf](https://github.com/Jo0OCTsai/pokemon-choose-you/commit/7994adf666631f482de4b3ca87d1e1730353abc0))
* 每周复盘向导（训练师复盘）——路线逐站处置、草丛批量归位、每周提醒 ([df9e712](https://github.com/Jo0OCTsai/pokemon-choose-you/commit/df9e7124e33307840eda8c6c7280e33864789f15))
* 每周复盘向导（训练师复盘）——路线逐站处置、草丛批量归位、每周提醒 ([1266ed7](https://github.com/Jo0OCTsai/pokemon-choose-you/commit/1266ed75f3586011be0de95e12f79e78a49e8722))
* 点击任务卡片打开详情抽屉（属性总览 + 跟进记录/Agent 执行/操作历史迁入），编辑弹窗瘦身为纯表单 ([647b31b](https://github.com/Jo0OCTsai/pokemon-choose-you/commit/647b31b45102c2eb2edeb3006ca6a1e3cd2752b5))
* 环境化倒计时——桌宠剩余时间色环、尾段焦急动画、长番茄钟轻提示音 ([72adbe4](https://github.com/Jo0OCTsai/pokemon-choose-you/commit/72adbe42071aa712056d6665f5d6fbec87e75a91))
* 环境化倒计时——桌宠剩余时间色环、尾段焦急动画、长番茄钟轻提示音 ([c3481bf](https://github.com/Jo0OCTsai/pokemon-choose-you/commit/c3481bf35d5725da2fd98b45a216f3ebf2d4e110))
* 相对截止时间——距现在的距离五档分色显示，悬停见绝对值，可关 ([2cda53e](https://github.com/Jo0OCTsai/pokemon-choose-you/commit/2cda53e56cafe5eead0f7dfac5aea6d8124e0532))
* 相对截止时间——距现在的距离五档分色显示，悬停见绝对值，可关 ([3f07747](https://github.com/Jo0OCTsai/pokemon-choose-you/commit/3f0774724a05c9e2ddbeb1bac2914f4c93d544ed))
* 秘钥迁 OS 钥匙串（keyring），无钥匙串环境回落本地库 ([4bd68a7](https://github.com/Jo0OCTsai/pokemon-choose-you/commit/4bd68a70d4085c0c34eaab9e3419a8e2f43a5302))
* 秘钥迁 OS 钥匙串（keyring），无钥匙串环境回落本地库 ([e1e7582](https://github.com/Jo0OCTsai/pokemon-choose-you/commit/e1e7582cfd0d9d5c7c7a2de4644b99f34c76f4c3))
* 自动版本化备份——VACUUM INTO 每日快照滚动保留，设置页可备份与恢复 ([980c0eb](https://github.com/Jo0OCTsai/pokemon-choose-you/commit/980c0eb768d090664fc124eec45b9087a69d7955))
* 自动版本化备份——VACUUM INTO 每日快照滚动保留，设置页可备份与恢复 ([103d300](https://github.com/Jo0OCTsai/pokemon-choose-you/commit/103d300eb21312d57fb282f5de236e5cbda1550d))
* 自然语言快速捕捉——输入框解析时间/分类/标签，预览可取消、全局可关 ([721f630](https://github.com/Jo0OCTsai/pokemon-choose-you/commit/721f6304929d4ee93b4abfae541987128231ebf4))
* 自然语言快速捕捉——输入框解析时间/分类/标签，预览可取消、全局可关 ([97f9ba2](https://github.com/Jo0OCTsai/pokemon-choose-you/commit/97f9ba2e126fd66d2fe638a9f4d3b1ea43e57af4))
* 调整设置页与修改时间弹窗布局 ([4a95cfc](https://github.com/Jo0OCTsai/pokemon-choose-you/commit/4a95cfcbb091c1fc32b709b55ec8eeebb12f627a))
* 逾期 fresh start——冒险页折叠羞耻墙，一键/每日自动归草丛 ([b906ee8](https://github.com/Jo0OCTsai/pokemon-choose-you/commit/b906ee86636f7c921112cabc1569244b22144ebe))
* 逾期 fresh start——冒险页折叠羞耻墙，一键/每日自动归草丛 ([bd7073c](https://github.com/Jo0OCTsai/pokemon-choose-you/commit/bd7073c84ac3150c712b6ede1874cb2f6eb6f0d7))
* 飞书拉取引擎可切换——官方 lark-cli（api --format json，凭证自管）与内置直连并存 ([28690a0](https://github.com/Jo0OCTsai/pokemon-choose-you/commit/28690a0b329e3ebab48683c46813f98a9979d550))
* 飞书拉取引擎可切换——官方 lark-cli（api --format json，凭证自管）与内置直连并存 ([03518b0](https://github.com/Jo0OCTsai/pokemon-choose-you/commit/03518b0392a906a98b3db67b6c13957b89137a11))
* 飞书用户身份改版与 AI 动作扩展 ([65edfad](https://github.com/Jo0OCTsai/pokemon-choose-you/commit/65edfad8c77da98eb11da668ea795e8ec221c5ce))


### Bug Fixes

* bundle targets 显式列表去掉 MSI，Windows 只出 NSIS ([775e01b](https://github.com/Jo0OCTsai/pokemon-choose-you/commit/775e01b0aafa9e5a67157fe6ff05803dd55301df))
* bundle targets 显式列表去掉 MSI，Windows 只出 NSIS ([6f8d027](https://github.com/Jo0OCTsai/pokemon-choose-you/commit/6f8d027459d9c4d06b6b4d7628b95f3662bd2d7c))
* bundle targets 补 app 目标，恢复 macOS 更新包产出 ([2af64e8](https://github.com/Jo0OCTsai/pokemon-choose-you/commit/2af64e89fa95bc005c21baa27a2a055802acf2a3))
* bundle targets 补 app 目标，恢复 macOS 更新包产出 ([9a88583](https://github.com/Jo0OCTsai/pokemon-choose-you/commit/9a885837a4eb9baa525a022a50245bce05c561d3))
* **ci:** 首版固定 0.1.0 并豁免 tauri.conf.json 格式检查 ([9db6fe2](https://github.com/Jo0OCTsai/pokemon-choose-you/commit/9db6fe27bea922c20091e116096eef64a2179d16))
* default-run 显式指定主程序，修复 release 包打入 pk CLI ([1dae24f](https://github.com/Jo0OCTsai/pokemon-choose-you/commit/1dae24f298a0b3d956602988c1b1fd371273a709))
* **deps:** update npm dependencies ([f1c1be4](https://github.com/Jo0OCTsai/pokemon-choose-you/commit/f1c1be48f19486d00b8e540f56c7bc71cb185de7))
* **deps:** update npm dependencies ([8809192](https://github.com/Jo0OCTsai/pokemon-choose-you/commit/88091925d9ffd2c040eaa742287dbef11712363e))
* lark-cli 引擎适配 1.x CLI（auth status --json、首跑 config init、无终端时给出手动命令） ([92f8a7e](https://github.com/Jo0OCTsai/pokemon-choose-you/commit/92f8a7e32fb6d96b7b7919f3c3338430735ee69c))
* lark-cli 断言参数与 i18n 文案 @ 转义 ([c442b11](https://github.com/Jo0OCTsai/pokemon-choose-you/commit/c442b11633d4ab317001df4f5b6668dc8129a3cd))
* lark-cli 断言参数与 i18n 文案 @ 转义（补上 [#34](https://github.com/Jo0OCTsai/pokemon-choose-you/issues/34) 合并时丢失的修复） ([928271b](https://github.com/Jo0OCTsai/pokemon-choose-you/commit/928271b96f0d05ee4f03725565d9d41151b8bbcf))
* release 打包主程序错选 pk CLI，补 default-run 与 universal lipo ([5a424ac](https://github.com/Jo0OCTsai/pokemon-choose-you/commit/5a424ac9f2232a3e55e3e670df902e90e9c8e549))
* ssh 占位符 user@host 的 @ 转义 ([6715d56](https://github.com/Jo0OCTsai/pokemon-choose-you/commit/6715d56d830922273c65394b08bee5ed488d22dc))
* ssh 占位符 user@host 的 @ 转义，消除 vue-i18n 编译警告 ([730dc8e](https://github.com/Jo0OCTsai/pokemon-choose-you/commit/730dc8ef16c0d00c679cef56bd24eecb72087dd9))
* universal sidecar 双架构构建后 lipo 合成胖二进制 ([dfa3b71](https://github.com/Jo0OCTsai/pokemon-choose-you/commit/dfa3b71afe377bdd43a887c2037b9af094bf14f2))
* universal sidecar 双架构构建后 lipo 合成胖二进制 ([3f6a4f6](https://github.com/Jo0OCTsai/pokemon-choose-you/commit/3f6a4f63acac5efd38bf85d5bafd8c65e52bc45b))
* universal 构建将 pk 胖二进制补进 target 目录，macOS .app 打包不再缺文件 ([4aad883](https://github.com/Jo0OCTsai/pokemon-choose-you/commit/4aad8832cebf72d1ce73c4c319277a8d3e843da9))
* 主窗口首拉失败隔离（收音机查询报错不再清空任务列表），事件监听先于首拉注册 ([d50e42e](https://github.com/Jo0OCTsai/pokemon-choose-you/commit/d50e42ea44d58062b5ef487212fda7a04d92b3bd))
* 修复 macOS/Windows 的 release 编译错误 ([ced89ee](https://github.com/Jo0OCTsai/pokemon-choose-you/commit/ced89ee51bf1d5eb0adc0fcd64fba3d965f8f281))
* 修复 release 打包的 pk sidecar（Windows .exe 占位与 universal 目标） ([1ca41aa](https://github.com/Jo0OCTsai/pokemon-choose-you/commit/1ca41aaa0e5b2099bf157e1f518206b069b84380))
* 修复 release 打包的 pk sidecar（Windows .exe 占位与 universal 目标） ([b1e4d1c](https://github.com/Jo0OCTsai/pokemon-choose-you/commit/b1e4d1c162545d1e1004f079a7349608b40cf346))
* 修复飞书消息拉取时间戳单位错误并完善链路日志 ([e7a2a8e](https://github.com/Jo0OCTsai/pokemon-choose-you/commit/e7a2a8ee02d4221cee913e5a81ee93b03d205c50))
* 修正运行日志解析段序颠倒（级别/模块取反）导致 UI 日志列表恒为空 ([7fbe1ce](https://github.com/Jo0OCTsai/pokemon-choose-you/commit/7fbe1ce2d9310c0d2dc6c0c3c14547c2fae690ff))
* 占位 sidecar 的 Windows .exe 判断改用 TARGET 三元组 ([c61e81e](https://github.com/Jo0OCTsai/pokemon-choose-you/commit/c61e81e058fd1b69cd2c8fb1c482b104fe29667a))
* 日期时间选择器的下拉箭头固定贴选择框右缘 ([0473cbb](https://github.com/Jo0OCTsai/pokemon-choose-you/commit/0473cbb896eab75919d6b433e83bc8fe80af77b8))
* 更正 lark-cli 安装命令包名为 @larksuite/cli（文档与界面文案） ([57ba41e](https://github.com/Jo0OCTsai/pokemon-choose-you/commit/57ba41e5f006ae00e5696b2f009a34509921c907))
* 调试配置适配 LLVM 官方 lldb-dap 扩展 ([a2ca06d](https://github.com/Jo0OCTsai/pokemon-choose-you/commit/a2ca06d4b7a904638652136187100c028e8dec88))
* 远程 agent 经登录 shell 执行（ssh 127 附 PATH 指引）；去重 AI 标题机器人图标 ([0b1efa2](https://github.com/Jo0OCTsai/pokemon-choose-you/commit/0b1efa2f06ebadf9c3ac4d333920bffb6920ebb9))
* 飞书拉取补上 p2p 单聊（机器人会话此前从未被轮询），免打扰会话整会话跳过 ([4ec7b40](https://github.com/Jo0OCTsai/pokemon-choose-you/commit/4ec7b405c54b50bcbc4d77fce077910f7266e15e))


### Code Refactoring

* **backend:** AppError 统一错误、命令分域与常驻插件接入 ([3ddedb5](https://github.com/Jo0OCTsai/pokemon-choose-you/commit/3ddedb5e80d043627397caa405f3bd08ebc8bba9))

## [1.0.0](https://github.com/Jo0OCTsai/pokemon-knock/compare/pokemon-knock-v0.1.0...pokemon-knock-v1.0.0) (2026-09-13)


### ⚠ BREAKING CHANGES

* **backend:** AppError 统一错误、命令分域与常驻插件接入

### Features

* 「先试 5 分钟」启动模式——零挫败入场券，到期不接休息 ([d777294](https://github.com/Jo0OCTsai/pokemon-knock/commit/d77729433ed1a5ac0d1b9638c03aef06027b817c))
* agent CLI 支持 SSH 远程执行——无头调用与历史入口经 ssh 转发 ([96d2be9](https://github.com/Jo0OCTsai/pokemon-knock/commit/96d2be91207930cd951465d3560aaf5b39922deb))
* agent 会话回链与成本记录——分类调用自动落库，pk session 关联任务，弹窗可回放转录 ([21cc64c](https://github.com/Jo0OCTsai/pokemon-knock/commit/21cc64ce1ca0b05f283f59a7d6e393d70871e057))
* **api:** IPC 错误分层与前后端事件名契约 ([1615747](https://github.com/Jo0OCTsai/pokemon-knock/commit/16157474a01ab668103f52a59cf77a6653712d50))
* **config:** 启用 CSP 与自动更新配置 ([b9b1de6](https://github.com/Jo0OCTsai/pokemon-knock/commit/b9b1de63d6fee2f5d80bf96138834e08ec2bca18))
* pk skill install 一键分发 agent 技能（含命令速查与建议流程） ([68ac2e5](https://github.com/Jo0OCTsai/pokemon-knock/commit/68ac2e5afd835571638128cd861aafd240059236))
* **security:** capabilities 按窗口最小权限拆分 ([0605d3f](https://github.com/Jo0OCTsai/pokemon-knock/commit/0605d3f540651aaca26d415c0a3f198fd1ff09f8))
* 任务体系升级与飞书用户身份改版 ([d5049e1](https://github.com/Jo0OCTsai/pokemon-knock/commit/d5049e19591085dbfbaa0cf970832bae51f920f7))
* 分类支持停用并修复设置页分类列表为空的问题 ([c7d84e4](https://github.com/Jo0OCTsai/pokemon-knock/commit/c7d84e4a4c66a92d6233a3abdcd5b01d6788b8f1))
* 强化任务状态机：草丛归位不变量、逃走状态、操作日志与页面规则调整 ([02705d9](https://github.com/Jo0OCTsai/pokemon-knock/commit/02705d967885439226841555560a834576daa5e3))
* 收音机 AI 建议附判定理由与置信档位，逃走可选原因码并落反馈库 ([cf50d9b](https://github.com/Jo0OCTsai/pokemon-knock/commit/cf50d9be5a39b8ac0ea7250b5af3da6d5ad6c7bd))
* 收音机批量分诊与诊断中心（集成健康 / 日志 / 支持报告） ([ea9fe14](https://github.com/Jo0OCTsai/pokemon-knock/commit/ea9fe1424777be5d1b3dbdefca24352e0fc9face))
* 收音机批量分诊与诊断中心（集成健康/日志/支持报告） ([2fcb8a5](https://github.com/Jo0OCTsai/pokemon-knock/commit/2fcb8a58b3b8da49a1e69489598e6e4adc52c2fe))
* 改用 AI agent CLI 调用并提供 pk 命令行，移除链路观测 ([2f17019](https://github.com/Jo0OCTsai/pokemon-knock/commit/2f17019a444c35b48074a7029962922fbb116a03))
* 数据导出/导入三件套——全量 JSON 往返、任务 CSV、日报 Markdown ([3360d04](https://github.com/Jo0OCTsai/pokemon-knock/commit/3360d04af3a671e46aee5ea37f66c7ef3e27cb46))
* 新建任务去向由是否设置时间决定，移除草丛/路线开关 ([4416a83](https://github.com/Jo0OCTsai/pokemon-knock/commit/4416a838c588521e3d9b64fcb378b2a77d78a1df))
* 标签系统、待办全字段编辑与跟进记录、AI 判重全属性、收音机全量电波与 AI 链路观测 ([5c59c3f](https://github.com/Jo0OCTsai/pokemon-knock/commit/5c59c3fa0ae5a84e59e25769f182cc3d0eab5d24))
* 桌宠就近可操作提醒——气泡带完成/推迟动作，免开主面板 ([7994adf](https://github.com/Jo0OCTsai/pokemon-knock/commit/7994adf666631f482de4b3ca87d1e1730353abc0))
* 每周复盘向导（训练师复盘）——路线逐站处置、草丛批量归位、每周提醒 ([1266ed7](https://github.com/Jo0OCTsai/pokemon-knock/commit/1266ed75f3586011be0de95e12f79e78a49e8722))
* 环境化倒计时——桌宠剩余时间色环、尾段焦急动画、长番茄钟轻提示音 ([c3481bf](https://github.com/Jo0OCTsai/pokemon-knock/commit/c3481bf35d5725da2fd98b45a216f3ebf2d4e110))
* 相对截止时间——距现在的距离五档分色显示，悬停见绝对值，可关 ([3f07747](https://github.com/Jo0OCTsai/pokemon-knock/commit/3f0774724a05c9e2ddbeb1bac2914f4c93d544ed))
* 秘钥迁 OS 钥匙串（keyring），无钥匙串环境回落本地库 ([e1e7582](https://github.com/Jo0OCTsai/pokemon-knock/commit/e1e7582cfd0d9d5c7c7a2de4644b99f34c76f4c3))
* 自动版本化备份——VACUUM INTO 每日快照滚动保留，设置页可备份与恢复 ([103d300](https://github.com/Jo0OCTsai/pokemon-knock/commit/103d300eb21312d57fb282f5de236e5cbda1550d))
* 自然语言快速捕捉——输入框解析时间/分类/标签，预览可取消、全局可关 ([97f9ba2](https://github.com/Jo0OCTsai/pokemon-knock/commit/97f9ba2e126fd66d2fe638a9f4d3b1ea43e57af4))
* 调整设置页与修改时间弹窗布局 ([4a95cfc](https://github.com/Jo0OCTsai/pokemon-knock/commit/4a95cfcbb091c1fc32b709b55ec8eeebb12f627a))
* 逾期 fresh start——冒险页折叠羞耻墙，一键/每日自动归草丛 ([bd7073c](https://github.com/Jo0OCTsai/pokemon-knock/commit/bd7073c84ac3150c712b6ede1874cb2f6eb6f0d7))
* 飞书拉取引擎可切换——官方 lark-cli（api --format json，凭证自管）与内置直连并存 ([03518b0](https://github.com/Jo0OCTsai/pokemon-knock/commit/03518b0392a906a98b3db67b6c13957b89137a11))
* 飞书用户身份改版与 AI 动作扩展 ([65edfad](https://github.com/Jo0OCTsai/pokemon-knock/commit/65edfad8c77da98eb11da668ea795e8ec221c5ce))


### Bug Fixes

* bundle targets 显式列表去掉 MSI，Windows 只出 NSIS ([6f8d027](https://github.com/Jo0OCTsai/pokemon-knock/commit/6f8d027459d9c4d06b6b4d7628b95f3662bd2d7c))
* bundle targets 补 app 目标，恢复 macOS 更新包产出 ([9a88583](https://github.com/Jo0OCTsai/pokemon-knock/commit/9a885837a4eb9baa525a022a50245bce05c561d3))
* **ci:** 首版固定 0.1.0 并豁免 tauri.conf.json 格式检查 ([9db6fe2](https://github.com/Jo0OCTsai/pokemon-knock/commit/9db6fe27bea922c20091e116096eef64a2179d16))
* default-run 显式指定主程序，修复 release 包打入 pk CLI ([1dae24f](https://github.com/Jo0OCTsai/pokemon-knock/commit/1dae24f298a0b3d956602988c1b1fd371273a709))
* **deps:** update npm dependencies ([8809192](https://github.com/Jo0OCTsai/pokemon-knock/commit/88091925d9ffd2c040eaa742287dbef11712363e))
* lark-cli 断言参数与 i18n 文案 @ 转义 ([c442b11](https://github.com/Jo0OCTsai/pokemon-knock/commit/c442b11633d4ab317001df4f5b6668dc8129a3cd))
* lark-cli 断言参数与 i18n 文案 @ 转义（补上 [#34](https://github.com/Jo0OCTsai/pokemon-knock/issues/34) 合并时丢失的修复） ([928271b](https://github.com/Jo0OCTsai/pokemon-knock/commit/928271b96f0d05ee4f03725565d9d41151b8bbcf))
* release 打包主程序错选 pk CLI，补 default-run 与 universal lipo ([5a424ac](https://github.com/Jo0OCTsai/pokemon-knock/commit/5a424ac9f2232a3e55e3e670df902e90e9c8e549))
* ssh 占位符 user@host 的 @ 转义 ([6715d56](https://github.com/Jo0OCTsai/pokemon-knock/commit/6715d56d830922273c65394b08bee5ed488d22dc))
* ssh 占位符 user@host 的 @ 转义，消除 vue-i18n 编译警告 ([730dc8e](https://github.com/Jo0OCTsai/pokemon-knock/commit/730dc8ef16c0d00c679cef56bd24eecb72087dd9))
* universal sidecar 双架构构建后 lipo 合成胖二进制 ([3f6a4f6](https://github.com/Jo0OCTsai/pokemon-knock/commit/3f6a4f63acac5efd38bf85d5bafd8c65e52bc45b))
* universal 构建将 pk 胖二进制补进 target 目录，macOS .app 打包不再缺文件 ([4aad883](https://github.com/Jo0OCTsai/pokemon-knock/commit/4aad8832cebf72d1ce73c4c319277a8d3e843da9))
* 修复 macOS/Windows 的 release 编译错误 ([ced89ee](https://github.com/Jo0OCTsai/pokemon-knock/commit/ced89ee51bf1d5eb0adc0fcd64fba3d965f8f281))
* 修复 release 打包的 pk sidecar（Windows .exe 占位与 universal 目标） ([b1e4d1c](https://github.com/Jo0OCTsai/pokemon-knock/commit/b1e4d1c162545d1e1004f079a7349608b40cf346))
* 修复飞书消息拉取时间戳单位错误并完善链路日志 ([e7a2a8e](https://github.com/Jo0OCTsai/pokemon-knock/commit/e7a2a8ee02d4221cee913e5a81ee93b03d205c50))
* 占位 sidecar 的 Windows .exe 判断改用 TARGET 三元组 ([c61e81e](https://github.com/Jo0OCTsai/pokemon-knock/commit/c61e81e058fd1b69cd2c8fb1c482b104fe29667a))
* 日期时间选择器的下拉箭头固定贴选择框右缘 ([0473cbb](https://github.com/Jo0OCTsai/pokemon-knock/commit/0473cbb896eab75919d6b433e83bc8fe80af77b8))
* 调试配置适配 LLVM 官方 lldb-dap 扩展 ([a2ca06d](https://github.com/Jo0OCTsai/pokemon-knock/commit/a2ca06d4b7a904638652136187100c028e8dec88))


### Code Refactoring

* **backend:** AppError 统一错误、命令分域与常驻插件接入 ([3ddedb5](https://github.com/Jo0OCTsai/pokemon-knock/commit/3ddedb5e80d043627397caa405f3bd08ebc8bba9))

## [Unreleased]

### Added

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
