# 前端大文件拆分重构总结

> 对应计划：`specs/frontend-component-split/plan.md`（2026-09-26）
> 性质：行为保持不变的结构重构。基线 183 单测全绿 + vue-tsc 0 错；完成后 **221 单测全绿**（183 既有 + 38 新增回归）+ vue-tsc 0 错 + eslint 0 错 + prettier 全符合。

## 结果对照

| 文件 | 前 | 后 | 变化 |
|---|---|---|---|
| src/views/SettingsTab.vue | 2331 | 408 | −82% |
| src/views/RadioTab.vue | 1498 | 637 | −57% |
| src/PetApp.vue | 1963 | 1789 | −9%（script 969 → 795） |

三个文件合计 5792 → 2834 行；其余约 3000 行按职责迁移到 26 个新文件（子组件 / composable / store / spec）。

## 新增文件清单

**src/components/radio/**（8 个）：`ImMessageRow`（229，参数化合并 5 处复制粘贴的消息行，variant 差异位全覆盖）、`ImListGroup`（99，6 处折叠组头复用，保留 v-if/CSS 两种折叠机制）、`ImDetailPanel`（323，右栏详情+操作区）、`SuggestCard`（114，两张同构 AI 建议卡合一）、`EscapeReasonPop`（78）、`CaptureBar`（107，focus 经 ref 转发）、`UndoToast`（58）、`ClearNoiseActions`（57）。

**src/components/settings/**（16 个）：`SectionFocus/Cats/Tags/Display/Integrations/Diag/General` 七分区组件 + `CategoriesCard`、`QuotesEditorCard`、`TagsManagerCard`、`DimensionsCard`、`FeishuCard`、`HealthCard`、`LogViewer`、`BackupCard`、`ExportImportCard`、`UpdateCard`、`AgentConfigCard`（362，第一刀产出，props: { agentId }）。

**src/composables/**（5 个新）：`useActionToast`（61，flash + run 动作包装，导出 ACTION_TOAST/SKILL_TOAST 注入键）、`useSettingToggle`（15，原 boolSetting 工厂）、`usePetBubble`（119）、`useCatchScene`（119）、`usePetChat`（98，均沿用项目 useXxx(opts) 谓词注入 + 控制句柄模式）。

**src/stores/**：`agents.ts`（129，agents 域上移：AGENT_PRESETS + CRUD/去重 + 隧道状态；持久化通道不变，仍写 settings 的 ai_agents 键）。

**src/__tests__/**（5 个新 spec，38 用例）：`useActionToast.spec`（7）、`agents.spec`（10）、`usePetBubble.spec`（8）、`useCatchScene.spec`（6）、`usePetChat.spec`（7）——钉住搬移逻辑的时序回归：气泡字符数倒计时/悬停暂停/无泄漏、捕捉三段式 1370ms 相位/跳过/连胜双球、聊天窗口 300×{330,480,590} 分档、toast busy/msg 时序、agents 与 settings 键双向同步。

## 契约保持核验

- RadioTab `defineExpose({ focusCapture })`：经 CaptureBar template ref 转发，App.vue 调用链不变。
- SettingsTab `defineExpose({ save })`：`settings.save(SETTING_KEYS)` 全量键 + petInput 同步逐字保留；开关均即时写 store 缓冲，save 与分区无关，无需子组件聚合。
- `ai_agents` 持久化通道：仍写 settings 的 ai_agents 键，PetApp 等消费方读取方式未动；TagDispatchCard props/emits 接口未动（改喂 agentsStore.list）。
- 忙位语义：原 4 个忙位（testing 联动禁用组 / skillBusy / oauthBusy / updating）分组全部保留，含「任一测试运行时相关按钮联动禁用」这一有意行为。
- 定时器清理：PetApp 17 项中 bubbleTimer 改由 composable 自清，其余 13 项留组件 onUnmounted 逐项对应，fire-and-forget 类保持原状。
- tauri listen（更新进度/健康变化）、分区懒加载时序（含 tags 跨分区编辑存活语义）均等价承接。

## 已知微小差异（不可感知级，已登记 debt.md）

1. flash 消息重叠时由「先到先清」改为「最新重置」。
2. 备份/导出卡内 flash 消息在有效期内切走 general 分区再回来会清空（动作与 busy 不受影响）。
3. SectionDisplay 的日期预览按分区挂载时取值（同一天内一致）。

## 验收后回归修复（2026-09-26）

用户验收发现：设置页「项目派发」卡片背景与宽度未对齐。根因 = Vue scoped 样式断链——`TagDispatchCard` 与 `FeishuChatFilterManager` 两个既有组件根元素为 `class="set-card"`，原本依赖「作为 SettingsTab 直接子组件继承父 scope id」吃到 `.set-card` 收口与外观规则；分区子组件化后它们嵌到二层（SectionTags/SectionIntegrations 均为 fragment 多根），父级 scoped 规则命中不到。修复：为两者补 `.set-card` scoped 主规则副本（与 TagsManagerCard 等新组件同做法，原文逐字对照 git 历史）。浏览器实测「标签」「集成」两分区卡片对齐恢复。教训已沉淀至 `src/AGENTS.md`（宿主 scoped 样式够不到二层子组件）。

## 未达项与遗留

- PetApp script 目标 450 未达（795）：三个指定 composable 仅能移出 ~218 行，其余需扩大切口（reminder/sleep/mate 等），已登记 debt.md 供后续迭代。
- 跨文件重复样式（`.search-input`/`.empty` 雷同、图鉴卡片语言 12+ 处无令牌）超出本期「行为不变」范围，登记 debt.md。

## 验证记录（最终收尾，主会话独立复跑）

```
npx vitest run            → Test Files 26 passed (26) / Tests 221 passed (221)
npx vue-tsc --noEmit      → 0 错误
npm run lint              → exit 0
npm run format:check      → All matched files use Prettier code style!
```

执行方式：三个文件互不相交，RadioTab 与 PetApp 并行派发；SettingsTab 分两刀串行（域上移 → 分区子组件化），每波之间主会话独立复跑全量检查。全程未 commit。
