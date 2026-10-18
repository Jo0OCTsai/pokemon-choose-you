# ADR-0002：配置 100% 对齐与双轨设置面

> 状态：已采纳　日期：2026-10-12
> 来源：`specs/dsh-plugin/`（SDD D19/D20 用户关卡裁决 · AD §3.2/§5.2/§8⑧⑨ · 就地决策 A2/A23/A24）；规范单源 = `contracts/PROTOCOL.md`，行为契约由 `contracts/fixtures/config_align/` 锁定。

## 背景

dsh 插件形态（第二形态，见 ADR-0001）的用户裁决演进：D19 背包全量补齐（五段→七段）→ D20 升级为**配置 100% 对齐**（「可以配置的内容要完完全全一致」）。设计原则：**配置面完全对齐、行为触达各形自理**——dsh 无系统通知调度与键盘监听，提醒发声等行为由主应用执行，但相关配置在 dsh 可查可改、写共享设置库。

## 决策

### 1. 36 共享设置键全量读写（D20）

dsh 背包配置项与主应用设置中心**键值面等效**：全部 36 设置键（事实源 = 主应用 `src/stores/settings.ts` `SETTING_KEYS`）经既有 host 命令 `configRead`/`configWrite` 全量读写共享库 `settings` 表，两形态任一处改、另一处读同值；TS 侧键集与主应用逐字一致（含顺序）由 `dsh-plugin/__tests__/settings.spec.ts` 断言。「100% 对齐」**不含主应用壳层操作面复刻**：立即备份/导出导入向导/每周复盘向导/更新检查等操作归主应用，相关键本身仍可写。

### 2. 背包八分区同名同构 + 保存制（D19/D20 · UIUX U21）

dsh 插件页面「背包」分段 = 八分区横向选单 + 分区整页（一次只显示一个分区、每类设置单独一个页面），与主应用设置页 8 个 Section 同名同构：🍅专注 / 🗂分类与标签 / 🐾桌宠 / 👀显示 / 🤖Agent / 飞书 / 🩺诊断 / ⚙️通用。共享配置键为编辑草稿 + 分区页标题行「保存」统一提交（host 命令面不变，仅提交时机从即时改保存）；实体管理 CRUD（分类/标签/维度/agent 卡/提示词覆盖/会话过滤）维持各自提交语义。

### 3. 双轨设置面（A2）

- **插件私有配置**（桌宠开关/减弱动效/随宿主启动/判定执行方等）→ dsh 插件 **Config schema**（Plugins 页 detail page 原生 ConfigEditor live 表单，白吃平台持久化），不进共享库；
- **共享配置**（语言/轮询间隔/专注档/项目路由/主宝可梦与台词/36 键等）→ 共享库 `settings` 键；
- 两种来源同页呈现、标注数据归属（「插件私有 · Config schema ↔ 双形态共享 · 共享库」）；`dsh:` 前缀键保留给共享语义 dsh 侧键与 host 半边内部态（`dsh:dispatch_routes` / `dsh:pet_pos` / `dsh:focus_settled`），随库备份导出、不产生第二存储域。

### 4. 「作用于主应用」标注体系（D20 形态专属标注清单）

行为触达不在 dsh 的键在背包标注「作用于主应用」，可查可改、写共享值：提醒触达/番茄完成通知与提示音/桌宠输入响应/语音/陪跑/终端偏好/关闭到托盘/复盘提醒/备份执行/更新检查（dsh 经 dsh 插件机制升级）。

> **补记（2026-10-18）**：本标注体系已整体退役。dsh 形态自执行面扩展（U29 触达类 / D33 备份复盘翻案、desktop 载体外部终端唤起读 `terminal_preference`）后，badge 仅剩终端偏好与关闭到托盘两处消费方；随「关闭到托盘」整项从 dsh 背包隐藏（纯主应用窗口行为项，键不读写、值随主应用自管）与终端偏好 badge 移除，scope-badge 机制（ScopeBadge 组件 + Toggle/Select/FormRow badge prop + `dsh.badge.*` 三语键）零消费方整清。§4 描述为历史决策面，现行口径见 `docs/USER_GUIDE.md` 双形态注意事项表。dsh **自身呈现类**键同读同生效：逾期展示模式（dsh 冒险分段）、相对截止时间（条目卡）、减弱动效（插件页面与 helper）、语言与日期时间制式。

### 5. 并发编辑冲突 = 整值覆盖 + 修订检测（A24）

双形态同时编辑同一配置不做字段级合并：

- **agent 列表**：主应用现行即 `ai_agents` JSON 键整读-改-整写（前端组装、后端无条级命令），插件 `agentUpsert`/`agentDelete` 同形态——单条 `BEGIN IMMEDIATE` 内「整读 → 比对 → 改 → 整写」，以 `expectedAgentIds`（读时 id 集）为基线；
- **提示词覆盖**（`ai_prompt_*` 4 键 + dispatch 只读示例）：单值文本整值覆盖，以 `expectedValue`（读时 overrideText）为基线；
- 基线失配 → 错误码 **`SETTING_MODIFIED_ELSEWHERE`**（提示「已在另一处被修改」），用户确认后 `force` 重发整值覆盖；后写胜出收口最终一致性；
- 修订检测为**插件编辑会话单向尽力**——主应用维持现行整写（无检测、后写直接胜出，不加配套演进项）。

### 6. 插件运行日志环形 2000（A24③）

host 半边自身运行日志 = 内存环形缓冲 2000 条滚动、**不落盘**（随宿主进程存亡，重启清空；跨重启排障走支持报告文本与 dsh 宿主进程日志）；`logQuery` 级别/来源过滤 host 侧在环形上执行（limit 默认 500、上限 2000，对齐主应用日志查看器 tail 口径）；返回文本与支持报告共用三层脱敏管线（`contracts/PROTOCOL.md` §4，原始明文不出 host 边界）。

## 后果

- host 命令面 43 → 50 条目（+agentUpsert/agentDelete/promptList/promptGet/promptOverride/promptReset/logQuery）；错误码 11 → 15（+CONFIG_VALIDATION_FAILED / AGENT_COMMAND_INVALID / PROMPT_VALIDATION_FAILED / SETTING_MODIFIED_ELSEWHERE），单源 = `contracts/PROTOCOL.md` §2。
- 分类/标签/维度/会话过滤为共享实体直写（A23，零新增表列），级联与不变式写入侧强校验、fixtures 锁定。
- 用户面语义见 `docs/USER_GUIDE.md` dsh 形态章节；提示词两处可编辑与冲突提示（保存时检测，失配提示后整值覆盖）。
