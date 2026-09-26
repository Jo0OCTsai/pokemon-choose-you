# src/ 前端源码约定

## 视图组织

- `views/*.vue` 与 `PetApp.vue` 只做装配与页面级编排（事件接线、懒加载、页面生命周期），重 UI 一律下沉 `components/<domain>/`（现有 `components/settings/`、`components/radio/`，新领域照此开目录）。参照：TaskTab 445 行、SettingsTab 408 行。
- 组件超过约 600 行、或 template 出现第二处复制粘贴时，先拆再续写。
- 自治逻辑提取走 `composables/useXxx(opts)`：opts 传谓词/回调（`isBusy`/`onDismiss`），返回 ref 集 + 控制句柄；**必须**配套 `__tests__/useXxx.spec.ts`（fake timers 钉时序 + unmount 无泄漏断言）。参照 `usePomodoro.ts`、`usePetBubble.ts`。

## 设置页（SettingsTab + components/settings/）

- 加设置项：找对应 `Section<Domain>.vue` 分区组件；开关用 `composables/useSettingToggle.ts`（即时写 settings store 缓冲，「保存设置」才落库——不要绕过该时机）；状态条反馈 `inject(ACTION_TOAST)` 用 `flash()/run()`（键从 `composables/useActionToast.ts` 导入），**不要**自建 ref 消息。
- agents 域（AI agent 列表/预设/隧道状态）：一律走 `stores/agents.ts`；持久化通道固定为 settings 的 `ai_agents` 键，勿改（PetApp 等消费方直接读该键）。
- 子组件需要 `.btn-row`/`.btn` 等通用类时复制 scoped 副本是仓内接受做法（令牌化见 docs/debt.md）。
- 跨分区存活的状态（如 tags 行内编辑缓冲）留 SettingsTab 父级，经 props 下发；只被单分区用的随分区组件走。

## 状态与契约

- 桌宠窗口（PetApp）与主窗口（App.vue）经 tauri event + settings 键共享状态，互不 import 组件。
- `defineExpose` 是对外契约（RadioTab `focusCapture`、SettingsTab `save`、HealthCard `reload`），改动前先 grep 调用方。
- toast 忙位有联动语义（testing 组共用一个实例），拆按钮时核对 `:disabled` 分组。
