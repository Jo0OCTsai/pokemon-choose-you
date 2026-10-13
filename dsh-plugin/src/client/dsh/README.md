# dsh/ —— 平台胶水层（client 半边真实适配，Phase B）

> 业务核心零 dsh 依赖（AGENTS.md 铁律）的例外边界：本目录是 client 侧唯一允许触碰
> dsh 平台形态（module-loader bundle / slots 契约 / connection rpc 通道）的目录。
> RC 期 dsh 破坏性变更被限制在这一薄层内消化；React 视图本体在 `src/client/**`。

## 模块挂点

- `clientEntry.tsx` —— 客户端入口（浏览器 Loader 经 `window.__ModuleLoader__.load` 挂载
  dist/client.js，消费 `inject`/`apply`）：`ctx.connection.rpc` → transport →
  `createHostClient` → 四 slot 注册——`plugins.detail.section`（list/root，subject 指向
  本包 `pkg.name === "dsh-plugin"` 才渲染 PluginDetailPage，他包 null 零占位）、
  `conversation.session.header.actions`（list/session，ConversationChip；选 actions 而非
  single 容器位 `conversation.header`——多插件共存不冲突）、`sidebar.panellist`（list/root，
  侧边栏一级入口）与 `main`（keyed/root，主区全局面板）。chip 点击经
  `ctx.layout.selectPanel` 客户端闭环直达面板；`slots.inject` 自带纤维回收。
- `sidebarPanel.tsx` —— 侧边栏一级入口 + 主区面板（`sidebar.panellist` + `main` keyed
  槽，id/key 同源 `PANEL_ID = "pokemon-choose-you"`、order 20 排内置插件 0 / 自动化任务
  10 之后）：图标组件（装饰性精灵球 SVG，无障碍标签归侧边栏行壳）、locale-aware 标签
  （宿主 locale 快照映射三语 `dsh.page.title`）、主面板壳（darwin 顶部
  `--dsh-frame-top-clearance` 避让红绿灯带 + 整页自滚动，`mainPanel.module.css`）、
  `createPanelOpener`（chip 点击导航）与 `createPanelRoot`（detail section / 主面板共用
  的数据快照根）。
- `transport.ts` —— DshRpcTransport（Typert Remote 迁移后形态，2026-10-13）：命令 →
  共享 `/api` 通道 Remote 端点 `pky/call`（args 按源码参数名键控 `{command, payload?}`，
  单源锚定 host 侧 remoteService.ts），双信封剥层——传输层 ConnectionRpcResult 的
  value = host 业务信封原样透传（Remote 方法不抛错，业务错误码不进传输层错误路径）；
  传输失败信封逆向还原（details.hint→hint / 未知码折叠 INVALID_ARGUMENT 原码并入
  message）；diagnosticsSnapshot 视图模型归一（host `status` → client 契约 `level`）；
  pageOpen 本地监听面（host 推送接面预留）。
- `panelData.ts` —— 读命令 → PanelData 组装：configRead/dbStatus/diagnosticsSnapshot/
  filterList/promptList/panelSnapshot 并行逐项兜底；实体清单（任务四段/收音机消息五分组/
  会话账本/分类/当前任务）从 `panelSnapshot` 聚合读灌入（各任务段按 id 去重合并成全量
  Task[]——组件纯函数重分组与 host 分段一致），跟进流与任务级时间线由 `taskDetail` 在
  TaskDetailDrawer 懒载；locale 取共享 `language` 键；健康优先取快照（host 已归一 client
  契约形态），快照缺勤（旧 host 无命令）回落 diagnostics feishu 链路派生（epoch 毫秒 →
  RFC3339——client timeOf 对 number 取 slice 会崩）；agents/routes 从 `ai_agents` /
  `dsh:dispatch_routes` 设置键 JSON 解析；换装搜索内置主应用 catalog.json
  （`@app-pokemon` alias）。

## 构建与验证口径

- 构建：build.mjs client 段——esbuild cjs + banner/footer 包成 module-loader IIFE 形态
  （抄 dsh 官方 client 包开头），external 仅 react/react-dom/react/jsx-runtime（宿主
  module table 种子），CSS modules 经自研插件内联注入（`<style data-plugin-css>` 幂等），
  @app-i18n/@app-pokemon 经 tsconfig paths 解析后整体 bundle。
- 单测：`__tests__/client/dsh-transport.spec.ts`（信封还原/归一/监听面）、
  `__tests__/client/dsh-panel-data.spec.ts`（组装/派生件）、
  `__tests__/client/dsh-client-entry.spec.tsx`（四 slot 注册/subject 自判/侧边栏入口与
  标签映射/主面板渲染/chip 导航与零占位——fake slots + mockHost 信封正向转换）。
- client 代码不进覆盖率门禁（vite.config include 只扫 src/host），进 lint/棘轮。
- 真实加载走 pky-test profile 冒烟（`dsh --profile pky-test --no-open --port <p>` 后
  浏览器验证——侧边栏入口出现 + 主面板七段渲染；注意 profile 的 node_modules 若是
  file: 拷贝需同步 dist 后再验）。
