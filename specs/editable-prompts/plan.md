# editable-prompts 实施计划（plan.md）

> **自包含声明**：本计划 + 同目录 `requirements.md`（SDD r2）/ `architecture.md`（AD，
> 含 §9 契约收敛记录与 r2 修复）/ `uiux-design.md`（UIUX r2，含 §8 文案全表与 §4.1
> 焦点规格）是实施的唯一输入，不依赖任何会话讨论记忆。已过「需求+设计+架构通过」
> 关卡（2026-09-30）。规模 L。冲突时以 SDD 验收/NFR 为最终权威，AD 拥有 API 契约，
> UIUX 拥有交互与文案。

## 0. 背景与目标（一段）

把 5 处硬编码 AI 提示词中的 4 处（IM 分类 / 快速捕捉 / 桌宠对话 / 标签治理）开放为
应用内可查看、可编辑的配置：覆盖存 settings KV（`ai_prompt_*` 4 键），调用点经统一
解析器「读覆盖 → 可用性校验 → 回落编译默认」每次现场解析；设置页 Agent 分区新增
「AI 提示词」卡（PromptsCard）；待办派发只读展示（注入隔离安全结构不可编辑）。
零 DB 迁移；默认文本以编译常量为单源（现有断言测试零改动是硬验收）。

## 1. 前置状态

- 分支：`feat/editable-prompts`（自 main 新建，已就位）
- 规格：`specs/editable-prompts/`（design/requirements/architecture/uiux-design/原型）
- 工具链：pnpm + node_modules 就绪；cargo + cargo-llvm-cov 0.9.1 就绪（若缺
  llvm-tools-preview 组件：`rustup component add llvm-tools-preview`）
- 载体：macos 宿主直跑；命令单源 `.devcontainer/stack.json`（前端 `pnpm test` /
  `pnpm dev`；Rust 日常 `cargo test`、验收口径 `cargo llvm-cov`）

## 2. 接口契约（自 AD §4 摘录，实施权威；完整语义见 AD）

### 2.1 功能目录（常量单源：`ai/prompt_overrides.rs`）

| 功能 id | 存储键 | 可编辑 | 必要占位符 |
|---|---|---|---|
| `im_classify` | `ai_prompt_im_classify` | 是 | `<AGENT_ID>` |
| `capture` | `ai_prompt_capture` | 是 | `<AGENT_ID>` |
| `pet_chat` | `ai_prompt_pet_chat` | 是 | `<CONTEXT>`、`<QUESTION>` |
| `tag_health` | `ai_prompt_tag_health` | 是 | （空集） |
| `dispatch` | （无键） | **否** | 不适用 |

长度上限 `PROMPT_MAX_CHARS = 20_000`（Unicode code points；Rust `chars().count()`，
前端 `[...str].length`，后端最终权威）。

### 2.2 Tauri command（camelCase 序列化）

```ts
// list_ai_prompt_specs() -> PromptSpecInfo[]（固定 5 项，目录顺序）
{
  id: string;                       // 上表 id
  storageKey: string | null;        // dispatch 为 null
  editable: boolean;                // dispatch 为 false
  defaultText: string;              // 编译默认全文（dispatch = dispatch_prompt_example() 渲染）
  requiredPlaceholders: string[];
  lengthLimit: number;              // 20000
  overrideText: string | null;      // 已存覆盖原文（default_warned 也返回，供修复）
  source: "default" | "custom" | "default_warned";
  missingPlaceholders: string[];    // 仅 default_warned 非空
  overlong: boolean;                // 仅 default_warned 可为 true
}
// dispatch 项固定值：source 恒 "default"、missingPlaceholders 恒 []、overlong 恒 false

// save_ai_prompt(key, value) -> SavePromptResult
{ spec: PromptSpecInfo, unknownPlaceholders: string[] }
```

`save_ai_prompt` 判定顺序（后端唯一权威）：
1. key 不在 4 个可编辑键集合 → `AppError::Invalid("该提示词不支持编辑")`
2. `value.trim()` 空白 → **DELETE 行**，返回 `spec.source = "default"`
3. `value == defaultText` 逐字节一致 → **DELETE 行**（防幻影自定义）
4. `chars().count() > 20000` → `Invalid`（提示上限值）
5. 缺必要占位符 → `Invalid`（文案列出缺失占位符名）
6. 通过 → upsert（与 `set_setting` 同式，但含删除语义故不走 set_setting）+
   扫描未知占位符（`<[A-Z][A-Z0-9_]*>` 且不在已知集合；小写/混合大小写不告警）
   随响应返回警告 + `events::broadcast(SETTINGS_CHANGED)`

