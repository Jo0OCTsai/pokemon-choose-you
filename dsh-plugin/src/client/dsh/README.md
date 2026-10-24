# dsh/ —— 平台胶水层（client 半边真实适配，Phase B）

> 业务核心零 dsh 依赖（AGENTS.md 铁律）的例外边界：本目录是 client 侧唯一允许触碰
> dsh 平台形态（module-loader bundle / slots 契约 / connection rpc 通道）的目录。
> RC 期 dsh 破坏性变更被限制在这一薄层内消化；React 视图本体在 `src/client/**`。

## 模块挂点

- `clientEntry.tsx` —— 客户端入口（浏览器 Loader 经 `window.__ModuleLoader__.load` 挂载
  dist/client.js，消费 `inject`/`apply`）：`ctx.connection.rpc` → transport →
  `createHostClient` → 三 slot 注册——`conversation.session.header.actions`（list/session，
  ConversationChip；选 actions 而非 single 容器位 `conversation.header`——多插件共存不冲突）、
  `sidebar.panellist`（list/root，侧边栏一级入口）与 `main`（keyed/root，主区全局面板）。
  原 `plugins.detail.section` 槽已摘除（用户裁决：插件管理器详情页回归纯信息页——元数据
  由宿主 readPluginMeta 读包清单 `locale/*.json`，图鉴机 UI 仅经侧边栏面板呈现）。chip
  点击经 `ctx.layout.selectPanel` 客户端闭环直达面板；`slots.inject` 自带纤维回收。
- `pluginConfig.tsx` —— 插件私有配置消费面（dsh Config 键 judgeExecutor/petAutoStart）：
  `ctx.configForms`（ui-settings 设置域基础服务，随 dsh-base → dsh-settings 链装配，
  `inject` 必需声明）按 host entry id（`pokemon-choose-you`）取 scope，`createPluginConfig`
  工厂期箭头绑定方法 receiver（ConfigFormController 是 class，React 裸函数调用回调，
  解绑即 this 丢失渲染崩——真机踩坑回归项）后经 `PluginConfigProvider` Context 随主面板
  注入。读 = describe 镜像快照，写 = set() 排队 → remote.settings → 宿主 configEditor 落
  profile patch（cordis.patch.yml；volatile 强校验 + revision CAS + Loader 热应用）——
  与手写 patch 同层同效。**背包为唯一编辑面**（用户裁决 2026-10-18：原
  plugins.bundle.config 详情页配置区已撤——详情页纯信息页；消费行 =
  `src/client/settings/PluginConfigRows.tsx`：JudgeRunnerRow 平铺选择器
  （内置通道/不指定/agents——选 agent 即时双写 judgeExecutor=cli + ai_agent_id 共享键）+
  PetAutoStartRow 开关）。
- `sidebarPanel.tsx` —— 侧边栏一级入口 + 主区面板（`sidebar.panellist` + `main` keyed
  槽，id/key 同源 `PANEL_ID = "pokemon-choose-you"`、order 20 排内置插件 0 / 自动化任务
  10 之后）：图标组件（装饰性精灵球 SVG，无障碍标签归侧边栏行壳）、locale-aware 标签
  （宿主 locale 快照映射三语 `dsh.page.title`）、主面板壳（darwin 顶部
  `--dsh-frame-top-clearance` 避让红绿灯带 + 整页自滚动，`mainPanel.module.css`）、
  `createPanelOpener`（chip 点击导航）与 `createPanelRoot`（主面板的数据快照根）。
- `transport.ts` —— DshRpcTransport（Typert Remote 迁移后形态，2026-10-13）：命令 →
  共享 `/api` 通道 Remote 端点 `pky/call`（args 按源码参数名键控 `{command, payload?}`，
  单源锚定 host 侧 remoteService.ts），双信封剥层——传输层 ConnectionRpcResult 的
  value = host 业务信封原样透传（Remote 方法不抛错，业务错误码不进传输层错误路径）；
  传输失败信封逆向还原（details.hint→hint / 未知码折叠 INVALID_ARGUMENT 原码并入
  message）；载荷一律原样透传（diagnosticsSnapshot 契约已与 host IntegrationHealthInfo
  同形——`status` 六态 + `nextPollAt` epoch 毫秒，2026-10-21 原 status→level 归一胶水删除）；
  pageOpen 本地监听面（on/emitPageOpen——事件源见 pageOpenStream.ts）。
