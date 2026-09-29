# 接口测试总结 — editable-prompts

> 原始数据：`reports/raw/junit-src-tauri.xml`（cargo2junit，358 用例）、
> `reports/raw/junit-frontend.xml`（vitest junit，292 用例）——机器产出，勿手改。
> 服务 commit：HEAD `846c84a`（feat/editable-prompts；实施代码在工作区待 T3.5 统一 commit，
> 本报告测试对象即该工作区状态）。
> 结论：✅ 可交付（failures=0）

本项目"接口"为 Tauri command（`list_ai_prompt_specs` / `save_ai_prompt`，契约 = architecture.md
§4.2），无 HTTP 端点——契约测试落在 Rust 命令层/解析层测试（mock_app 装置直调 command，
等价于适配器的"直接打路由"形态），生效载荷断言落在调用链集成测试（fake-agent stdin 装置）。

## 1. 结果总览

| 服务（stack.json name） | runner | 用例 | 失败 | junit |
|---|---|---|---|---|
| `src-tauri` | `cargo test`（nightly `--format json` → cargo2junit） | **358** | **0** | `raw/junit-src-tauri.xml` |
| `pokemon-choose-you`（前端） | `vitest run --reporter=junit` | **292** | **0** | `raw/junit-frontend.xml` |

本特性相关用例（junit classname 检索）：

- **解析/校验层 `ai::prompt_overrides::tests`（15）**：resolve 六分支矩阵（无行/空白/同默认/
  缺占位符→Warned/超长→Warned/合法→Custom）+ 优先序锚点（同默认恒归 Default）；save 分支
  （空白/同默认删行、超长文案含上限、缺占位符列名、未知占位符放行 + 大小写边界）；`render_template`
  单遍不重扫 + format! 对拍；token 扫描样式边界；目录自检（默认含全部必要占位符、4 键唯一、
  上限常量）；source 三态序列化字面量（前端契约）。
- **命令层 `commands::prompts::tests`（7）**：list 三态载荷（default_warned 的 overrideText 回传、
  dispatch 固定值 + 示例渲染）、save 错误分支（不可编辑键/超长/缺占位符）、DELETE/upsert 落库
  断言、广播 settings-changed、camelCase 序列化契约（字段名与前端 types.ts 对齐）。
- **调用链集成（生效载荷 = SDD §5 观察点）**：`pet_chat_custom_override_reaches_agent_payload`、
  `pet_chat_broken_override_falls_back_to_default_payload`、`pet_chat_sends_context_and_trims_reply`
  （默认输出逐字节锚点）、`classify_custom_override_reaches_agent_payload`、
  `judge_with_agent_sends_system_prompt_in_payload`、`prompt_debug_preview_masks_custom_content`
  （日志隐私屏蔽）。
- **边界面**：`dispatch_prompt_example_renders_full_structure`（示例渲染）、
  `prompt_override_rows_excluded_and_preserved_across_import`（导出排除 + 导入 stash-and-restore，
  M-1 回归）、`list_all_settings_filters_prompt_overrides`。
- **前端（vitest）**：`usePromptEditor.spec.ts`（18）——三态映射/脏检查/预校验/保存恢复状态机/
  错误呈现转换；`PromptsCard.spec.ts`（12）——卡壳装载/失败重试/面板渲染。

覆盖维度对照（本特性口径）：正常路径 ✅、请求校验（键白名单/空白/超长/占位符） ✅、
边界值（20000 cp、空集占位符、大小写 token） ✅、响应结构（camelCase 序列化契约测试） ✅、
幂等/旁路（同默认删行防幻影自定义、set_setting 旁路空白行回落） ✅；鉴权 N/A（单用户本地应用，
键白名单即越权面）。

## 2. 失败项与根因

无（failures=0）。

## 3. 原始报告索引

- Rust junit：`reports/raw/junit-src-tauri.xml`（358 tests / 0 failures）
- 前端 junit：`reports/raw/junit-frontend.xml`（292 tests / 0 failures）
- E2E（另一层，见 e2e-summary.md）：`reports/raw/playwright-report/`（html + junit-e2e.xml）

## 4. 交付结论

- [x] 接口测试全部通过（failures=0，双服务 650 用例）
- [x] AD §4.2 契约（命令名、载荷字段、错误文案、三态语义、判定顺序）均有对应用例承接
- → **可交付**