### 2.3 运行时解析（`effective_system_prompt`，固定优先序）

① 与默认逐字一致 → `Default`（优先于一切不可用判定）② 非空白 && ≤上限 &&
必要占位符全部字面包含 → `Custom` ③ 行存在且非空白但不可用 → 文本回落默认 +
`DefaultWarned{missing, overlong}` ④ 无行/空白 → `Default`（空白行仅可能经
`set_setting` 旁路产生，无警示）。调用侧每次现场解析、**无缓存**（生效时延 NFR 的
机制保证）；锁窗口 = 微秒级点查，不跨 await。

### 2.4 拼装协议（无覆盖时输出与今日逐字节相同——既有断言测试是锚点）

- `im_classify`/`capture`：`build_*(system, agent, …)` 内
  `format!("{system}\n\n{rendered}").replace("<AGENT_ID>", &agent.id)`（整串替换，
  保留现状边界行为）
- `pet_chat`：默认文本迁入 prompts.rs 时 `{ctx}`/`{q}` 改 `<CONTEXT>`/`<QUESTION>`
  （其余逐字节），拼装走 `render_template`（**单遍扫描，替换值不再被扫**，format! 语义）
- `tag_health`：指令文本（含尾部「词表：\n」框架）迁入逐字节不动；照旧追加词表与候选对
- `dispatch`：拼装/laundering **零改动**，仅新增 `dispatch_prompt_example()`
  （调用真实 `dispatch_prompt(1, "示例：整理周会纪要", Some("…"), &["…"], Some("…"))`）

## 3. 文件映射

**后端（全部在 `src-tauri/src/`）**

| 文件 | 动作 |
|---|---|
| `ai/prompt_overrides.rs` | 新增：目录 PromptSpec 常量表、`effective_system_prompt`、保存校验、`render_template`、token 扫描、`is_prompt_override_key` 谓词 + 单测 |
| `ai/prompts.rs` | 迁入 `PET_CHAT_SYSTEM_PROMPT`/`TAG_HEALTH_SYSTEM_PROMPT`（逐字节）；`build_tools_prompt`/`build_capture_prompt` 加 `system: &str` 参 |
| `ai/mod.rs` | 挂载 + re-export |
| `commands/prompts.rs` | 新增：2 个 command + 测试；`lib.rs` 注册 |
| `commands/radio/judge.rs` | `classify_with_session`/`capture_with_session` 锁内解析（getter 闭包）→ 释锁 → `build_*(&resolved.text, …)`；debug 日志 custom 来源不回显内容（`[自定义覆盖 N 字符，内容不回显]`） |
| `commands/pet.rs` | 锁内解析（既有 get 闭包同窗口）、锁外 `render_template`；默认文本迁出 |
| `commands/tag_health.rs` | 指令文本迁出；`judge_with_agent` 加 `system` 参 |
| `commands/dispatch/prompt.rs` | 新增 `dispatch_prompt_example`（拼装逻辑零改动） |
| `commands/settings.rs` | `list_all_settings` 过滤 `ai_prompt_*` 前缀 |
| `commands/export.rs` | 导出过滤 `ai_prompt_*`；导入对本机该前缀行 stash-and-restore（秘钥同模式） |
| `ai/runner.rs` | 仅测试内 `build_tools_prompt` 调用点按新签名传默认常量 |

**前端（全部在 `src/`，另 `e2e/`）**

| 文件 | 动作 |
|---|---|
| `types.ts` | `PromptSource`/`PromptSpecInfo`/`SavePromptResult` 类型 |
| `api.ts` | `listAiPromptSpecs`/`saveAiPrompt` 薄封装 |
| `composables/usePromptEditor.ts` + `composables/__tests__/usePromptEditor.spec.ts` | specs 装载、三态映射、编辑缓冲与脏检查、前端预校验（长度/必要占位符/与默认一致中性提示）、保存/恢复状态机、后端错误与 unknownPlaceholders 呈现转换 |
| `components/settings/PromptsCard.vue` | 卡壳 + 装载/失败重试 + i18n sub/foot |
| `components/settings/PromptFeaturePanel.vue` | 折叠面板（徽章组/LCD 查看屏+生效标签/警示行/只读说明/占位符行/操作行/编辑态/确认条/对照区） |
| `components/settings/SectionAgents.vue` | CLI 卡之后、TagDispatchCard 之前插入 PromptsCard |
| `i18n/zh-Hans.ts` / `zh-Hant.ts` / `en.ts` | `prompts.*` 全量键（UIUX §8 全表，含 aria 2 键） |
| `e2e/prompts-settings.spec.ts` | E2E（tauri-mock 模式） |

