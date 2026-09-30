# 债务与待办清单

> 活清单：完成勾选移入已完成段，新债务随时追加。每条注明来源与影响面。

## 待处理

- [ ] **pub API 文档缺失 271 处**（来源：2026-09-28 质量指标扩展，missing_docs 接入时建账）：lib crate 公开项（commands / bin/pk 消费面等）缺 `///` 文档。数量已被质量棘轮 `hygiene.missing_docs` 锁定（只降不升），渐进清理——优先补 `bin/pk` agent 消费面（协议地位，见 AGENTS.md SKILL_VERSION 同步义务），内部实现项可随重构顺带补。计数口径：`cargo rustc --lib -- -W missing_docs`（独立 target 目录）。
- [ ] **PetApp.vue 剩余可拆功能域**（来源：2026-09 前端大文件拆分，`specs/archive/frontend-component-split/`）：script 仍有 ~795 行。可继续按 `useXxx(opts)` 模式提取：reminder 就近提醒（~38 行）、睡眠/唤醒（~32 行）、时刻台词+每日问候（~74 行，两块同构可合并）、陪跑精灵 mate（~40 行）、手势三分+拖拽+栖息（~110 行）、快捷图鉴屏（~40 行）。提取后 script 预计可到 ~450。模板侧 ChatBox/QuickDex 两个区域（~86 行 template + 样式）也可 SFC 化。
- [ ] **跨文件重复样式未令牌化**（来源：同上，属重构范围外登记）：
  - RadioTab 与 TaskTab 逐字雷同的 `.search-input` / `.empty`，应下沉公共样式；
  - 任务页 `.dex-filter .filter-btn` 与全局 `.filter-chip`（2026-09-30 自日志页过滤件上收 dex.css，PR #122）是同一控件语言的 scoped/全局两份，TaskTab 迁移 `.filter-chip` 即可收编；
  - 「3px navy 边框 + 3px3px 硬阴影 + 8px 圆角」图鉴卡片语言在 RadioTab/TaskCard/TaskTab/SettingsTab 出现 12+ 处，应抽 `.dex-card` 公共类或设计令牌（设置页 `.set-card` 主规则现已分散为 8+ 份 scoped 副本，是其中最大的一簇）；
  - RadioTab 内置信度配色两套（`.conf.high|medium|low` 与 `.sug-conf.c-high|c-medium|c-low`）应合一；
  - SettingsTab 拆分中子组件复制的 `.btn-row`/`.btn.del` scoped 副本（仓内已接受的做法），令牌化时一并收编。
- [ ] **flash 状态条语义微差**（来源：同上，useActionToast 重构）：多条 flash 消息重叠时由「先到先清」改为「最新重置」（用户不可感知级别）；备份/导出卡内 flash 消息在有效期内切走 general 分区再回来会清空。若日后做多区域 toast 需求可一并重设计。
- [ ] **SettingsTab script 内仍留页面级胶水**：autostart/feishuAuth/backups/appVersion 的 onMounted 预取与两个 tauri listen 留在父级经 props/emit/ref 转发（行为保持所需）；若后续做 feishu/update 域 store 可下沉。
- [ ] **ai 引用工具仍被跨域直用**（来源：2026-09-26 后端大文件拆分评估）：dispatch/cmdline、skills、tunnel 仍直接用 `ai::posix_quote` / `ai::windows_ps_quote` / `ai::ssh_bin` 等底层零件自拼 SSH / tmux 命令行。本次拆分已把它们集中到 `ai/invocation.rs`（路径不变），后续可在其上提供统一的远端 argv 构造接口收编各处手拼。
- [ ] **schema 基线漂移对存量 v1 库不可见**（来源：2026-09-28 群代号标签事故复盘）：迁移策略是「schema 变更直接改 SCHEMA_V1 基线、不加迁移项」，但已有 v1 库 `migrate()` 是 no-op——基线新增的表/列永远补不到存量库，且 `pk doctor` 只比对 user_version（1==1 判健康），漂移完全静默。当日实例：真实库缺 `feishu_chat_aliases`（手动对齐漏了表）→ 群代号分配 64 探测耗尽 → 模型编造 群_xxxx 标签 + restore 整体失效；已随「群名不脱敏」改造移除该表根治此例。遗留建议：启动时对 SCHEMA_V1 的幂等 CREATE 段做基线自愈重放，或 doctor 增加关键表存在性抽检，防下次基线变更再踩同类坑。

## 已完成

- [x] 2026-09-28 **本地 lint-gate 的 clippy 口径已对齐 CI**（来源：PR #111 CI 失败复盘，当日收口）：stack.json `src-tauri.lint_check` 补上 `--all-targets`（tests 模块进本地门禁范围，此前 `tmp_root` 死代码与 5 元组 `type_complexity` 均因此漏检）；拦截条件（会话过滤测试 5 元组 cases）已在 PR #111 以 `FilterCase` 类型别名收敛，本地 `--all-targets` 全绿。注：`feat/feishu-chat-filter-refine` 分支上另有未合并的 4 元组收账提交（09607ca），与别名方案语义等价，合流时取其一即可。
- [x] 2026-09-26 后端四大文件结构重构（ai.rs 2364→ai/ 五模块、radio.rs 3201→radio/ 六域+testsupport、dispatch.rs 2394→dispatch/ 九域、pk.rs 3162→bin/pk/ 十一子模块），行为保持不变、350 单测全绿；顺带解掉 ai↔radio 循环依赖（判定管线 classify/capture 与库回读归位消息域 radio/judge）。
- [x] 2026-09-26 前端三大文件结构重构（RadioTab 1498→637、SettingsTab 2331→408、PetApp 1963→1789），行为保持不变，221 单测全绿——详见 `specs/archive/frontend-component-split/reports/refactor-summary.md`。
