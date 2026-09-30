# 用户场景验收报告（acceptance-report）

> 特性：agent 提示词查看与编辑（editable-prompts）。
> 版本基线：分支 `feat/editable-prompts`（HEAD 846c84a + 工作区实施代码），2026-09-29 验证。
> 验证方式：Playwright E2E（chromium + firefox，mock IPC 镜像 Rust 语义）+ Rust 单元/命令/集成
> 测试 358 例全绿 + 前端 vitest 292 例全绿；截图见 `screenshots/`（Playwright 实拍，仅 chromium）。
> 验收权威：SDD `requirements.md` §5 Gherkin（观察点约定：生效类断言看**发给 agent 的调用载荷**，
> 该层证据来自 cargo test 集成测试；E2E 层锁交互与呈现）。

## 场景一（P0）：查看每个 AI 功能当前生效的系统提示词

**叙事**：用户想知道收音机判定、桌宠回答背后的规则长什么样。打开 设置 → Agent 分区，
CLI 卡下方出现「AI 提示词」卡（副标题明示"保存后下一次 AI 调用即生效"）。展开「IM 分类」：
折叠头右侧徽章「内置默认」，查看屏是一块绿底等宽字的 LCD（图鉴机在显示系统内部数据），
顶部生效标签「当前生效」，正文完整可见 `<AGENT_ID>` 占位符与判定协议句（批量提交协议、
出口门禁）；下方「必要占位符」行以 chip 呈现 `<AGENT_ID>`。标签治理的占位符为空集，
该行不渲染。用户**尚未配置任何 AI agent**，卡片照常可用——装载不依赖 agent 配置，无任何
"先去配置 agent"的门槛提示。已保存自定义的功能（如「快速捕捉」）查看屏显示用户文本，
徽章与生效标签切为「自定义」/「当前生效 · 自定义」。

**证据**：
- [01-default-view.png](screenshots/01-default-view.png)（默认态：徽章 + 生效标签 + LCD + 占位符行）
- E2E「默认态查看」「编辑保存后徽章切换」（`e2e/prompts-settings.spec.ts`，junit 见 raw）
- Rust `list_specs_defaults_and_dispatch_entry` / `list_specs_reports_custom_and_warned_states`
  （查看载荷三态，camelCase 序列化契约）
- SDD Gherkin「默认状态下查看 / 自定义状态下查看生效文本与来源 / 未配置 AI agent 也可查看」→ ✅

## 场景二（P0）：编辑并保存自定义提示词

**叙事**：用户嫌桌宠回答太正经。展开「桌宠对话」点「编辑」：textarea 预填当前默认全文，光标
落在文本尾；上方出现不可关闭的常驻警示条——"提示词内嵌判定协议与出口门禁，误删可能导致判定
失败或建议污染"。追加一行"语气更皮一点"，折叠头亮起「未保存」徽章，点「保存」：徽章弹现切换
为黄色「自定义」，生效标签变「当前生效 · 自定义」，查看屏已是新文本，绿色提示行"✅ 已保存，
下一次「桌宠对话」调用即生效"。此后发起的桌宠对话，**发给 agent 的载荷就是新提示词**（无需
重启应用）。

校验即时可见：删掉 `<AGENT_ID>` 占位符 → 校验区立刻出现红色阻断文案并列出缺失占位符名、
保存按钮禁用、缺失 chip 变红——点这个 chip 即在光标处插回占位符（焦点不离开键盘）、阻断
消失、保存恢复可用。粘贴超过 20000 字符 → 计数器着警色 `n / 20000`、红色超长文案、保存禁用。
加入应用不认识的 `<FOO>` → 只是黄色警告"将按字面发给 AI"，保存放行。把内容清空保存 →
中性预告"保存后将恢复使用内置默认"，确认后徽章真的回「内置默认」。

**证据**：
- [02-edit-validation.png](screenshots/02-edit-validation.png)（编辑态：常驻警示条 + 阻断红字 + 红 chip）、
  [06-saved-custom.png](screenshots/06-saved-custom.png)（保存后自定义态 + 内置默认对照展开）