**不改（scope 红线）**：`db.rs`、AgentConfig / agents store / `SETTING_KEYS` /
`SETTING_DEFAULTS`（提示词键不入通用协议）、pk 出口协议、判定结果落库链路、dispatch
定界块与 laundering、`invocation.rs`；不顺手重构无关代码（改动范围铁律）。

## 4. 并行组 1：后端 Rust（与并行组 2 同消息派发，文件集不相交）

> TDD：以下 T1.1–T1.3 是核心逻辑，先写测试再实现（红→绿）；T1.4 起按逻辑性分诊，
> 集成类用既有 fake-agent / testsupport 装置。

- **T1.1 `ai/prompt_overrides.rs` 解析与校验（TDD）**
  先写单测矩阵再实现：resolve 分支（无行 / 空白行 / 与默认逐字一致 / 缺占位符 →
  DefaultWarned / 超长 → DefaultWarned / 合法 → Custom；「同默认但缺占位符」变体
  必须落 Default——优先序用例）；save 校验分支（非法键 / 空白删行 / 同默认删行 /
  超长 / 缺占位符列名 / 合法 + 未知占位符警告，大小写样式边界）；`render_template`
  单遍不重扫（替换值含另一 token 字面量不被二次替换）；目录自检（每个可编辑 spec
  默认文本包含其全部必要占位符、4 键唯一、上限常量一致）。
- **T1.2 默认文本迁移 + build_ 演进**
  `PET_CHAT_SYSTEM_PROMPT`（`{ctx}`/`{q}` → `<CONTEXT>`/`<QUESTION>`，其余逐字节）、
  `TAG_HEALTH_SYSTEM_PROMPT`（含尾部「词表：\n」逐字节）迁入 prompts.rs；`build_*`
  加 `system` 参；迁移后跑既有测试确认逐字节锚点全绿（`pet_chat_sends_context_and_
  trims_reply` 等）。runner.rs 测试调用点适配。
- **T1.3 command 层 `commands/prompts.rs`（TDD）**
  list 三态载荷（default_warned 的 overrideText 回传、dispatch 固定值与示例渲染）；
  save 错误分支文案 + 成功返回 `{spec, unknownPlaceholders}` + DELETE/upsert 落库
  断言；`lib.rs` 注册。
- **T1.4 调用链接入**
  judge.rs 两处 `*_with_session`（锁内 getter → 解析 → 释锁 → build）+ debug 日志
  custom 屏蔽；pet.rs 锁内解析 + 锁外 render_template；tag_health.rs `judge_with_agent`
  加参。集成测试：pet 自定义覆盖进 stdin 载荷、缺占位符覆盖回落默认载荷、pet 默认
  输出与改前逐字节一致、classify 覆盖生效（fake-agent 装置）。
- **T1.5 边界面**
  `dispatch_prompt_example()`；`list_all_settings` 过滤；export 导出过滤 + 导入
  stash-and-restore（测试：导出文件不含 `ai_prompt_*`、导入后本机行原样保留——
  M-1 回归场景）；解析点 `log::debug`（feature/来源/长度，不记内容）。
- **T1.6 后端门禁**：`cargo test` 全绿；`cargo llvm-cov`（`--fail-under-lines` 棘轮
  地板不破；GUI 胶水排除口径照旧）。

## 5. 并行组 2：前端 Vue（与并行组 1 同消息派发）

> TDD：T2.1 composable 先写测试；组件/i18n 非 TDD（verification 兜底）。
> 视觉与交互规格以 uiux-design.md §3–§8 为准（含 §4.1 焦点管理规格、§6.2 token、
> §8 文案全表——含 r2 补的确认条 aria-label 与编辑器 aria-label 2 键）。

- **T2.1 `usePromptEditor.ts`（TDD）**：先写 spec 再实现——specs 载荷 → 三态映射、
  编辑缓冲与脏检查、预校验（长度 / 必要占位符 / 与默认一致中性提示；未知占位符
  展示后端返回的警告清单，不在前端扫描）、保存/恢复状态机（保存成功用响应 spec
  直接替换面板数据，前端零推导）、后端 Invalid 错误转换。
