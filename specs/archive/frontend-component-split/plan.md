# 前端大文件拆分重构计划

## 背景与目标

三个 Vue 文件超出健康规模且各有结构性硬伤（详见 2026-09-26 评估）：

| 文件 | 现状 | 病理 |
|---|---|---|
| `src/views/RadioTab.vue` | 1498 行 | template 复制粘贴：消息行 rrow ×5 处（~180 行）、分组头 lg-head ×6 处、右栏详情 178 行内联 |
| `src/views/SettingsTab.vue` | 2331 行 | script 18 个功能域 / 67 函数；9 个同构「测试连接」函数；`ai_agents` 域状态滞留组件（已需 props 外传 TagDispatchCard） |
| `src/PetApp.vue` | 1963 行 | script 19 个功能域 / 54 函数 / 17 个手工定时器；未沿用项目既有 composable 模式 |

**性质：行为保持不变的结构重构**（纯移动/提取，不改逻辑、不改 i18n key、不改用户可见行为）。参照先例：TaskTab 445 行（重 UI 拆 5 子组件）、`composables/useXxx(opts)` + 配套 spec。

## 硬约束

- 不改对外契约：`defineExpose`（RadioTab `focusCapture`、SettingsTab `save`）、tauri `listen` 事件接线、TagDispatchCard 的 props/emits 接口保持不变。
- 类名不动（样式随组件迁移，避免连锁改样式选择器）；scoped 样式必须与模板同迁，防止父级 scoped 失效。
- 每步完成后目标 spec + `npx vue-tsc --noEmit` 全绿；新 composable 按项目惯例补 `__tests__/useXxx.spec.ts`（回归测试，纯结构重构无新业务逻辑，TDD 轴判据＝保持既有测试全绿 + 为搬移的时序/定时器逻辑补测）。
- 不 commit（由用户验收后决定）。

## 并行组 1（三个文件互不相交，可并行派发）

### T1 RadioTab 拆子组件（1498 → 目标 ≤650）

新建 `src/components/radio/`：
- `ImMessageRow.vue` —— 吃掉 5 处 rrow 复制（L368-399/430-455/473-494/511-535/561-605），差异位（徽标/勾选/标记）走 props + slot；样式 L1032-1169 随迁
- `ImListGroup.vue` —— 折叠分组头 ×6 处（计数/角标走 props）；样式 L965-1011 随迁
- `ImDetailPanel.vue`（含 `SuggestCard.vue`，合并两张同构建议卡 L641-664 / L667-692）—— 右栏 L628-805；样式 L1211-1402 随迁
- `EscapeReasonPop.vue` —— L796-802 + L1404-1460
- `CaptureBar.vue` —— L810-822 + L860-916（defineExpose 转发 focusCapture）
- `UndoToast.vue` —— L826-829 + L1462-1498

验证点：`App.spec.ts`（RadioTab 无独立 spec，由 App.spec 覆盖）+ 快速捕捉 `focusCapture` 经 App.vue ref 调用链路。

### T2 SettingsTab 拆分（2331 → 目标 ≤500）

分三刀：
1. **`src/composables/useActionToast.ts`**：`flash(msg, ms)` + `run(label, fn)` 包装器，替换 9 处测试函数样板（runTest/testAgent/openHistory/checkSkill/installSkill/setupRemotePkFor/retryProvider/feishuLogin/checkUpdate）与 ~15 处 setTimeout 自动清除；补 spec。
2. **agents 域上移 + AgentConfigCard**：新建 `src/stores/agents.ts`（持有 agents 列表 + AGENT_PRESETS + CRUD/去重/隧道状态，经 settings store 持久化）；`src/components/settings/AgentConfigCard.vue` ← template L1304-1397 + script L596-869 + style L1889-1995/2316-2330。SettingsTab 改为消费 store；TagDispatchCard 接口不变（props 由 store 数据喂）。
3. **分区子组件化**：`src/components/settings/` 下按 7 分区拆 Section 组件（focus/cats/tags/display/integrations/diag/general），其中 diag 内再拆 `LogViewer.vue` + `HealthCard.vue`，general 内拆 `BackupCard.vue`/`ExportImportCard.vue`/`UpdateCard.vue`，cats 内拆 `CategoriesCard.vue`/`QuotesEditorCard.vue`。全局 `testMsg` 状态条经 `useActionToast` 共享。共享壳样式（.settings/.set-card/.set-sub 等）留在父级。

验证点：`App.spec.ts`、`settings.spec.ts`、`TagDispatchCard.spec.ts`、`FeishuChatFilterManager.spec.ts`；tauri 事件（更新进度/健康变化）接线保持。

### T3 PetApp 提 composable（1963 → script 968 → 目标 ≤450；总行数随样式迁移下降）

新建 `src/composables/`（沿用 `useXxx(opts)` 谓词/回调注入 + 返回控制句柄模式，各配 spec）：
- `usePetBubble.ts` ← L54-62/206-281（`isChatOpen()`/`onDismiss()` 注入）
- `useCatchScene.ts` ← L701-799（自包含；`say/burstStars/speak/onMateLeave` 注入）
- `usePetChat.ts` ← L590-643（`resizePetWindow/say/speak/agentConfigured` 注入）
- `spriteClass` 汇合 computed 留在组件内。

验证点：`PetApp.spec.ts`（460 行）+ 新增 3 个 composable spec；onUnmounted 定时器清理逐项对应不丢。

## 收尾（主会话自查）

1. `npm run test:unit` 全绿；`npx vue-tsc --noEmit` 0 错；`npm run lint` 0 错；`npm run format:check`（或对触碰文件 `prettier --write`）。
2. `wc -l` 复查三个文件行数达标。
3. 跨文件重复样式（RadioTab vs TaskTab 的 `.search-input`/`.empty`、图鉴卡片语言令牌化）**不在本期范围**，登记 `docs/debt.md`。
4. 产出 `specs/frontend-component-split/reports/refactor-summary.md`（前后行数对照 + 新文件清单）。
