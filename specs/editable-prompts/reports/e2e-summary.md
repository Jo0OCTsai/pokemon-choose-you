# E2E 测试总结（e2e-summary）

> 数据源：`reports/raw/playwright-report/`（2026-09-29 最终跑，chromium + firefox 双工程，
> html 报告 `index.html` + junit `junit-e2e.xml` 同目录；`test-output/` 为失败件目录，本次为空——无失败）。

## 总览

- **chromium + firefox：84 tests / 0 failed / 2 skipped**（junit 头：`tests="84" failures="0" skipped="2" errors="0"`）。
- 2 skipped 为验收截图用例在 firefox 工程的设计内跳过（截图产物仅 chromium 生成，`test.skip(browserName)`）。
- 全部经 `e2e/tauri-mock.ts` 注入 IPC mock；本次扩展的 `list_ai_prompt_specs` / `save_ai_prompt`
  **镜像 Rust `ai/prompt_overrides.rs` 语义**（目录 5 项与存储键、resolve 固定优先序三态、
  保存判定序：键白名单 → 空白/同默认删行 → 超长/缺占位符 Invalid → upsert + 未知占位符
  扫描 + 广播 settings-changed）。mock 默认文本是形态真实的样例（含占位符与协议句），
  生产默认文本的逐字节断言由 cargo test 锁定（见 api-summary.md）。
- webkit 工程：本机浏览器二进制 Segmentation fault（`browserContext.newPage` 阶段即崩，
  全部用例含**未改动的既有套件**同样失败，与测试代码无关）——与 specs/archive/feishu-chat-filter
  报告先例同口径：webkit 归 CI 矩阵覆盖，本地门槛为 chromium + firefox。

## 本特性新增（e2e/prompts-settings.spec.ts，13 个）

| 用例 | 验证点 | 对应验收 |
|---|---|---|
| 默认态查看：徽章、生效标签、占位符行；空集不渲染 | 「内置默认」徽章、生效标签「当前生效」、LCD 等宽生效文本含 `<AGENT_ID>` 与协议句、占位符行 label + chip；标签治理空集不渲染该行；未配置 agent 无门槛提示 | SDD §5 查看（默认态/无 agent）；UIUX §9 无覆盖初态 |
| 编辑保存后徽章切换、生效文本替换，可展开内置默认对照 | textarea 预填默认（无覆盖=生效文本）、「未保存」徽章、保存后徽章「自定义」、生效标签「当前生效 · 自定义」、查看屏新文本、✅ 提示行、后端 source=custom、对照区显示当前版本默认 | SDD §5 保存合规覆盖；UIUX §9 编辑会话 |
| 删占位符→红色阻断 + 保存禁用；chip 插入恢复后可保存 | 占位符行编辑态常驻不隐藏、缺失 chip 红样式、校验区红色阻断文案列出 `<AGENT_ID>`、保存禁用；chip 点击插入光标处、焦点保持 textarea、阻断消失保存可用、保存成功徽章切换 | SDD §5 缺失占位符被阻断；UIUX §9 校验即时呈现与保存阻断 |
| 超过长度上限被阻断 | 计数器着警色（`n / 20000`）、红色超长文案含上限值、保存禁用 | SDD §5 超长被阻断；UIUX §9 超长输入 |
| 未知占位符仅警告 | 保存放行、徽章「自定义」、查看态遗留黄色警告「含应用不认识的占位符：\<FOO\>」（后端返回清单，前端不扫描） | SDD §5 未知占位符仅警告 |
| 保存空白等同恢复默认 | 清空后中性预告「内容为空：保存后将恢复使用内置默认」、保存后徽章回「内置默认」、后端 overrideText=null | SDD §5 保存空白覆盖等同恢复默认 |
| 恢复默认两步行内确认 | 确认条 `role="group"` + aria-label「恢复默认确认」、后果文案、确认/取消；无模态弹窗；确认后徽章回「内置默认」+「✅ 已恢复内置默认」、行删除、「恢复默认…」入口随覆盖消失 | SDD §5 一键恢复；UIUX §9 恢复默认两步确认 |
| 派发提示词只读 | 「只读」徽章、操作行无任何按钮（无编辑入口）、只读说明行提及不可信内容隔离结构、LCD 显示完整示例结构（含「===== 待办数据开始 =====」定界块）、无占位符行 | SDD §5 派发只读；UIUX §9 派发面板只读 |
| default_warned 警示态与按警示修复 | 「内置默认」+「⚠ 不可用」双徽章、警示行列出 `<AGENT_ID>` 且说明按内置默认生效、查看屏=默认（生效文本）非覆盖原文；编辑回填覆盖原文（供修复）、chip 补齐保存后警示消失徽章「自定义」 | SDD §5 升级后存量覆盖缺新占位符 + 按警示修复 + 坏覆盖查看与恢复入口 |
| 读取失败呈现错误行与重试 | 卡头错误行「提示词读取失败：…」+ 重试钮、面板不渲染（0 面板）；重试后 5 面板正常呈现 | UIUX §9 读取失败的出路 |
| 模式与状态转换的焦点管理 | 进编辑焦点入 textarea 且光标置尾；取消编辑焦点回「编辑」；确认条焦点入「确认恢复」、取消收起回「恢复默认…」 | UIUX §9 焦点管理（§4.1 规格） |
| 验收截图：默认态 / 编辑校验 / 保存后自定义 | 实拍落 `reports/screenshots/01/02/06`（仅 chromium） | acceptance-report 引用 |
| 验收截图：警示态 / 只读面板 / 恢复确认条 | 实拍落 `reports/screenshots/03/04/05`（仅 chromium） | acceptance-report 引用 |

## 既有套件回归

- `feishu-chat-filter.spec.ts`（7）/ `main-panel.spec.ts`（9）/ `pet.spec.ts`（7）/
  `settings-tags.spec.ts`（9）在 chromium + firefox 双工程全绿——设置页 Agent 分区新增
  提示词卡未破坏既有布局与交互（settings-tags 会切到 Agent 分区触发新卡装载，
  mock 已补齐两个新命令，无未实现命令报错）。

## 已知边界

- E2E 的 IPC mock 与 Rust 实现是**镜像关系**（解析/校验规则双写）：漂移由 Rust 侧
  单测/命令测试在单元层锁定（resolve 六分支矩阵、save 错误分支、序列化契约），
  E2E 锁定的是交互行为与视觉结果。
- 「保存后下一次 AI 调用载荷使用新提示词」的生效断言观察点是**发给 agent 的调用载荷**
  （SDD §5 约定），该管道在 E2E mock 环境不可达——由 cargo test 集成层覆盖
  （pet stdin 载荷、classify 覆盖生效等，见 api-summary.md）。