- **T2.2 组件**：`PromptFeaturePanel.vue`（折叠头 aria-expanded、徽章组「内置默认/
  自定义/⚠ 不可用/只读/未保存」、LCD 查看屏 + 生效标签「当前生效(·自定义)」+ 复制
  钮 32px、警示行与占位符行**面板级常驻**（不随编辑态隐藏）、编辑态 = 常驻警示条 +
  textarea（等宽 min-height 240px + 计数器 n/20000）+ 校验区 aria-live 分级（白底
  `--dex-red-dark` 阻断字 / warn 黄 / 中性灰）+ 保存禁用逻辑、恢复默认行内两步确认
  （`role="group"` + aria-label、主动作黄底）、内置默认对照区）+ `PromptsCard.vue`
  （装载/失败重试/sub/foot）。焦点管理按 UIUX §4.1 六条落实（进编辑→textarea 光标
  置尾、确认条→焦点入确认钮、取消/成功→回「编辑」钮、chip 插入不抢焦、折叠焦点
  留折叠头）。样式沿用 set-card scoped 副本先例，全 dex token。
- **T2.3 插卡与 i18n**：SectionAgents 第 2 卡位插入；三语言 `prompts.*` 全量键
  （zh-Hans 基准 / en 对照 / zh-Hant 按繁化惯例；占位符字面量 `{'<'}` 转义先例）。
- **T2.4 前端门禁**：`pnpm test`（含新 composable spec）+ `pnpm test:coverage`
  （四维地板不破，阈值 = vite.config.ts coverage.thresholds）。

## 6. 串行收尾组（并行组 1/2 均绿后执行）

- **T3.1 E2E（e2e-acceptance 口径）**：`e2e/prompts-settings.spec.ts`（tauri-mock
  invoke）——查看默认态、编辑保存→徽章切换、删占位符→阻断 + chip 插入恢复、超长
  阻断、未知占位符警告、恢复默认两步确认、派发只读面板、default_warned 警示态
  （mock source）、读取失败重试。产物：`reports/raw/playwright-report/` +
  `reports/e2e-summary.md`（读 raw 解读）。
- **T3.2 接口报告（api-contract-test 口径）**：Rust 侧命令/解析层测试 junit 落
  `reports/raw/junit-<service>.xml` + `reports/api-summary.md`。
- **T3.3 验收叙事**：`reports/acceptance-report.md` + `reports/screenshots/`
  （Playwright 截图对照 UIUX 原型）。
- **T3.4 全量门禁**：`CLAUDE_PROJECT_DIR=. bash .claude/hooks/lint-gate.sh`；
  `python3 .devcontainer/scripts/quality_ratchet_check.py`（复杂度/覆盖率地板/
  代码卫生棘轮）；`pnpm check:duplicates`（jscpd ≤2.5%）。
- **T3.5 提交**：feature 分支本地 commit（Conventional Commits，pre-commit 钩子
  走 lint-gate + commitlint；不 push、不开 PR——交用户决定）。

## 7. 实现注意项（来自评审复评，勿漏）

1. 默认文本逐字节不变是硬验收：迁移后既有断言测试必须零改动全绿。
2. loading 骨架「读取中…」文字用 `--lcd-text`（勿用 `--lcd-dark`，对比度 1.5:1 fail）。
3. 确认条按钮命中区对齐控件级 38px（或 mini 32px 档在 §6.2 注记口径内统一）。
4. im 警示行与占位符行同为面板级常驻子节点（勿嵌进 view-block）。
5. E2E 键盘断言按实际结构序（折叠头→复制钮→chips→编辑…），勿按 UIUX §9 旧序。
6. `save_ai_prompt` 未经 `set_setting`（含 DELETE 语义）；`get_setting`/`set_setting`
   通用原语保持不动（运行时校验兜底旁路写入）。
7. 广播 SETTINGS_CHANGED 的既有消费者（桌宠窗口去抖重拉）无害——键已被
   list_all_settings 过滤，勿动。
8. i18n en 长度 ~2× zh：操作行/徽章组需 flex-wrap（原型已验证）。

## 8. 明确不做（scope 红线）

- 诊断面「提示词来源一行」可选增强（AD §6【待确认】）——一期不做。
- 不改 dispatch 定界块/laundering、不引入组件库、不做提示词版本戳/漂移对比 UI、
  不做按 agent 粒度的提示词变体（design.md 方案 C 已否）。
- 不重构无关模块（runner.rs/invocation.rs 仅测试调用点适配）。

## 9. 完成定义（DoD）

- 三个并行/收尾组全绿：cargo test + llvm-cov 地板、pnpm test + coverage 地板、
  lint-gate、质量棘轮、jscpd 全过。
- 既有测试零改动（除 AD 注明的 runner.rs 测试调用点签名适配）全绿——默认文本
  逐字节锚点成立。
- SDD §5 全部 Gherkin 有对应自动化承接（Rust 集成/命令测试或 E2E）；三份报告落
  `specs/editable-prompts/reports/`。
- feature 分支本地 commit 完成（不 push）。