- E2E「编辑保存后徽章切换…」「删占位符→红色阻断…」「超过长度上限被阻断…」「未知占位符仅
  警告…」「保存空白等同恢复默认…」「模式与状态转换的焦点管理」
- 载荷层（SDD 观察点）：Rust `pet_chat_custom_override_reaches_agent_payload`、
  `classify_custom_override_reaches_agent_payload`、`judge_with_agent_sends_system_prompt_in_payload`；
  阻断/放行权威：`save_rejects_missing_placeholders_listing_names`、`save_rejects_overlong_with_limit_hint`、
  `save_blank_or_equal_deletes_row`（空白与同默认逐字一致均删行 = 视为无覆盖）、
  `save_accepts_and_warns_unknown_placeholders`
- SDD Gherkin「保存合规的自定义覆盖 / 缺失必要占位符被阻断 / 超出长度上限被阻断 / 保存空白覆盖
  等同恢复默认 / 保存与内置默认逐字一致视为无覆盖 / 含未知占位符的保存仅警告」→ ✅

## 场景三（P0）：恢复内置默认 + 查看默认对照

**叙事**：自定义把判定改坏了，用户想回到已知良好状态。「标签治理」面板点「恢复默认…」：
操作行原位展开一条黄色确认条（不是模态弹窗），写明后果"将清除自定义内容，恢复为当前版本内置
默认"，主动作「确认恢复」黄底强调、焦点自动落在其上；点确认后徽章回「内置默认」、绿色提示
"✅ 已恢复内置默认"，覆盖行已从数据库删除、入口随覆盖消失。想对比"我改了什么"：自定义态下
操作行出现「内置默认对照 ▾」，展开即见当前版本编译默认全文（与生效屏以标签区分层级）。

**证据**：
- [05-restore-confirm.png](screenshots/05-restore-confirm.png)（两步确认条）、
  [06-saved-custom.png](screenshots/06-saved-custom.png)（对照区）
- E2E「恢复默认两步行内确认…」（含 `role="group"` + aria-label、无模态断言、行删除读回）、
  「编辑保存后…可展开内置默认对照」
- Rust `save_blank_or_equal_deletes_row`（恢复 = save(key, "") 删行）、
  `pet_chat_sends_context_and_trims_reply`（默认输出逐字节锚点 = 可恢复性 NFR）
- SDD Gherkin「一键恢复 / 自定义状态下查看内置默认对照」→ ✅

## 场景四（P1）：待办派发提示词只读

**叙事**：用户展开「待办派发」想看看派发指令长什么样。面板头带灰色「只读」徽章，操作行
**没有任何按钮**（无编辑入口）；查看屏显示完整结构——数据声明、`===== 待办数据开始 =====`
定界块（含示例任务"整理周会纪要"）与要求段；下方说明行解释原因：此项承载不可信消息的
隔离结构（数据定界与声明），为安全设计不支持编辑。即使用 API 直接对派发键调用保存，
后端键白名单也拒绝（"该提示词不支持编辑"）——注入隔离定界块 100% 不受用户编辑影响。

**证据**：
- [04-readonly-dispatch.png](screenshots/04-readonly-dispatch.png)
- E2E「派发提示词只读…」；Rust `dispatch_prompt_example_renders_full_structure`（真实拼装零漂移）、
  `save_rejects_bad_key_overlong_and_missing_placeholders`（dispatch 键拒绝）、
  `dispatch_prompt_delimits_and_lauunders_untrusted_content`（定界与 laundering 既有锚点零改动）
- SDD Gherkin「查看派发提示词」→ ✅

## 场景五（P1）：升级后存量覆盖缺新占位符——回落 + 警示 + 修复

**叙事**：应用升级后「IM 分类」新增了必要占位符，用户旧的自定义覆盖缺了它。展开面板：
折叠头同时显示「内置默认」与「⚠ 不可用」徽章，警示行写明缺哪个占位符（`<AGENT_ID>`）、
当前已按内置默认生效、点「编辑」补齐后保存即可恢复；查看屏显示的是**默认文本**（生效的
就是它），用户存的原文只在进编辑时回填可见。收音机发起分类调用不失败——载荷用的是内置
默认（坏覆盖永不挂判定管道）。用户点「编辑」，textarea 里是自己的旧原文，点红色 chip 插入
缺失占位符，保存：警示行与 ⚠ 徽章消失，徽章变「自定义」，此后调用载荷即用修复后的覆盖。

