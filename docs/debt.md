# 债务与待办清单

> 活清单：完成勾选移入已完成段，新债务随时追加。每条注明来源与影响面。

## 待处理

- [ ] **PetApp.vue 剩余可拆功能域**（来源：2026-09 前端大文件拆分，`specs/frontend-component-split/`）：script 仍有 ~795 行。可继续按 `useXxx(opts)` 模式提取：reminder 就近提醒（~38 行）、睡眠/唤醒（~32 行）、时刻台词+每日问候（~74 行，两块同构可合并）、陪跑精灵 mate（~40 行）、手势三分+拖拽+栖息（~110 行）、快捷图鉴屏（~40 行）。提取后 script 预计可到 ~450。模板侧 ChatBox/QuickDex 两个区域（~86 行 template + 样式）也可 SFC 化。
- [ ] **跨文件重复样式未令牌化**（来源：同上，属重构范围外登记）：
  - RadioTab 与 TaskTab 逐字雷同的 `.search-input` / `.empty`，应下沉公共样式；
  - 「3px navy 边框 + 3px3px 硬阴影 + 8px 圆角」图鉴卡片语言在 RadioTab/TaskCard/TaskTab/SettingsTab 出现 12+ 处，应抽 `.dex-card` 公共类或设计令牌（设置页 `.set-card` 主规则现已分散为 8+ 份 scoped 副本，是其中最大的一簇）；
  - RadioTab 内置信度配色两套（`.conf.high|medium|low` 与 `.sug-conf.c-high|c-medium|c-low`）应合一；
  - SettingsTab 拆分中子组件复制的 `.btn-row`/`.btn.del` scoped 副本（仓内已接受的做法），令牌化时一并收编。
- [ ] **flash 状态条语义微差**（来源：同上，useActionToast 重构）：多条 flash 消息重叠时由「先到先清」改为「最新重置」（用户不可感知级别）；备份/导出卡内 flash 消息在有效期内切走 general 分区再回来会清空。若日后做多区域 toast 需求可一并重设计。
- [ ] **SettingsTab script 内仍留页面级胶水**：autostart/feishuAuth/backups/appVersion 的 onMounted 预取与两个 tauri listen 留在父级经 props/emit/ref 转发（行为保持所需）；若后续做 feishu/update 域 store 可下沉。

## 已完成

- [x] 2026-09-26 前端三大文件结构重构（RadioTab 1498→637、SettingsTab 2331→408、PetApp 1963→1789），行为保持不变，221 单测全绿——详见 `specs/frontend-component-split/reports/refactor-summary.md`。