- `pageOpenStream.ts` —— host→client pageOpen 推送订阅（2026-10-21 接真）：`ctx.remote.$stream`
  监督开 host 流端点 `pky/pageOpenEvents`（open = `openRemoteStream(endpoint, {args:{}}, signal)`
  ——浏览器载体走 /api/remote.mux WebSocket mux；该原语不在 api-gateway 公开 .d.ts，结构化
  收窄 + `hasPageOpenStreamFace` 装配期特征检测，缺席即不订阅只降级推送面）；ready 帧
  accept() 重置重连计数（平台 $events 流同款首帧模式），pageOpen 帧 → transport.emitPageOpen →
  host.onPageOpen 两消费方：clientEntry 导航监听（`createPanelOpener` selectPanel 直达本面板）
  + 面板内 `usePageOpenAnchor` 分段锚点。重连节拍由 $stream 按 connection 代际驱动——客户端
  仍无周期性定时器（NFR-6）；流终态（host 插件卸载/重试耗尽）静默，面板仍可经侧边栏手动打开。
- `panelData.ts` —— 读命令 → PanelData 组装：configRead/dbStatus/diagnosticsSnapshot/
  filterList/promptList/panelSnapshot 并行逐项兜底；实体清单（任务四段/收音机消息五分组/
  会话账本/分类/当前任务）从 `panelSnapshot` 聚合读灌入（各任务段按 id 去重合并成全量
  Task[]——组件纯函数重分组与 host 分段一致），跟进流与任务级时间线由 `taskDetail` 在
  TaskDetailDrawer 懒载；locale 取共享 `language` 键；健康优先取快照 `radio.health`（host
  panelRadioHealth 已投影 RadioHealth 视图），快照缺勤（旧 host 无命令）回落 diagnostics feishu
  链路派生（六态聚合三档 + epoch 毫秒投影 RFC3339——与 host 同一投影）；agents/routes 从
  `ai_agents` / `dsh:dispatch_routes` 设置键 JSON 解析；换装搜索内置主应用 catalog.json
  （`@app-pokemon` alias）。

## 构建与验证口径

- 构建：build.mjs client 段——esbuild cjs + banner/footer 包成 module-loader IIFE 形态
  （抄 dsh 官方 client 包开头），external 仅 react/react-dom/react/jsx-runtime（宿主
  module table 种子），CSS modules 经自研插件内联注入（`<style data-plugin-css>` 幂等），
  @app-i18n/@app-pokemon 经 tsconfig paths 解析后整体 bundle。
- 单测：`__tests__/client/dsh-transport.spec.ts`（信封还原/透传/监听面）、
  `__tests__/client/dsh-page-open-stream.spec.ts`（$stream 开流端点与载荷/ready accept/
  pageOpen 帧收窄/dispose/特征检测/终态静默）、
  `__tests__/client/dsh-panel-data.spec.ts`（组装/派生件）、
  `__tests__/client/dsh-client-entry.spec.tsx`（三 slot 注册/侧边栏入口与标签映射/
  主面板渲染/chip 导航与零占位/host:pageOpen 推送导航——fake slots + mockHost 信封正向转换 +
  fake remote），
  `__tests__/client/dsh-plugin-config.spec.tsx`（receiver 绑定回归（class fake scope）/
  平铺判定行双写与降级/桌宠开关即时写）。
- client 代码不进覆盖率门禁（vite.config include 只扫 src/host），进 lint/棘轮。
- 真实加载走 pky-test profile 冒烟（`dsh --profile pky-test --no-open --port <p>` 后
  浏览器验证——侧边栏入口出现 + 主面板七段渲染；注意 profile 的 node_modules 若是
  file: 拷贝需同步 dist 后再验）。