**证据**：
- [03-warned-state.png](screenshots/03-warned-state.png)（警示态：双徽章 + 警示行 + 默认生效文本）
- E2E「default_warned 警示态：警示行列缺失占位符，编辑回填原文后修复」（含恢复默认入口可见）
- 载荷层：Rust `pet_chat_broken_override_falls_back_to_default_payload`、
  `resolve_warns_when_placeholder_missing` / `resolve_warns_when_overlong` /
  `resolve_equal_to_default_takes_priority_over_warned`（固定优先序）
- SDD Gherkin「运行时回落与查看侧警示 / 按警示修复 / 坏覆盖时 AI 调用回落内置默认 /
  坏覆盖时的查看与恢复入口」→ ✅

## 场景六（P2）：自定义提示词导致调用异常的可见性

**叙事**：用户误删了提交协议相关规则，agent 产出无法落库。调用按既有「AI 判定失败」路径呈现
（可重判、不挂起不崩溃），失败明细走既有诊断面；编辑器的常驻警示条从一开始就提示"改动后若
判定异常，先试恢复默认"——用户知道先怀疑提示词、且一键能回。

**证据**：E2E「删占位符…」用例断言常驻警示条文案（[02-edit-validation.png](screenshots/02-edit-validation.png)
顶部黄条可见）；Rust `classify_failure_salvages_landed_judgments`（既有失败路径不改）。
SDD Gherkin「协议句被误删后调用失败可见」→ ✅（呈现路径复用既有 UI，SDD 明确不改）

## 异常与边界（UIUX §9 补充场景）

- **读取失败重试**：装载 invoke 抛错 → 卡头错误行「提示词读取失败：<err>」+「重试」按钮，
  面板不渲染残缺文本；重试成功后 5 面板正常呈现——E2E「读取失败呈现错误行与重试」。
- **焦点管理**（UIUX §4.1）：进编辑焦点入 textarea 且光标置尾、取消编辑焦点回「编辑」、
  确认条焦点入「确认恢复」、取消收起回「恢复默认…」、chip 插入不抢焦——E2E 焦点用例 +
  截图用例键盘路径。
- **隐私 NFR**：自定义文本不出现在日志（`prompt_debug_preview_masks_custom_content`：
  custom 来源回显"[自定义覆盖 N 字符，内容不回显]"）与导出
  （`prompt_override_rows_excluded_and_preserved_across_import`：文件不含、导入不清空本机覆盖）。

## 验证矩阵（SDD §5 场景组 → 证据层）

| SDD 场景组 | E2E（e2e/prompts-settings.spec.ts） | Rust / vitest |
|---|---|---|
| 查看三态 + 无 agent 可用 | 默认态查看 | list 三态命令测试 ×2 |
| 保存合规 / 阻断 / 空白 / 同默认 / 未知占位符 | 5 个对应用例 | save 六分支 + 载荷集成 ×3 |
| 恢复默认 + 对照 | 恢复两步确认、对照断言 | 删行 + 默认逐字节锚点 |
| 派发只读 | 派发只读面板 | 示例渲染 + 键白名单 + laundering 锚点 |
| 升级缺占位符回落 + 修复 | default_warned 用例（含恢复入口） | 回落载荷 + resolve 优先序 |
| 调用异常可见 | 常驻警示条断言 | 既有失败路径 + 日志屏蔽 |
| 读取失败 | 重试用例 | —（composable 装载状态机 vitest） |

**结论**：SDD §5 全部 Gherkin 场景均有自动化承接（E2E 或 cargo test / vitest 层），双层证据
全绿；UI 呈现与 UIUX §8 文案全表、§9 交互 Gherkin 一致。界面体验是否"达标"（视觉层级、
警示醒目度）留给用户对照截图判断——证据 ≠ 结论。
